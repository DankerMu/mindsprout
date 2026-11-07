import { act, fireEvent, render, screen } from '@testing-library/react';
import { Activity, Profiler, StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  borderBoxEntry,
  canvasObserverOf,
  failOnConsoleNoise,
  installControllableResizeObservers,
  mindNodeElement,
  nodeWrapper,
  reactFlowNodeObserverOf,
  renderedPosition,
  sizedWrapperEntry,
  viewportTransform,
} from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import {
  DEFAULT_GAP,
  estimateNodeSize,
  layoutForest,
} from '../../contexts/map/application/layout/layout-forest';
import type { MindMap } from '../../contexts/map/domain/types';
import { MindMapCanvas } from './MindMapCanvas';

// Seam: MindMapCanvas through Testing Library in jsdom (design "Fixture — issue #15"). React Flow
// runs unmocked; a controllable ResizeObserver stands in for the browser's measurement, and
// rendered positions are read back from React Flow's node wrapper transforms.

failOnConsoleNoise();
const observers = installControllableResizeObservers();

afterEach(() => {
  vi.restoreAllMocks();
});

// r ─ a: a's column starts after r's width plus the gap.
function rootWithChild(fields: Parameters<typeof node>[2] = {}): MindMap {
  return mapOf(node('r', [node('a')], fields));
}

const ESTIMATED_X = estimateNodeSize('R').width + DEFAULT_GAP;

describe.each([
  ['plain', (element: ReactElement) => element],
  ['StrictMode', (element: ReactElement) => <StrictMode>{element}</StrictMode>],
])('MindMapCanvas measured feedback (%s)', (_mode, wrap) => {
  // The same element tree on every render, so a rerender updates the canvas, never remounts it.
  function renderMeasured(map: MindMap) {
    const onRender = vi.fn();
    const tree = (current: MindMap) =>
      wrap(
        <Profiler id="canvas" onRender={onRender}>
          <MindMapCanvas map={current} />
        </Profiler>,
      );
    const view = render(tree(map));
    return {
      onRender,
      rerender: (next: MindMap) => {
        view.rerender(tree(next));
      },
      unmount: view.unmount,
    };
  }

  it('lays out with the estimate first, then with the measured width', () => {
    renderMeasured(rootWithChild());
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true })).toBe(true);

    expect(renderedPosition('a').x).toBe(ESTIMATED_X);

    canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement('r'), 300, 32)]);

    expect(renderedPosition('a').x).toBe(300 + DEFAULT_GAP);
  });

  it('commits at most once for three identical batches', () => {
    const { onRender } = renderMeasured(rootWithChild());
    const canvas = canvasObserverOf(observers());
    const batch = [borderBoxEntry(mindNodeElement('r'), 300, 32)];
    canvas.fire(batch);
    const commits = onRender.mock.calls.length;

    canvas.fire(batch);
    canvas.fire(batch);
    canvas.fire(batch);

    expect(onRender.mock.calls.length - commits).toBeLessThanOrEqual(1);
  });

  it('shares one observer that observes every rendered node', () => {
    renderMeasured(rootWithChild());

    const canvas = canvasObserverOf(observers());

    expect(canvas.observed).toStrictEqual(new Set([mindNodeElement('r'), mindNodeElement('a')]));
  });

  it('falls back to offsetWidth/offsetHeight when an entry has no borderBoxSize', () => {
    renderMeasured(rootWithChild());
    const element = mindNodeElement('r');
    Object.defineProperty(element, 'offsetWidth', { configurable: true, value: 200 });
    Object.defineProperty(element, 'offsetHeight', { configurable: true, value: 32 });

    canvasObserverOf(observers()).fire([{ target: element }]);

    expect(renderedPosition('a').x).toBe(200 + DEFAULT_GAP);
  });

  it('ignores a late entry for a node it no longer observes', () => {
    // r ─ a ─ b: b's column depends on a's width.
    const chain = (collapsed: boolean) => mapOf(node('r', [node('a', [node('b')])], { collapsed }));
    const { rerender } = renderMeasured(chain(false));
    const canvas = canvasObserverOf(observers());
    const staleElement = mindNodeElement('a');
    rerender(chain(true));

    canvas.deliver([borderBoxEntry(staleElement, 900, 32)]);
    rerender(chain(false));

    expect(renderedPosition('b').x).toBe(
      estimateNodeSize('R').width + DEFAULT_GAP + estimateNodeSize('A').width + DEFAULT_GAP,
    );
  });

  it('unobserves a node that stops rendering, and disconnects on unmount', () => {
    const { rerender, unmount } = renderMeasured(rootWithChild());
    const canvas = canvasObserverOf(observers());
    const childElement = mindNodeElement('a');

    rerender(rootWithChild({ collapsed: true }));

    expect(canvas.unobserved).toContain(childElement);
    expect(canvas.observed.has(childElement)).toBe(false);

    const disconnects = canvas.disconnectCalls;
    unmount();

    expect(canvas.disconnectCalls).toBe(disconnects + 1);
  });
});

describe('MindMapCanvas measured nodes', () => {
  const visibilityOf = (ids: readonly string[]) =>
    Object.fromEntries(ids.map((id) => [id, nodeWrapper(id).style.visibility]));

  it('keeps measured nodes visible when a layout change moves them (no blink)', () => {
    const view = render(<MindMapCanvas map={rootWithChild()} />);
    const measured = ['r', 'a'];
    canvasObserverOf(observers()).fire(
      measured.map((id) => borderBoxEntry(mindNodeElement(id), 100, 32)),
    );
    // React Flow measures its wrappers too, as in a browser, so without `measured` the nodes are
    // visible here and the blink shows up only after the rerender below.
    reactFlowNodeObserverOf(observers()).fire(measured.map((id) => sizedWrapperEntry(id, 100, 32)));

    expect(visibilityOf(measured)).toStrictEqual({ r: 'visible', a: 'visible' });

    const before = renderedPosition('a');
    view.rerender(<MindMapCanvas map={mapOf(node('r', [node('a'), node('b')]))} />);

    // A sibling moved a, so every node object was rebuilt.
    expect(renderedPosition('a')).not.toStrictEqual(before);
    expect(visibilityOf(measured)).toStrictEqual({ r: 'visible', a: 'visible' });
  });

  it('observes again after an Activity hides and shows the canvas', () => {
    const tree = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <MindMapCanvas map={rootWithChild()} />
      </Activity>
    );
    const view = render(tree('visible'));
    const canvas = canvasObserverOf(observers());
    const disconnects = canvas.disconnectCalls;

    view.rerender(tree('hidden'));

    // Hiding destroys the canvas's effects (disconnect) and detaches every node's ref.
    expect(canvas.disconnectCalls).toBe(disconnects + 1);
    expect(canvas.observed.size).toBe(0);

    view.rerender(tree('visible'));

    expect(canvasObserverOf(observers())).toBe(canvas);
    expect(canvas.observed).toStrictEqual(new Set([mindNodeElement('r'), mindNodeElement('a')]));

    canvas.fire([borderBoxEntry(mindNodeElement('r'), 300, 32)]);

    expect(renderedPosition('a').x).toBe(300 + DEFAULT_GAP);
  });
});

describe('MindMapCanvas view', () => {
  it('clamps wheel zoom to 2 and 0.25', async () => {
    const { container } = render(<MindMapCanvas map={rootWithChild()} />);
    const pane = container.querySelector('.react-flow__pane');
    if (pane === null) throw new Error('no pane');

    fireEvent.wheel(pane, { deltaY: -100000 });
    expect(viewportTransform().zoom).toBe(2);

    fireEvent.wheel(pane, { deltaY: 100000 });
    expect(viewportTransform().zoom).toBe(0.25);

    // d3-zoom ends the wheel gesture on a 150 ms timer; let it run inside act.
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  });

  it('renders a floating root at its stored position and follows a move', () => {
    const at = (x: number) =>
      mapOf(node('r', [node('a')]), node('f', [node('fc')], { position: { x, y: 200 } }));
    const view = render(<MindMapCanvas map={at(300)} />);
    const primary = { r: renderedPosition('r'), a: renderedPosition('a') };

    expect(renderedPosition('f')).toStrictEqual({ x: 300, y: 200 });

    const child = renderedPosition('fc');

    view.rerender(<MindMapCanvas map={at(500)} />);

    expect(renderedPosition('f')).toStrictEqual({ x: 500, y: 200 });
    expect(renderedPosition('fc')).toStrictEqual({ x: child.x + 200, y: child.y });
    expect({ r: renderedPosition('r'), a: renderedPosition('a') }).toStrictEqual(primary);
  });

  it('fits every tree, including a far floating subtree, inside an 800×600 canvas', () => {
    // React Flow sizes the viewport from its zoom pane's offsetWidth/offsetHeight.
    const paneSize = (pane: number) =>
      function (this: HTMLElement) {
        return this.classList.contains('react-flow__renderer') ? pane : 0;
      };
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(paneSize(800));
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(paneSize(600));
    const primary = node('r', [node('a', [node('a1')]), node('b')]);
    const map = mapOf(
      primary,
      node('f', [node('fc', [node('fcc')])], { position: { x: 2000, y: 1000 } }),
      // A second far subtree up-left, so the bounds' minX and minY are not the primary root's.
      node('g', [node('gc')], { position: { x: -500, y: -300 } }),
    );
    const { sizes } = layoutForest(map, { direction: 'LR' });
    // The floating subtrees arrive in a rerender: the fit must use the current layout.
    const view = render(<MindMapCanvas map={mapOf(primary)} />);
    view.rerender(<MindMapCanvas map={map} />);

    fireEvent.click(screen.getByRole('button', { name: '适应画布' }));

    const { x: tx, y: ty, zoom } = viewportTransform();
    for (const [id, size] of sizes) {
      const { x, y } = renderedPosition(id);
      const left = x * zoom + tx;
      const top = y * zoom + ty;
      expect(left, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(top, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(left + size.width * zoom, `${id} right`).toBeLessThanOrEqual(800);
      expect(top + size.height * zoom, `${id} bottom`).toBeLessThanOrEqual(600);
    }
  });

  it('keeps static map nodes neither draggable nor natively selectable', () => {
    render(<MindMapCanvas map={rootWithChild()} />);
    fireEvent.click(nodeWrapper('r'));
    fireEvent.keyDown(nodeWrapper('r'), { key: 'ArrowRight' });
    fireEvent.pointerDown(screen.getByRole('region'), { button: 0 });

    for (const id of ['r', 'a']) {
      const wrapper = mindNodeElement(id).parentElement;
      expect(wrapper?.classList.contains('draggable'), `${id} draggable`).toBe(false);
      expect(wrapper?.classList.contains('selectable'), `${id} selectable`).toBe(false);
      expect(mindNodeElement(id).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('pans with a middle-button drag and not with a left-button drag', () => {
    const { container } = render(<MindMapCanvas map={rootWithChild()} />);
    const pane = container.querySelector('.react-flow__pane');
    if (pane === null) throw new Error('no pane');
    // d3-zoom follows a drag through listeners on the event's view. jsdom's MouseEvent init
    // rejects Vitest's proxied window as `view`, so the view is defined on each event.
    const mouse = (target: Element | Window, type: string, button: number, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX });
      Object.defineProperty(event, 'view', { value: window });
      fireEvent(target, event);
    };
    const drag = (button: number) => {
      mouse(pane, 'mousedown', button, 10);
      mouse(window, 'mousemove', button, 110);
      mouse(window, 'mouseup', button, 110);
    };
    const start = viewportTransform();

    drag(0);
    expect(viewportTransform()).toStrictEqual(start);

    drag(1);
    expect(viewportTransform()).toStrictEqual({ ...start, x: start.x + 100 });
  });

  it('renders from props: a changed title replaces the old one', () => {
    const view = render(<MindMapCanvas map={mapOf(node('r', [], { text: '旧标题' }))} />);

    view.rerender(<MindMapCanvas map={mapOf(node('r', [], { text: '新标题' }))} />);

    expect(screen.getByText('新标题')).toBeDefined();
    expect(screen.queryByText('旧标题')).toBeNull();
  });

  it('disables 适应画布 when nothing is laid out', () => {
    render(<MindMapCanvas map={mapOf()} />);

    expect(screen.getByRole('button', { name: '适应画布' })).toHaveProperty('disabled', true);
  });

  it('enables 适应画布 for a laid-out map', () => {
    render(<MindMapCanvas map={rootWithChild()} />);

    expect(screen.getByRole('button', { name: '适应画布' })).toHaveProperty('disabled', false);
  });
});
