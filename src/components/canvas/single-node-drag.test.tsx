import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
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
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { EditorSession, useEditorStoreApi } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';
import { MindMapCanvas } from './MindMapCanvas';

failOnConsoleNoise();
const observers = installControllableResizeObservers();
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('react-flow')
      ? new DOMRect(0, 0, 1000, 1000)
      : Element.prototype.getBoundingClientRect.call(this);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1000);
});
const MAP = mapOf(
  node('r', [node('a', [node('d')]), node('p')]),
  node('f', [], { position: { x: 500, y: 200 } }),
);

function setup() {
  let store!: StoreApi<EditorState>;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  const repository = new RecordingRepository();
  const view = render(
    <EditorSession map={MAP} repository={repository}>
      <Probe />
      <EditorView />
    </EditorSession>,
  );
  measure();
  return { store, repository, ...view };
}

function measure() {
  const ids = ['r', 'a', 'd', 'p', 'f'];
  const active = observers().filter((observer) => observer.observed.size > 0);
  canvasObserverOf(active).fire(ids.map((id) => borderBoxEntry(mindNodeElement(id), 80, 32)));
  reactFlowNodeObserverOf(active).fire(ids.map((id) => sizedWrapperEntry(id, 80, 32)));
  const pane = document.querySelector('.react-flow__pane');
  if (pane === null) throw new Error('no pane');
  mouse(pane, 'mousedown', 100, 100, 1);
  mouse(window, 'mousemove', 200, 200, 1);
  mouse(window, 'mouseup', 200, 200, 1);
}

function mouse(
  target: Element | Window,
  type: string,
  clientX: number,
  clientY: number,
  button = 0,
) {
  const viewport = viewportTransform();
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    buttons: button === 1 ? 4 : 1,
    clientX: clientX + viewport.x,
    clientY: clientY + viewport.y,
  });
  Object.defineProperty(event, 'view', { value: window });
  fireEvent(target, event);
}
function start(id: string, button = 0) {
  const position = renderedPosition(id);
  mouse(nodeWrapper(id), 'mousedown', position.x + 20, position.y + 10, button);
  return position;
}
function move(x: number, y: number) {
  mouse(window, 'mousemove', x, y);
}
function stop(x: number, y: number) {
  mouse(window, 'mouseup', x, y);
}

describe('controlled single-node drag through the editor', () => {
  it('previews only the grabbed node, selects it, then detaches with one undo step', () => {
    const { store } = setup();
    act(() => {
      store.getState().select('p');
    });
    const before = store.getState().map;
    const other = renderedPosition('p');
    start('a');
    move(420, 310);
    expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
    expect(renderedPosition('p')).toStrictEqual(other);
    expect(store.getState().selectedIds).toStrictEqual(['a']);
    expect(store.getState().map).toBe(before);
    expect(store.getState().canUndo).toBe(false);
    stop(420, 310);
    expect(store.getState().map?.roots.at(-1)).toStrictEqual(
      node('a', [node('d')], { position: { x: 400, y: 300 } }),
    );
    fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
    expect(store.getState().map).toStrictEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each([
    ['a', 'd'],
    ['r', 'f'],
    ['a', 'a'],
  ])('visibly moves %s then refuses %s without history or persistence', async (id, target) => {
    const { store, repository } = setup();
    const before = store.getState().map;
    const destination = renderedPosition(target);
    const origin = start(id);
    move(420, 310);
    expect(renderedPosition(id)).not.toStrictEqual(origin);
    move(destination.x + 10, destination.y + 10);
    stop(destination.x + 10, destination.y + 10);
    expect(renderedPosition(id)).toStrictEqual(origin);
    expect(store.getState().map).toBe(before);
    expect(store.getState().canUndo).toBe(false);
    await act(() => store.getState().flush());
    expect(repository.puts).toStrictEqual([]);
  });

  it.each(['undo', 'delete', 'layout', 'escape', 'pointercancel', 'blur'] as const)(
    'cancels a moving preview on %s without reverting newer state',
    (reason) => {
      const { store } = setup();
      act(() => {
        store.getState().dispatch({ op: 'update_node', id: 'p', text: 'Changed' });
      });
      const origin = start('a');
      move(420, 310);
      expect(renderedPosition('a')).not.toStrictEqual(origin);
      if (reason === 'undo')
        act(() => {
          store.getState().undo();
        });
      if (reason === 'delete')
        act(() => {
          store.getState().dispatch({ op: 'delete_node', id: 'a' });
        });
      if (reason === 'layout')
        canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement('r'), 100, 32)]);
      if (reason === 'escape') fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
      if (reason === 'pointercancel') fireEvent.pointerCancel(window);
      if (reason === 'blur') fireEvent.blur(window);
      const current = store.getState().map;
      stop(420, 310);
      expect(store.getState().map).toBe(current);
      if (reason !== 'delete') expect(renderedPosition('a')).not.toStrictEqual({ x: 400, y: 300 });
    },
  );

  it('keeps a cancelled preview discarded after committing an unchanged title', () => {
    const { store } = setup();
    act(() => {
      store.getState().dispatch({ op: 'update_node', id: 'p', text: 'Changed' });
    });
    const before = store.getState().map;
    const origin = start('a');
    move(420, 310);
    expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
    fireEvent.keyDown(screen.getByRole('region'), { key: 'F2' });
    expect(store.getState().editing?.id).toBe('a');
    expect(renderedPosition('a')).toStrictEqual(origin);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '节点标题' }), { key: 'Enter' });
    expect(store.getState().editing).toBeNull();
    expect(store.getState().map).toBe(before);
    expect(renderedPosition('a')).toStrictEqual(origin);
    stop(420, 310);
    expect(store.getState().map).toBe(before);
    expect(renderedPosition('a')).toStrictEqual(origin);
    expect(store.getState().canUndo).toBe(true);
    fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
    expect(store.getState().map).toStrictEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each(['multiple', 'editing', 'composition', 'space', 'middle', 'text'] as const)(
    'keeps %s gestures inert while an ordinary drag remains enabled',
    (gate) => {
      const { store } = setup();
      start('a');
      move(420, 310);
      stop(420, 310);
      expect(store.getState().canUndo).toBe(true);
      act(() => {
        store.getState().undo();
      });
      if (gate === 'multiple')
        act(() => {
          store.getState().setSelection(['a', 'p']);
        });
      if (gate === 'editing')
        act(() => {
          store.getState().startEdit('p');
        });
      if (gate === 'composition') fireEvent.compositionStart(screen.getByRole('region'));
      if (gate === 'space') fireEvent.keyDown(window, { key: ' ', code: 'Space' });
      if (gate === 'text') {
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();
      }
      const before = store.getState().map;
      const origin = start('a', gate === 'middle' ? 1 : 0);
      move(420, 310);
      stop(420, 310);
      expect(renderedPosition('a')).toStrictEqual(origin);
      expect(store.getState().map).toBe(before);
      expect(store.getState().canUndo).toBe(false);
      if (gate === 'space') fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      if (gate === 'text') document.querySelector('body > input')?.remove();
    },
  );

  it('uses the released touch pointer while retaining the grabbed top-left', () => {
    const { store } = setup();
    const origin = renderedPosition('a');
    const viewport = viewportTransform();
    const touch = (x: number, y: number) => ({
      identifier: 1,
      target: nodeWrapper('a'),
      clientX: x + viewport.x,
      clientY: y + viewport.y,
    });
    const initial = touch(origin.x + 20, origin.y + 10);
    fireEvent.touchStart(nodeWrapper('a'), { touches: [initial], changedTouches: [initial] });
    const end = touch(420, 310);
    fireEvent.touchMove(nodeWrapper('a'), { touches: [end], changedTouches: [end] });
    expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
    fireEvent.touchEnd(nodeWrapper('a'), { touches: [], changedTouches: [end] });
    expect(store.getState().map?.roots.at(-1)).toStrictEqual(
      node('a', [node('d')], { position: { x: 400, y: 300 } }),
    );
  });

  it('leaves static consumers inert and cancels an unmounted active gesture', () => {
    const staticView = render(<MindMapCanvas map={MAP} />);
    measure();
    const origin = start('a');
    move(420, 310);
    stop(420, 310);
    expect(renderedPosition('a')).toStrictEqual(origin);
    staticView.unmount();
    const { store, unmount } = setup();
    start('a');
    move(420, 310);
    expect(renderedPosition('a')).not.toStrictEqual(origin);
    const before = store.getState().map;
    const release = new MouseEvent('mouseup', { clientX: 520, clientY: 410 });
    Object.defineProperty(release, 'view', { value: window });
    unmount();
    fireEvent(window, release);
    expect(store.getState().map).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });
});
