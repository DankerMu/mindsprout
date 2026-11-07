import { describe, expect, it } from 'vitest';
import { mapOf, node, nodeIn } from '../../../../../tests/support/map-domain';
import { createEditorStore } from '../editor-store/editor-store';
import { createMenuRegistry, nodeMenu, type MenuContext } from './menu';

const MAP = mapOf(
  node('r', [node('a', [node('aa')]), node('b'), node('c')]),
  node('f', [node('fc')], { position: { x: 700.25, y: 200.75 } }),
);
function setup(target = 'a') {
  const store = createEditorStore({ newId: () => 'new' });
  store.getState().load(MAP);
  store.getState().setSelection(['a', 'b', 'c']);
  const ctx = (): MenuContext => {
    const state = store.getState();
    if (state.map === null) throw new Error('missing map');
    return {
      target,
      map: state.map,
      selection: state.selectedIds,
      positions: new Map([['a', { x: 320.25, y: 88.75 }]]),
      actions: state,
    };
  };
  const run = (id: string) => {
    const entry = nodeMenu.list(ctx()).find((item) => item.id === id);
    if (entry === undefined) throw new Error(`missing menu item ${id}`);
    entry.run(ctx());
  };
  return { store, ctx, run };
}

describe('node menu registry', () => {
  it('lists six ordered operations with precise root enablement', () => {
    for (const [target, disabled] of [
      ['r', ['add-sibling', 'delete', 'detach']],
      ['f', ['add-sibling', 'detach']],
      ['a', []],
    ] as const) {
      const { ctx } = setup(target);
      const items = nodeMenu.list(ctx());
      expect(items.map((item) => item.label)).toEqual([
        '添加子节点',
        '添加兄弟节点',
        '重命名',
        '删除',
        '折叠',
        '脱离为浮动节点',
      ]);
      expect(items.filter((item) => !item.isEnabled(ctx())).map((item) => item.id)).toEqual(
        disabled,
      );
    }
  });
  it('registers ordered extensions that execute real store operations', () => {
    const registry = createMenuRegistry();
    const { ctx, store } = setup();
    registry.register({
      id: 'grow',
      label: '生长',
      isEnabled: () => true,
      run: (context) => {
        context.actions.dispatch({
          op: 'add_children',
          parentId: context.target,
          children: [{ id: 'grown', text: '芽' }],
        });
      },
    });
    expect(registry.list(ctx()).map((item) => item.id)).toEqual(['grow']);
    registry.list(ctx())[0]?.run(ctx());
    expect(store.getState().map?.roots[0]?.children[0]?.children.map((child) => child.id)).toEqual([
      'aa',
      'grown',
    ]);
    expect(() => {
      registry.register({ id: 'grow', label: '重复', isEnabled: () => true, run: () => undefined });
    }).toThrow('grow');
  });
});

it('creates after the targeted sibling, names in one group and renames only the target', () => {
  const { store, run } = setup('b');
  run('add-sibling');
  expect(store.getState().map?.roots[0]?.children.map((child) => child.id)).toEqual([
    'a',
    'b',
    'new',
    'c',
  ]);
  expect(store.getState().editing).toEqual({ id: 'new', created: true });
  store.getState().commitTitle('新兄弟');
  store.getState().undo();
  expect(store.getState().map?.roots).toEqual(MAP.roots);
  expect(store.getState().canUndo).toBe(false);
  store.getState().setSelection(['a', 'b', 'c']);
  run('rename');
  expect(store.getState().selectedIds).toEqual(['a', 'b', 'c']);
  expect(store.getState().editing).toEqual({ id: 'b', created: false });
  store.getState().commitTitle('目标');
  expect(store.getState().map?.roots[0]?.children.map((child) => child.text)).toEqual([
    'A',
    '目标',
    'C',
  ]);
});
it('expands a collapsed target inside the creation group and cancels without history', () => {
  const { store, run } = setup();
  store.getState().dispatch({ op: 'update_node', id: 'a', collapsed: true });
  const before = store.getState().map;
  run('add-child');
  expect(store.getState().map?.roots[0]?.children[0]?.collapsed).toBeUndefined();
  expect(store.getState().map?.roots[0]?.children[0]?.children.map((child) => child.id)).toEqual([
    'aa',
    'new',
  ]);
  store.getState().cancelEdit();
  expect(store.getState().map?.roots).toEqual(before?.roots);
  store.getState().undo();
  expect(store.getState().map?.roots).toEqual(MAP.roots);
  expect(store.getState().canUndo).toBe(false);
});
it.each(['a', 'f'])(
  'deletes the selected set or only unselected target %s in one undo',
  (target) => {
    const { store, run } = setup(target);
    run('delete');
    expect(store.getState().map?.roots.map((root) => root.id)).toEqual(
      target === 'a' ? ['r', 'f'] : ['r'],
    );
    expect(store.getState().map?.roots[0]?.children.map((child) => child.id)).toEqual(
      target === 'a' ? [] : ['a', 'b', 'c'],
    );
    store.getState().undo();
    expect(store.getState().map?.roots).toEqual(MAP.roots);
    expect(store.getState().canUndo).toBe(false);
  },
);
it('toggles only the target and labels expansion from the current tree', () => {
  const { store, ctx, run } = setup();
  run('collapse');
  expect(store.getState().map?.roots[0]?.children.map((child) => child.collapsed === true)).toEqual(
    [true, false, false],
  );
  expect(nodeMenu.list(ctx()).find((item) => item.id === 'collapse')?.label).toBe('展开');
  run('collapse');
  expect(store.getState().map?.roots[0]?.children[0]?.collapsed).toBeUndefined();
  store.getState().undo();
  store.getState().undo();
  expect(store.getState().map?.roots).toEqual(MAP.roots);
});
it('detaches at the exact fractional layout position and restores parent index and subtree', () => {
  const { store, run } = setup();
  run('detach');
  expect(store.getState().groupOpen).toBe(false);
  expect(store.getState().map?.roots.at(-1)).toEqual({
    ...nodeIn(MAP, 'a'),
    position: { x: 320.25, y: 88.75 },
  });
  expect(store.getState().map?.roots[0]?.children.map((child) => child.id)).toEqual(['b', 'c']);
  store.getState().undo();
  expect(store.getState().map?.roots).toEqual(MAP.roots);
  expect(store.getState().canUndo).toBe(false);
});
it('refuses protected roots, missing positions and missing or hidden targets without mutations', () => {
  for (const target of ['r', 'f', 'missing', 'aa']) {
    const { store, ctx } = setup(target);
    store.getState().dispatch({ op: 'update_node', id: 'a', collapsed: true });
    const before = store.getState();
    for (const entry of nodeMenu.list(ctx())) {
      if (!entry.isEnabled(ctx()) || target === 'missing' || target === 'aa') entry.run(ctx());
    }
    expect(store.getState()).toBe(before);
  }
  const { store, ctx } = setup('b');
  const before = store.getState();
  nodeMenu
    .list(ctx())
    .find((entry) => entry.id === 'detach')
    ?.run(ctx());
  expect(store.getState()).toBe(before);
});
