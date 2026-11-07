import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import {
  borderBoxEntry,
  canvasObserverOf,
  failOnConsoleNoise,
  installControllableResizeObservers,
  mindNodeElement,
  nodeWrapper,
  renderedPosition,
} from '../../../tests/support/canvas';
import { mapOf, node, nodeIn } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { EditorSession, useEditorStoreApi } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';
import { MindMapCanvas } from './MindMapCanvas';

failOnConsoleNoise();
const observers = installControllableResizeObservers();
const MAP = mapOf(
  node('r', [
    node('a', [node('aa'), node('ab', [node('aba'), node('abb')])]),
    node('b', [node('ba')]),
    node('c', [node('ca')]),
  ]),
  node('f', [node('fc')], { position: { x: 700.25, y: 200.75 } }),
);
function setup() {
  let store: StoreApi<EditorState>;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  const view = render(
    <EditorSession map={MAP} repository={new RecordingRepository()}>
      <Probe />
      <EditorView />
      <button type="button">外部</button>
    </EditorSession>,
  );
  return { ...view, state: () => store.getState() };
}
function open(id: string) {
  fireEvent.contextMenu(nodeWrapper(id), { clientX: 130, clientY: 100 });
}
function item(label: string) {
  return screen.getByRole<HTMLButtonElement>('menuitem', { name: label });
}

describe('context menu through the editor', () => {
  it('preserves selection on opening and collapses only the target with one undo', () => {
    const { state } = setup();
    act(() => {
      state().setSelection(['a', 'b', 'c']);
    });
    open('a');
    expect(state().selectedIds).toEqual(['a', 'b', 'c']);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    fireEvent.click(item('折叠'));
    expect(state().map?.roots[0]?.children.map((child) => child.collapsed === true)).toEqual([
      true,
      false,
      false,
    ]);
    expect(document.querySelector('[data-id="aa"]')).toBeNull();
    expect(nodeWrapper('a').textContent).toContain('4');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(state().menuTargetId).toBeNull();
    act(() => {
      state().undo();
    });
    expect(state().map?.roots).toEqual(MAP.roots);
    expect(state().canUndo).toBe(false);
    expect(renderedPosition('aa').x).toBeGreaterThan(0);
  });
});

it('isolates modified and IME keys, then activates exactly once with plain Enter', () => {
  const { state } = setup();
  fireEvent.click(nodeWrapper('a'));
  open('a');
  const before = state().map;
  const add = item('添加子节点');
  for (const key of ['Enter', ' ', 'Delete', 'Backspace', 'z', 'a']) {
    fireEvent.keyDown(add, { key, ctrlKey: true });
  }
  expect(state().map).toBe(before);
  expect(state().editing).toBeNull();
  fireEvent.keyDown(add, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(add, { key: 'Enter', keyCode: 229 });
  expect(state().map).toBe(before);
  fireEvent.keyDown(add, { key: 'Enter' });
  expect(state().map?.roots[0]?.children[0]?.children).toHaveLength(3);
  expect(state().editing?.created).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText('节点标题'));
  fireEvent.click(add);
  expect(state().map?.roots[0]?.children[0]?.children).toHaveLength(3);
});

it.each(['r', 'f'])(
  'disables exact root operations on %s without selection or history changes',
  (id) => {
    const { state } = setup();
    act(() => {
      state().setSelection(['a', 'b']);
    });
    open(id);
    expect(item('添加兄弟节点').disabled).toBe(true);
    expect(item('脱离为浮动节点').disabled).toBe(true);
    expect(item('删除').disabled).toBe(id === 'r');
    fireEvent.click(item('添加兄弟节点'));
    fireEvent.click(item('脱离为浮动节点'));
    if (id === 'r') fireEvent.click(item('删除'));
    expect(state().map).toBe(MAP);
    expect(state().selectedIds).toEqual(['a', 'b']);
    expect(state().canUndo).toBe(false);
    fireEvent.keyDown(item('添加子节点'), { key: 'Escape' });
    expect(state().menuTargetId).toBeNull();
    expect(state().selectedIds).toEqual(['a', 'b']);
    expect(document.activeElement).toBe(screen.getByRole('region'));
  },
);

it.each(['添加子节点', '添加兄弟节点', '重命名'])(
  'focuses the input for %s and commits through the existing lifecycle',
  (label) => {
    const { state } = setup();
    act(() => {
      state().setSelection(['a', 'b', 'c']);
    });
    open('b');
    fireEvent.click(item(label));
    const input = screen.getByLabelText<HTMLInputElement>('节点标题');
    expect(document.activeElement).toBe(input);
    expect(state().menuTargetId).toBeNull();
    if (label === '重命名') expect(state().selectedIds).toEqual(['a', 'b', 'c']);
    const id = state().editing?.id;
    fireEvent.change(input, { target: { value: '菜单输入' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const map = state().map;
    if (map === null) throw new Error('missing map');
    const children = nodeIn(map, 'r').children;
    if (label === '添加兄弟节点')
      expect(children.map((child) => child.id)).toEqual(['a', 'b', id, 'c']);
    if (label === '添加子节点')
      expect(children[1]?.children.map((child) => child.text)).toEqual(['BA', '菜单输入']);
    if (label === '重命名')
      expect(children.map((child) => child.text)).toEqual(['A', '菜单输入', 'C']);
    act(() => {
      state().undo();
    });
    expect(state().map?.roots).toEqual(MAP.roots);
    expect(state().canUndo).toBe(false);
  },
);

it.each(['a', 'f'])('deletes using selected versus unselected target %s', (id) => {
  const { state } = setup();
  act(() => {
    state().setSelection(['a', 'b', 'c']);
  });
  open(id);
  fireEvent.click(item('删除'));
  expect(state().map?.roots[0]?.children.map((child) => child.id)).toEqual(
    id === 'a' ? [] : ['a', 'b', 'c'],
  );
  expect(state().map?.roots.map((root) => root.id)).toEqual(id === 'a' ? ['r', 'f'] : ['r']);
  act(() => {
    state().undo();
  });
  expect(state().map?.roots).toEqual(MAP.roots);
  expect(state().canUndo).toBe(false);
});

it('detaches at the rendered target position and ignores other selected nodes', () => {
  const { state } = setup();
  act(() => {
    state().setSelection(['a', 'b', 'c']);
  });
  const position = renderedPosition('b');
  open('b');
  fireEvent.click(item('脱离为浮动节点'));
  expect(state().map?.roots.at(-1)).toEqual({ ...nodeIn(MAP, 'b'), position });
  expect(renderedPosition('b')).toEqual(position);
  act(() => {
    state().undo();
  });
  expect(state().map?.roots).toEqual(MAP.roots);
  expect(state().canUndo).toBe(false);
});

it('navigates enabled items, activates with Space once and expands without reordering descendants', () => {
  const { state } = setup();
  const order = ['aa', 'ab', 'aba', 'abb'].map((id) => renderedPosition(id));
  open('r');
  fireEvent.keyDown(item('添加子节点'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(item('折叠'));
  fireEvent.keyDown(item('折叠'), { key: 'Home' });
  expect(document.activeElement).toBe(item('添加子节点'));
  fireEvent.keyDown(item('添加子节点'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(item('重命名'));
  fireEvent.keyDown(item('重命名'), { key: 'Tab' });
  expect(state().map).toBe(MAP);
  open('a');
  fireEvent.keyDown(item('添加子节点'), { key: 'End' });
  expect(document.activeElement).toBe(item('脱离为浮动节点'));
  fireEvent.keyDown(item('脱离为浮动节点'), { key: 'ArrowUp' });
  const collapse = item('折叠');
  fireEvent.keyDown(collapse, { key: ' ', repeat: true });
  expect(state().map).toBe(MAP);
  fireEvent.keyDown(collapse, { key: ' ' });
  fireEvent.keyUp(collapse, { key: ' ' });
  open('a');
  fireEvent.click(item('展开'));
  expect(['aa', 'ab', 'aba', 'abb'].map((id) => renderedPosition(id))).toEqual(order);
});

it('dismisses outside without consuming the intended node selection', () => {
  const { state } = setup();
  fireEvent.click(nodeWrapper('a'));
  open('a');
  fireEvent.pointerDown(nodeWrapper('c'));
  fireEvent.click(nodeWrapper('c'));
  expect(state().selectedIds).toEqual(['c']);
  expect(state().map).toBe(MAP);
  expect(state().canUndo).toBe(false);
  expect(screen.queryByRole('menu')).toBeNull();
});

it.each(['replacement', 'hidden', 'removed', 'editing'])(
  'invalidates stale %s ownership before an old action can mutate',
  (reason) => {
    const { state } = setup();
    open('aa');
    const stale = item('删除');
    act(() => {
      if (reason === 'replacement') state().load({ ...MAP, id: 'another' });
      if (reason === 'hidden') state().dispatch({ op: 'update_node', id: 'a', collapsed: true });
      if (reason === 'removed') state().dispatch({ op: 'delete_node', id: 'aa' });
      if (reason === 'editing') state().startEdit('b');
    });
    const before = state().map;
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(stale);
    expect(state().map).toBe(before);
    expect(state().menuTargetId).toBeNull();
  },
);

it('keeps native context menus during title editing and composition', () => {
  const { state } = setup();
  const canvas = screen.getByRole('region');
  fireEvent.compositionStart(canvas);
  expect(fireEvent.contextMenu(nodeWrapper('a'))).toBe(true);
  fireEvent.compositionEnd(canvas);
  fireEvent.doubleClick(nodeWrapper('b'));
  const input = screen.getByLabelText('节点标题');
  expect(fireEvent.contextMenu(input)).toBe(true);
  expect(fireEvent.contextMenu(nodeWrapper('a'))).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(state().map).toBe(MAP);
});

it('closes its owned menu on unmount and leaves no history', () => {
  const { state, unmount } = setup();
  open('a');
  unmount();
  expect(state().menuTargetId).toBeNull();
  expect(state().canUndo).toBe(false);
});

it('keeps pointer events inside the menu from starting canvas gestures', () => {
  const { state } = setup();
  fireEvent.click(nodeWrapper('a'));
  open('a');
  const menu = screen.getByRole('menu');
  fireEvent.pointerDown(menu, { button: 0 });
  fireEvent.mouseDown(menu, { button: 0 });
  fireEvent.keyUp(menu, { key: ' ' });
  expect(fireEvent.contextMenu(menu)).toBe(false);
  expect(state().selectedIds).toEqual(['a']);
  expect(state().map).toBe(MAP);
  expect(screen.getByRole('menu')).toBe(menu);
  fireEvent.keyDown(item('添加子节点'), { key: 'Escape' });
});

it('rejects an old activation against live store changes before React renders', () => {
  const { state } = setup();
  open('a');
  const stale = item('脱离为浮动节点');
  act(() => {
    state().dispatch({ op: 'update_node', id: 'b', text: '更新' });
    const replacement = state().map;
    fireEvent.click(stale);
    expect(state().map).toBe(replacement);
  });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(state().map?.roots.map((root) => root.id)).toEqual(['r', 'f']);
  act(() => {
    state().undo();
  });
  expect(state().canUndo).toBe(false);
});

it('invalidates layout replacement and leaves a newer menu owned by its own target', () => {
  const { state } = setup();
  open('a');
  const stale = item('删除');
  canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement('a'), 210.25, 34.5)]);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(state().menuTargetId).toBeNull();
  open('b');
  fireEvent.click(stale);
  expect(state().menuTargetId).toBe('b');
  expect(state().map).toBe(MAP);
  expect(item('删除')).toBeDefined();
});

it('retains native context menus on static canvases and focused text fields', () => {
  const staticView = render(<MindMapCanvas map={MAP} />);
  expect(fireEvent.contextMenu(nodeWrapper('a'))).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();
  staticView.unmount();
  const { state } = setup();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  expect(fireEvent.contextMenu(nodeWrapper('a'))).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(state().map).toBe(MAP);
  input.remove();
});

it('keeps an edge-positioned menu reachable within the viewport', () => {
  setup();
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu'
        ? new DOMRect(0, 0, 240, 280)
        : Element.prototype.getBoundingClientRect.call(this);
    });
  try {
    fireEvent.contextMenu(nodeWrapper('a'), {
      clientX: window.innerWidth - 1,
      clientY: window.innerHeight - 1,
    });
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe(`${(window.innerWidth - 240).toString()}px`);
    expect(menu.style.top).toBe(`${(window.innerHeight - 280).toString()}px`);
    expect(document.activeElement).toBe(item('添加子节点'));
  } finally {
    geometry.mockRestore();
  }
});
