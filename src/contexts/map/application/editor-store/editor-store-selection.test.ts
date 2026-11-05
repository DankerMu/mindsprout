import { describe, expect, it } from 'vitest';
import {
  ADD_C,
  collapsedMap,
  dataOf,
  DELETE_PRIMARY,
  expectTreeOpError,
  expectUnchanged,
  loaded,
  selectionOf,
  watch,
  type Store,
} from '../../../../../tests/support/editor-store';
import { errorFrom, sampleMap } from '../../../../../tests/support/map-domain';
import type { TreeOp } from '../../domain/tree-op';
import {
  createEditorStore,
  EditorStoreError,
  type EditorState,
  type EditorStoreErrorCode,
} from './editor-store';

// Design D5 / "Fixture — issue #35" and spec canvas-editing "Selection" (state semantics only):
// the selection, editing and menu slice of createEditorStore over the real History and applyOp.

// sampleMap():    r ─ p ─ (a, b)                    f1 @ (10, 20) ─ fc
// collapsedMap(): r ─ (p [collapsed] ─ (a, b), q)   f1 @ (10, 20) ─ fc ─ fcc   f2 @ (300, 200)

const DELETE_A: TreeOp = { op: 'delete_node', id: 'a' };
const DELETE_P: TreeOp = { op: 'delete_node', id: 'p' };
const DELETE_FC: TreeOp = { op: 'delete_node', id: 'fc' };
const COLLAPSE_P: TreeOp = { op: 'update_node', id: 'p', collapsed: true };

function expectStoreError(error: unknown, code: EditorStoreErrorCode): void {
  expect(error).toBeInstanceOf(EditorStoreError);
  expect((error as EditorStoreError).code).toBe(code);
}

// select(first) then toggleSelect(rest): the click-then-Shift+click path.
function clicked(store: Store, first: string, ...rest: string[]): void {
  store.getState().select(first);
  for (const id of rest) store.getState().toggleSelect(id);
}

describe('selection: click, Shift+click, rubber-band, select-all, clear', () => {
  it('starts empty after load', () => {
    expect(dataOf(loaded().getState())).toMatchObject({
      selectedIds: [],
      primaryId: null,
      editing: null,
      menuTargetId: null,
    });
  });

  it('select replaces the selection and makes the node primary', () => {
    const store = loaded();
    clicked(store, 'a', 'b');
    store.getState().select('fc');
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['fc'], primaryId: 'fc' });
  });

  it('toggleSelect adds as primary; removing the primary falls back to the last remaining id', () => {
    const store = loaded();
    clicked(store, 'a', 'b', 'fc');
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['a', 'b', 'fc'], primaryId: 'fc' });
    store.getState().toggleSelect('fc');
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['a', 'b'], primaryId: 'b' });
    store.getState().toggleSelect('a');
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['b'], primaryId: 'b' });
    store.getState().toggleSelect('b');
    expect(selectionOf(store)).toStrictEqual({ selectedIds: [], primaryId: null });
  });

  it('after selectAll, Shift+click removing a non-primary node keeps the primary', () => {
    const store = loaded();
    store.getState().select('p');
    store.getState().selectAll();
    store.getState().toggleSelect('a');
    expect(selectionOf(store)).toStrictEqual({
      selectedIds: ['r', 'p', 'b', 'f1', 'fc'],
      primaryId: 'p',
    });
  });

  it('setSelection drops duplicates keeping the first occurrence; primary is the last id', () => {
    const store = loaded();
    store.getState().setSelection(['a', 'b', 'a', 'fc']);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['a', 'b', 'fc'], primaryId: 'fc' });
    store.getState().setSelection(['b', 'a', 'b']);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['b', 'a'], primaryId: 'a' });
    store.getState().setSelection([]);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: [], primaryId: null });
  });

  it('selectAll selects exactly the visible nodes and makes the primary root primary', () => {
    const store = loaded(collapsedMap());
    store.getState().selectAll();
    expect(selectionOf(store)).toStrictEqual({
      selectedIds: ['r', 'p', 'q', 'f1', 'fc', 'fcc', 'f2'],
      primaryId: 'r',
    });
  });

  it('selectAll keeps an existing primary', () => {
    const store = loaded(collapsedMap());
    clicked(store, 'q', 'fcc');
    store.getState().selectAll();
    expect(store.getState().primaryId).toBe('fcc');
  });

  it('clearSelection empties the selection and nulls the primary', () => {
    const store = loaded();
    clicked(store, 'a', 'fc');
    store.getState().clearSelection();
    expect(selectionOf(store)).toStrictEqual({ selectedIds: [], primaryId: null });
  });

  it('openMenu sets the menu target and closeMenu clears it, the selection untouched', () => {
    const store = loaded();
    store.getState().select('a');
    store.getState().openMenu('fc');
    expect(store.getState().menuTargetId).toBe('fc');
    store.getState().closeMenu();
    expect(store.getState().menuTargetId).toBeNull();
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['a'], primaryId: 'a' });
  });
});

describe('topmostSelected', () => {
  it('after selectAll returns exactly the roots, primary then floating, in roots order', () => {
    const store = loaded(collapsedMap());
    store.getState().selectAll();
    expect(store.getState().topmostSelected()).toStrictEqual(['r', 'f1', 'f2']);
  });

  it('with a node and its grandchild selected returns only the node', () => {
    const store = loaded();
    clicked(store, 'a', 'r');
    expect(store.getState().topmostSelected()).toStrictEqual(['r']);
  });

  it('follows tree pre-order regardless of click order', () => {
    const store = loaded();
    clicked(store, 'fc', 'b', 'a');
    expect(store.getState().topmostSelected()).toStrictEqual(['a', 'b', 'fc']);
  });
});

describe('selection: unknown and hidden ids are refused', () => {
  const targeted: [string, (state: EditorState, id: string) => void][] = [
    [
      'select',
      (state, id) => {
        state.select(id);
      },
    ],
    [
      'toggleSelect',
      (state, id) => {
        state.toggleSelect(id);
      },
    ],
    [
      'setSelection',
      (state, id) => {
        state.setSelection(['q', id]);
      },
    ],
    [
      'openMenu',
      (state, id) => {
        state.openMenu(id);
      },
    ],
    [
      'startEdit',
      (state, id) => {
        state.startEdit(id);
      },
    ],
  ];

  it.each(targeted)(
    '%s with a descendant of a collapsed node → hidden-node, unchanged',
    (_n, act) => {
      const store = loaded(collapsedMap());
      clicked(store, 'q', 'fc');
      store.getState().openMenu('f2');
      const error = expectUnchanged(store, (state) => {
        act(state, 'a');
      });
      expectStoreError(error, 'hidden-node');
    },
  );

  it.each(targeted)('%s with an id not in the map → unknown-node, unchanged', (_n, act) => {
    const store = loaded(collapsedMap());
    clicked(store, 'q', 'fc');
    const error = expectUnchanged(store, (state) => {
      act(state, 'zz');
    });
    expectStoreError(error, 'unknown-node');
  });
});

describe('selection: before a map is loaded', () => {
  const actions: [string, (state: EditorState) => unknown][] = [
    [
      'select',
      (state) => {
        state.select('a');
      },
    ],
    [
      'toggleSelect',
      (state) => {
        state.toggleSelect('a');
      },
    ],
    [
      'setSelection',
      (state) => {
        state.setSelection([]);
      },
    ],
    [
      'selectAll',
      (state) => {
        state.selectAll();
      },
    ],
    [
      'clearSelection',
      (state) => {
        state.clearSelection();
      },
    ],
    [
      'openMenu',
      (state) => {
        state.openMenu('a');
      },
    ],
    [
      'closeMenu',
      (state) => {
        state.closeMenu();
      },
    ],
    ['topmostSelected', (state) => state.topmostSelected()],
    ['createNode', (state) => state.createNode('r')],
    [
      'startEdit',
      (state) => {
        state.startEdit('r');
      },
    ],
    [
      'commitTitle',
      (state) => {
        state.commitTitle('x');
      },
    ],
    [
      'cancelEdit',
      (state) => {
        state.cancelEdit();
      },
    ],
  ];

  it.each(actions)('%s throws EditorStoreError no-map and changes nothing', (_name, act) => {
    const store = createEditorStore();
    expectStoreError(expectUnchanged(store, act), 'no-map');
  });
});

describe('selection: pruned in the same update as every map change', () => {
  it('deleting the selected primary removes it and falls back to the last remaining id', () => {
    const store = loaded();
    clicked(store, 'b', 'a');
    const watcher = watch(store);
    store.getState().dispatch(DELETE_A);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['b'], primaryId: 'b' });
    expect(watcher.publications()).toBe(1);
    expect(watcher.violations).toStrictEqual([]);
  });

  it('deleting a subtree prunes its selected descendants and keeps the primary elsewhere', () => {
    const store = loaded();
    clicked(store, 'a', 'p', 'b', 'fc');
    const watcher = watch(store);
    store.getState().dispatch(DELETE_P);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['fc'], primaryId: 'fc' });
    expect(watcher.publications()).toBe(1);
    expect(watcher.violations).toStrictEqual([]);
  });

  it('collapsing a node drops its selected descendants, the collapsed node stays selected', () => {
    const store = loaded();
    clicked(store, 'p', 'fc', 'a');
    const watcher = watch(store);
    store.getState().dispatch(COLLAPSE_P);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['p', 'fc'], primaryId: 'fc' });
    expect(watcher.violations).toStrictEqual([]);
  });

  it('undo and redo prune nodes they remove', () => {
    const store = loaded();
    store.getState().dispatch(ADD_C);
    store.getState().select('c');
    const watcher = watch(store);
    store.getState().undo();
    expect(selectionOf(store)).toStrictEqual({ selectedIds: [], primaryId: null });
    store.getState().select('a');
    store.getState().dispatch(DELETE_A);
    store.getState().undo();
    store.getState().select('a');
    store.getState().redo();
    expect(selectionOf(store)).toStrictEqual({ selectedIds: [], primaryId: null });
    expect(watcher.violations).toStrictEqual([]);
  });

  it('cancelGroup and a rejected grouped op prune nodes created inside the group', () => {
    const store = loaded();
    const watcher = watch(store);
    store.getState().beginGroup('g');
    store.getState().dispatch(ADD_C);
    clicked(store, 'a', 'c');
    store.getState().cancelGroup();
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['a'], primaryId: 'a' });
    const error = errorFrom(() => {
      store.getState().runGrouped('g', () => {
        store.getState().dispatch(ADD_C);
        store.getState().toggleSelect('c');
        store.getState().dispatch(DELETE_PRIMARY);
      });
    });
    expectTreeOpError(error, 'primary-root-protected');
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['a'], primaryId: 'a' });
    expect(watcher.violations).toStrictEqual([]);
  });

  it('clears the menu target and the editing node when their node is deleted', () => {
    const store = loaded();
    store.getState().openMenu('fc');
    store.getState().startEdit('fc');
    store.getState().dispatch(DELETE_FC);
    expect(store.getState().menuTargetId).toBeNull();
    expect(store.getState().editing).toBeNull();
  });

  it('an ungrouped rejection leaves selection, editing and menu target deep-equal', () => {
    const store = loaded();
    clicked(store, 'a', 'fc');
    store.getState().openMenu('b');
    store.getState().startEdit('a');
    const error = expectUnchanged(store, (state) => {
      state.dispatch(DELETE_PRIMARY);
    });
    expectTreeOpError(error, 'primary-root-protected');
  });

  it('load clears selection, primary, editing and menu target', () => {
    const store = loaded();
    clicked(store, 'a', 'fc');
    store.getState().openMenu('b');
    store.getState().createNode('p');
    store.getState().load(sampleMap());
    expect(dataOf(store.getState())).toMatchObject({
      selectedIds: [],
      primaryId: null,
      editing: null,
      menuTargetId: null,
      groupOpen: false,
    });
  });
});
