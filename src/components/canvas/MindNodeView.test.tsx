import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow, type NodeTypes } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  borderBoxEntry,
  canvasObserverOf,
  failOnConsoleNoise,
  installControllableResizeObservers,
  mindNodeElement,
  reactFlowNodeObserverOf,
  sizedWrapperEntry,
} from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import { EditorSession } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';
import type { MindFlowNode } from './flow-elements';
import { MindMapCanvas } from './MindMapCanvas';
import { MindNodeView } from './MindNodeView';

// Seam: MindNodeView as rendered by MindMapCanvas (design "Fixture — issue #15"). Unmeasured
// React Flow node wrappers are visibility: hidden, so node content is queried by label or text.

failOnConsoleNoise();
const observers = installControllableResizeObservers();
afterEach(() => {
  vi.restoreAllMocks();
});

// r ─ c (collapsed) ─ (x1 ─ (x3, x4), x2): four descendants across two levels under c.
const COLLAPSED = mapOf(
  node(
    'r',
    [
      node(
        'c',
        [
          node('x1', [node('x3', [], { text: '孙一' }), node('x4', [], { text: '孙二' })], {
            text: '子一',
          }),
          node('x2', [], { text: '子二' }),
        ],
        { collapsed: true, text: '折叠的节点' },
      ),
    ],
    { text: '根' },
  ),
);
const HIDDEN_TITLES = ['子一', '子二', '孙一', '孙二'];

function colorClassesOf(id: string): string[] {
  return [...mindNodeElement(id).classList].filter((name) => name.startsWith('mind-node--color-'));
}

describe('MindNodeView', () => {
  it('shows the hidden descendant count of a collapsed node, display only', () => {
    render(<MindMapCanvas map={COLLAPSED} />);
    const indicator = screen.getByLabelText('已折叠 4 个节点');

    expect(indicator.textContent).toBe('4');
    for (const title of HIDDEN_TITLES) expect(screen.queryByText(title)).toBeNull();

    fireEvent.click(indicator);

    expect(screen.getByLabelText('已折叠 4 个节点').textContent).toBe('4');
    expect(screen.getByText('折叠的节点')).toBeDefined();
    for (const title of HIDDEN_TITLES) expect(screen.queryByText(title)).toBeNull();
  });

  it('shows no collapse indicator on an expanded node', () => {
    render(<MindMapCanvas map={mapOf(node('r', [node('a')]))} />);

    expect(screen.queryByLabelText(/^已折叠/)).toBeNull();
  });

  it('shows the note indicator only on a node with a note', () => {
    render(
      <MindMapCanvas map={mapOf(node('r', [node('n', [], { note: '备注内容' }), node('z')]))} />,
    );

    const indicators = screen.getAllByLabelText('有备注');

    expect(indicators).toHaveLength(1);
    expect(mindNodeElement('n').contains(indicators[0] ?? null)).toBe(true);
  });

  it('renders the title inside the mind-node box', () => {
    render(<MindMapCanvas map={mapOf(node('r', [], { text: '中心主题' }))} />);

    expect(mindNodeElement('r').contains(screen.getByText('中心主题'))).toBe(true);
  });

  it('adds mind-node--color-<token> for a color and no color class without one', () => {
    render(<MindMapCanvas map={mapOf(node('r', [node('b', [], { color: 'blue' }), node('z')]))} />);

    expect(colorClassesOf('b')).toStrictEqual(['mind-node--color-blue']);
    expect(colorClassesOf('z')).toStrictEqual([]);
  });

  it('renders target and source handles that cannot connect', () => {
    render(<MindMapCanvas map={mapOf(node('r'))} />);
    const wrapper = mindNodeElement('r').parentElement;

    const target = wrapper?.querySelector('.react-flow__handle.target');
    const source = wrapper?.querySelector('.react-flow__handle.source');

    expect(target?.classList.contains('react-flow__handle-left')).toBe(true);
    expect(source?.classList.contains('react-flow__handle-right')).toBe(true);
    expect(target?.classList.contains('connectable')).toBe(false);
    expect(source?.classList.contains('connectable')).toBe(false);
  });

  it('focuses the new title after measurement makes its initially hidden wrapper visible', () => {
    render(
      <EditorSession map={mapOf(node('r'))} repository={new RecordingRepository()}>
        <EditorView />
      </EditorSession>,
    );
    fireEvent.click(mindNodeElement('r'));
    // Browsers reject focus on visibility:hidden; jsdom does not model that boundary.
    vi.spyOn(HTMLInputElement.prototype, 'focus').mockImplementationOnce(() => undefined);
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
    const input = screen.getByLabelText<HTMLInputElement>('节点标题');
    expect(document.activeElement).not.toBe(input);
    const id = input.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (id === undefined) throw new Error('missing created node');
    const flowObserver = reactFlowNodeObserverOf(observers());
    flowObserver.fire([sizedWrapperEntry(id, 200, 0)]);
    expect(document.activeElement).not.toBe(input);
    flowObserver.fire([sizedWrapperEntry(id, 0, 32)]);
    expect(document.activeElement).not.toBe(input);
    canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement(id), 200, 32)]);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '输入中' } });
    input.setSelectionRange(1, 1);
    canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement(id), 240, 32)]);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
  });

  it('does not reselect a draft that already received focus before measurement', () => {
    render(
      <EditorSession map={mapOf(node('r'))} repository={new RecordingRepository()}>
        <EditorView />
      </EditorSession>,
    );
    fireEvent.click(mindNodeElement('r'));
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Tab' });
    const input = screen.getByLabelText<HTMLInputElement>('节点标题');
    fireEvent.change(input, { target: { value: '输入中' } });
    input.setSelectionRange(1, 1);
    const id = input.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (id === undefined) throw new Error('missing created node');
    canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement(id), 200, 32)]);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
  });
});

// Outside MindMapCanvas there is no measurement context: the node renders and measures nothing.
const STANDALONE_TYPES: NodeTypes = { mindNode: MindNodeView };
const STANDALONE_NODES: MindFlowNode[] = [
  {
    id: 'solo',
    type: 'mindNode',
    position: { x: 0, y: 0 },
    data: { text: '独立节点', color: null, hasNote: false, hiddenCount: 0 },
  },
];

describe('MindNodeView outside MindMapCanvas', () => {
  it('renders its title without registering for measurement', () => {
    render(<ReactFlow nodes={STANDALONE_NODES} nodeTypes={STANDALONE_TYPES} />);

    const element = mindNodeElement('solo');

    expect(element.textContent).toContain('独立节点');
    expect(observers().length).toBeGreaterThan(0);
    for (const instance of observers()) expect(instance.everObserved.has(element)).toBe(false);
  });
});
