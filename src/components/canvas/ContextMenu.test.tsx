import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
function setup(map = MAP) {
  let store: StoreApi<EditorState>;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  const view = render(
    <EditorSession map={map} repository={new RecordingRepository()}>
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

it('applies blue to the complete nested selection in one undoable history group', () => {
  const initial = mapOf(
    node('r', [
      node('a', [node('aa'), node('ab', [], { color: 'green' })], { color: 'red' }),
      node('b', [], { color: 'purple' }),
      node('c', [], { color: 'orange' }),
    ]),
  );
  const before = structuredClone(initial);
  const { state } = setup(initial);
  act(() => {
    state().setSelection(['a', 'aa', 'b']);
  });
  open('a');
  expect(state().canUndo).toBe(false);
  fireEvent.click(item('设置颜色'));
  expect(state().map).toStrictEqual(before);
  expect(state().canUndo).toBe(false);
  fireEvent.click(item('blue'));

  expect(state().map).toStrictEqual(
    mapOf(
      node('r', [
        node('a', [node('aa', [], { color: 'blue' }), node('ab', [], { color: 'green' })], {
          color: 'blue',
        }),
        node('b', [], { color: 'blue' }),
        node('c', [], { color: 'orange' }),
      ]),
    ),
  );
  expect(state().selectedIds).toEqual(['a', 'aa', 'b']);
  expect(state().canUndo).toBe(true);
  expect(state().groupOpen).toBe(false);
  expect(screen.queryByRole('menu')).toBeNull();
  act(() => {
    state().undo();
  });
  expect(state().map).toStrictEqual(before);
  expect(state().canUndo).toBe(false);
  expect(state().canRedo).toBe(true);
});

it('owns submenu keyboard focus without dispatching or adding history', () => {
  const { state } = setup();
  open('a');
  const trigger = item('设置颜色');
  trigger.focus();

  for (const back of ['ArrowLeft', 'Escape']) {
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const child = screen.getByRole('menu', { name: '设置颜色' });
    const red = within(child).getByRole('menuitem', { name: 'red' });
    const orange = within(child).getByRole('menuitem', { name: 'orange' });
    const clear = within(child).getByRole('menuitem', { name: '无颜色' });
    expect(document.activeElement).toBe(red);
    fireEvent.keyDown(red, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(orange);
    fireEvent.keyDown(orange, { key: 'End' });
    expect(document.activeElement).toBe(clear);
    fireEvent.keyDown(clear, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(red);
    expect(state().map).toBe(MAP);
    expect(state().canUndo).toBe(false);

    fireEvent.keyDown(red, { key: back });
    expect(screen.queryByRole('menu', { name: '设置颜色' })).toBeNull();
    expect(screen.getByRole('menu', { name: '节点菜单' })).toBeDefined();
    expect(document.activeElement).toBe(trigger);
    expect(state().menuTargetId).toBe('a');
    expect(state().map).toBe(MAP);
    expect(state().canUndo).toBe(false);
    expect(state().groupOpen).toBe(false);
  }

  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('region'));
  expect(state().menuTargetId).toBeNull();
  expect(state().map).toBe(MAP);
  expect(state().canUndo).toBe(false);
});

it('clears mixed nested colors in one reversible history entry', () => {
  const initial = mapOf(
    node('r', [
      node('a', [node('aa', [], { color: 'purple' })], { color: 'red' }),
      node('b'),
      node('c', [], { color: 'orange' }),
    ]),
  );
  const cleared = mapOf(
    node('r', [node('a', [node('aa')]), node('b'), node('c', [], { color: 'orange' })]),
  );
  const { state } = setup(initial);
  act(() => {
    state().setSelection(['a', 'aa', 'b']);
  });
  open('a');
  fireEvent.click(item('设置颜色'));
  fireEvent.click(item('无颜色'));
  expect(state().map).toStrictEqual(cleared);
  expect(state().selectedIds).toEqual(['a', 'aa', 'b']);
  expect(state().canUndo).toBe(true);
  expect(state().groupOpen).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(state().map).toStrictEqual(initial);
  expect(state().canUndo).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '重做' }));
  expect(state().map).toStrictEqual(cleared);
  expect(state().canRedo).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(state().map).toStrictEqual(initial);
  expect(state().canUndo).toBe(false);
});

it('colors unselected primary and floating roots without replacing the selection', () => {
  const root = node('r', [node('a', [], { color: 'red' }), node('b')]);
  const floating = node('f', [node('fc')], { position: { x: 700, y: 200 } });
  const initial = mapOf(root, floating);
  const { state } = setup(initial);
  act(() => {
    state().setSelection(['a', 'b']);
  });
  for (const [id, expected] of [
    ['r', mapOf({ ...root, color: 'purple' }, floating)],
    ['f', mapOf(root, { ...floating, color: 'purple' })],
  ] as const) {
    open(id);
    fireEvent.click(item('设置颜色'));
    fireEvent.click(item('purple'));
    expect(state().map).toStrictEqual(expected);
    expect(state().selectedIds).toEqual(['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(state().map).toStrictEqual(initial);
    expect(state().canUndo).toBe(false);
  }
});

it('uses the selection at child activation rather than submenu opening', () => {
  const initial = mapOf(node('r', [node('a', [node('aa')]), node('b'), node('c')]));
  const { state } = setup(initial);
  act(() => {
    state().setSelection(['a', 'b']);
  });
  open('a');
  fireEvent.click(item('设置颜色'));
  const blue = item('blue');
  act(() => {
    state().setSelection(['a', 'aa', 'c']);
    fireEvent.click(blue);
  });
  expect(state().map).toStrictEqual(
    mapOf(
      node('r', [
        node('a', [node('aa', [], { color: 'blue' })], { color: 'blue' }),
        node('b'),
        node('c', [], { color: 'blue' }),
      ]),
    ),
  );
  expect(state().selectedIds).toEqual(['a', 'aa', 'c']);
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(state().map).toStrictEqual(initial);
  expect(state().canUndo).toBe(false);
});

it.each(['map replacement', 'editing', 'new target'])(
  'refuses a stale color child after %s before React renders',
  (reason) => {
    const { state } = setup();
    open('a');
    fireEvent.click(item('设置颜色'));
    const stale = item('blue');
    act(() => {
      if (reason === 'map replacement') state().load({ ...MAP, id: 'replacement' });
      if (reason === 'editing') state().startEdit('b');
      if (reason === 'new target') state().openMenu('b');
      const before = state();
      fireEvent.click(stale);
      expect(state()).toBe(before);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(state().canUndo).toBe(false);
    expect(state().groupOpen).toBe(false);
    if (reason === 'new target') expect(state().menuTargetId).toBe('b');
  },
);

it('isolates child input gates, activates Space once and dismisses both levels outside', () => {
  const { state } = setup();
  open('a');
  item('设置颜色').focus();
  fireEvent.keyDown(item('设置颜色'), { key: 'Enter' });
  const red = item('red');
  for (const modifiers of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
  ]) {
    fireEvent.keyDown(red, { key: 'Enter', ...modifiers });
    fireEvent.keyDown(red, { key: 'ArrowDown', ...modifiers });
    expect(document.activeElement).toBe(red);
    expect(state().map).toBe(MAP);
    expect(state().canUndo).toBe(false);
  }
  fireEvent.keyDown(red, { key: ' ' });
  fireEvent.keyUp(red, { key: ' ' });
  fireEvent.click(red);
  expect(nodeIn(state().map ?? MAP, 'a').color).toBe('red');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('region'));
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(state().map).toStrictEqual(MAP);
  expect(state().canUndo).toBe(false);

  open('a');
  item('设置颜色').focus();
  fireEvent.keyDown(item('设置颜色'), { key: ' ' });
  fireEvent.keyDown(item('red'), { key: 'Tab' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('region'));
  open('a');
  fireEvent.click(item('设置颜色'));
  const stale = item('blue');
  fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
  fireEvent.click(stale);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(state().map).toStrictEqual(MAP);
  expect(state().canUndo).toBe(false);
  expect(state().groupOpen).toBe(false);
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
  const menu = screen.getByRole('menu', { name: '节点菜单' });
  const enabled = within(menu)
    .getAllByRole<HTMLButtonElement>('menuitem')
    .filter((button) => !button.disabled && button.closest('[role="menu"]') === menu);
  expect(enabled.length).toBeGreaterThan(1);
  item('添加子节点').focus();
  fireEvent.keyDown(item('添加子节点'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(enabled.at(-1));
  item('重命名').focus();
  fireEvent.keyDown(item('重命名'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(item('添加子节点'));
  item('折叠').focus();
  fireEvent.keyDown(item('折叠'), { key: 'Home' });
  expect(document.activeElement).toBe(item('添加子节点'));
  fireEvent.keyDown(item('添加子节点'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(item('重命名'));
  fireEvent.keyDown(item('重命名'), { key: 'Tab' });
  expect(state().map).toBe(MAP);
  open('a');
  fireEvent.keyDown(item('添加子节点'), { key: 'End' });
  expect(document.activeElement).toBe(item('脱离为浮动节点'));
  const collapse = item('折叠');
  collapse.focus();
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
