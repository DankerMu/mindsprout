import { describe, expect, it } from 'vitest';
import {
  collapsedMap,
  currentMap,
  dataOf,
  DELETE_PRIMARY,
  expectFlags,
  expectHistoryError,
  expectHistoryIntact,
  expectRestored,
  expectStep,
  expectTreeOpError,
  expectStepsReplaceState,
  expectUndoRedoRefused,
  expectUnchanged,
  GROUP_ACTIONS,
  intact,
  loaded,
  mapOfStore,
  NOW,
  selectionOf,
  watch,
  type Store,
} from '../../../../../tests/support/editor-store';
import {
  idsOf,
  nodeIn,
  sampleMap,
  // Applies any op list in order through the checked apply helper — the expected-map oracle here.
  undo as applied,
} from '../../../../../tests/support/map-domain';
import type { TreeOpErrorCode } from '../../domain/errors';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap } from '../../domain/types';
import {
  createEditorStore,
  EditorStoreError,
  type Editing,
  type EditorState,
  type EditorStoreErrorCode,
} from './editor-store';

// Design D3 "Node creation is a group" / "Fixture — issue #35", specs map-undo-history "Creating a
// node is one undo step" and canvas-editing "Create child and sibling nodes", "Creation under a
// collapsed parent expands it", "Inline title editing" — through the createEditorStore public API
// with the real History and applyOp and a scripted id source (n1, n2, n3).

// sampleMap():    r ─ p ─ (a, b)                    f1 @ (10, 20) ─ fc
// collapsedMap(): r ─ (p [collapsed] ─ (a, b), q)   f1 @ (10, 20) ─ fc ─ fcc   f2 @ (300, 200)

const ADD_N1: TreeOp = { op: 'add_children', parentId: 'p', children: [{ id: 'n1', text: '' }] };
const NAME_N1: TreeOp = { op: 'update_node', id: 'n1', text: '想法' };
const EXPAND_P: TreeOp = { op: 'update_node', id: 'p', collapsed: false };
const COLOR_B: TreeOp = { op: 'update_node', id: 'b', color: 'blue' };
const CREATING_N1: Editing = { id: 'n1', created: true };

function expectStoreError(error: unknown, code: EditorStoreErrorCode): void {
  expect(error).toBeInstanceOf(EditorStoreError);
  expect((error as EditorStoreError).code).toBe(code);
}

// A selection and menu target that a creation must restore exactly when it is abandoned.
function withSelection(store: Store): void {
  store.getState().select('b');
  store.getState().toggleSelect('fc');
  store.getState().openMenu('b');
}

const abandon: [string, (state: EditorState) => void][] = [
  [
    'commitTitle("")',
    (state) => {
      state.commitTitle('');
    },
  ],
  [
    'commitTitle("   ")',
    (state) => {
      state.commitTitle('   ');
    },
  ],
  [
    'cancelEdit()',
    (state) => {
      state.cancelEdit();
    },
  ],
];

describe('createNode', () => {
  it('adds an empty child, selects it, marks it as editing and returns the injected id', () => {
    const base = sampleMap();
    const store = loaded(base);
    withSelection(store);
    expect(store.getState().createNode('p')).toBe('n1');
    expect(mapOfStore(store)).toStrictEqual(applied(base, [ADD_N1]));
    expect(dataOf(store.getState())).toMatchObject({
      selectedIds: ['n1'],
      primaryId: 'n1',
      editing: CREATING_N1,
      menuTargetId: 'b',
    });
    expectFlags(store, false, false, true);
  });

  it('places the new node at the given index', () => {
    const store = loaded();
    store.getState().createNode('p', 0);
    expect(idsOf(nodeIn(currentMap(store), 'p').children)).toStrictEqual(['n1', 'a', 'b']);
  });

  it('defaults to nanoid ids: 21 url-safe characters, distinct per node', () => {
    const store = createEditorStore();
    store.getState().load(sampleMap());
    const first = store.getState().createNode('p');
    store.getState().commitTitle('一');
    const second = store.getState().createNode('p');
    expect(first).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(second).not.toBe(first);
  });

  it('publishes the new node and its selection in one update', () => {
    const store = loaded();
    const seen: EditorState[] = [];
    store.subscribe((state) => seen.push(state));
    store.getState().createNode('p');
    const withNode = seen.filter((state) => JSON.stringify(state.map).includes('"n1"'));
    expect(withNode.map((state) => state.editing)).toStrictEqual([CREATING_N1]);
  });
});

describe('spec map-undo-history: Creating a node is one undo step', () => {
  it('Create and name is one step: one undo removes the node, one redo re-creates it named', () => {
    const setup = intact();
    const { store, afterA } = setup;
    store.getState().createNode('p');
    store.getState().commitTitle('想法');
    const named = applied(afterA, [ADD_N1, NAME_N1]);
    expect(mapOfStore(store)).toStrictEqual(named);
    expect(nodeIn(named, 'n1').text).toBe('想法');
    expect(dataOf(store.getState())).toMatchObject({
      editing: null,
      selectedIds: ['n1'],
      primaryId: 'n1',
    });
    expectFlags(store, true, false);
    store.getState().setSelection(['b', 'n1']);
    expectStep(store, 'undo', afterA, true, true);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['b'], primaryId: 'b' });
    expectStep(store, 'redo', named, true, false);
    expectStep(store, 'undo', afterA, true, true);
    expectStep(store, 'undo', setup.base, false, true);
  });

  it('commits the title exactly as typed', () => {
    const store = loaded();
    store.getState().createNode('p');
    store.getState().commitTitle('  想法 ');
    expect(nodeIn(currentMap(store), 'n1').text).toBe('  想法 ');
  });

  it.each(abandon)(
    'Abandoned node leaves no entry: %s restores map, flags and selection',
    (_n, act) => {
      const setup = intact();
      const { store } = setup;
      withSelection(store);
      const before = dataOf(store.getState());
      store.getState().createNode('p');
      act(store.getState());
      expect(dataOf(store.getState())).toStrictEqual(before);
      expectFlags(store, true, true, false);
      expectHistoryIntact(setup);
    },
  );
});

describe('createNode on a collapsed parent', () => {
  it('expands the parent and adds the third child inside the creation group', () => {
    const store = loaded(collapsedMap());
    store.getState().createNode('p');
    const map = currentMap(store);
    expect(map).toStrictEqual(applied(collapsedMap(), [EXPAND_P, ADD_N1]));
    expect(nodeIn(map, 'p').collapsed).toBeUndefined();
    expect(idsOf(nodeIn(map, 'p').children)).toStrictEqual(['a', 'b', 'n1']);
    expect(store.getState().editing).toStrictEqual(CREATING_N1);
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['n1'], primaryId: 'n1' });
  });

  it('one undo after naming removes the child and collapses the parent again', () => {
    const store = loaded(collapsedMap());
    store.getState().createNode('p');
    store.getState().commitTitle('x');
    expectStep(store, 'undo', collapsedMap(), false, true);
    expect(nodeIn(currentMap(store), 'p').collapsed).toBe(true);
  });

  it('cancelEdit collapses the parent again and leaves no entry', () => {
    const setup = intact(collapsedMap());
    const { store, afterA } = setup;
    store.getState().createNode('p');
    store.getState().cancelEdit();
    expect(mapOfStore(store)).toStrictEqual(afterA);
    expect(nodeIn(currentMap(store), 'p').collapsed).toBe(true);
    expectFlags(store, true, true);
    expectHistoryIntact(setup);
  });
});

describe('createNode: rejected ops leave everything as before', () => {
  const rejected: [string, () => MindMap, string, number | undefined, TreeOpErrorCode][] = [
    ['unknown parent', sampleMap, 'zz', undefined, 'unknown-node'],
    ['index out of range', sampleMap, 'p', 3, 'invalid-target'],
    ['index out of range on a collapsed parent', collapsedMap, 'p', 9, 'invalid-target'],
  ];

  it.each(rejected)(
    '%s → TreeOpError, state deep-equal, group closed, history intact',
    (_n, map, parent, index, code) => {
      const setup = intact(map());
      setup.store.getState().select('fc');
      setup.store.getState().openMenu('fc');
      const error = expectRestored(setup.store, (state) => {
        if (index === undefined) state.createNode(parent);
        else state.createNode(parent, index);
      });
      expectTreeOpError(error, code);
      expect(setup.store.getState().groupOpen).toBe(false);
      expectHistoryIntact(setup);
    },
  );
});

describe('the creation group belongs to the edit', () => {
  // Every tree change but the creation's own ops is refused while the new node is being named.
  const dispatched: [string, TreeOp][] = [
    ['delete_node of the new node', { op: 'delete_node', id: 'n1' }],
    ['delete_node of its parent', { op: 'delete_node', id: 'p' }],
    [
      'replace_children on the parent',
      { op: 'replace_children', parentId: 'p', children: [{ id: 'a', text: 'A' }] },
    ],
    ['update_node collapsing the parent', { op: 'update_node', id: 'p', collapsed: true }],
    ['an unrelated colour update', COLOR_B],
    ['an op the reducer would reject', DELETE_PRIMARY],
  ];

  // intact() + a selection → createNode('p') → the refused dispatch, watched for invariant breaks.
  function refusedDuringCreation(op: TreeOp) {
    const setup = intact();
    withSelection(setup.store);
    const before = dataOf(setup.store.getState());
    setup.store.getState().createNode('p');
    const watcher = watch(setup.store);
    const error = expectUnchanged(setup.store, (state) => {
      state.dispatch(op);
    });
    expectStoreError(error, 'already-editing');
    return { setup, before, watcher };
  }

  it.each(dispatched)('dispatch of %s → already-editing; naming is one step', (_n, op) => {
    const { setup, watcher } = refusedDuringCreation(op);
    const { store, afterA, base } = setup;
    store.getState().commitTitle('x');
    expect(mapOfStore(store)).toStrictEqual(
      applied(afterA, [ADD_N1, { op: 'update_node', id: 'n1', text: 'x' }]),
    );
    expectFlags(store, true, false);
    expectStep(store, 'undo', afterA, true, true);
    expectStep(store, 'undo', base, false, true);
    expect(watcher.violations).toStrictEqual([]);
  });

  it.each(dispatched)('dispatch of %s → already-editing; cancelling leaves it intact', (_n, op) => {
    const { setup, before, watcher } = refusedDuringCreation(op);
    setup.store.getState().cancelEdit();
    expect(dataOf(setup.store.getState())).toStrictEqual(before);
    expectHistoryIntact(setup);
    expect(watcher.violations).toStrictEqual([]);
  });

  it.each(GROUP_ACTIONS)(
    '%s while creating → already-editing; commit still records one step',
    (_n, act) => {
      const base = sampleMap();
      const store = loaded(base);
      store.getState().createNode('p');
      expectStoreError(expectUnchanged(store, act), 'already-editing');
      store.getState().commitTitle('想法');
      expect(mapOfStore(store)).toStrictEqual(applied(base, [ADD_N1, NAME_N1]));
      expectStep(store, 'undo', base, false, true);
    },
  );

  it('undo and redo while creating fail with group-open and change nothing', () => {
    const store = loaded();
    store.getState().createNode('p');
    expectUndoRedoRefused(store);
  });
});

describe('editing guards', () => {
  it('createNode and startEdit while editing → already-editing, unchanged', () => {
    const store = loaded();
    store.getState().createNode('p');
    expectStoreError(
      expectUnchanged(store, (state) => state.createNode('r')),
      'already-editing',
    );
    expectStoreError(
      expectUnchanged(store, (state) => {
        state.startEdit('a');
      }),
      'already-editing',
    );
    store.getState().cancelEdit();
    store.getState().startEdit('a');
    expectStoreError(
      expectUnchanged(store, (state) => state.createNode('r')),
      'already-editing',
    );
    expectStoreError(
      expectUnchanged(store, (state) => {
        state.startEdit('b');
      }),
      'already-editing',
    );
  });

  it('commitTitle and cancelEdit without an edit → not-editing, unchanged', () => {
    const store = loaded();
    expectStoreError(
      expectUnchanged(store, (state) => {
        state.commitTitle('x');
      }),
      'not-editing',
    );
    expectStoreError(
      expectUnchanged(store, (state) => {
        state.cancelEdit();
      }),
      'not-editing',
    );
  });

  it('createNode while another group is open → group-open, unchanged, no id consumed', () => {
    const store = loaded();
    store.getState().beginGroup('g');
    expectHistoryError(
      expectUnchanged(store, (state) => state.createNode('p')),
      'group-open',
    );
    store.getState().endGroup();
    expect(store.getState().createNode('p')).toBe('n1');
  });
});

describe('rename editing (startEdit on an existing node)', () => {
  it('dispatch stays allowed and deleting the edited node prunes the edit', () => {
    const base = sampleMap();
    const store = loaded(base);
    store.getState().startEdit('a');
    const watcher = watch(store);
    store.getState().dispatch({ op: 'delete_node', id: 'a' });
    expect(mapOfStore(store)).toStrictEqual(applied(base, [{ op: 'delete_node', id: 'a' }]));
    expect(store.getState().editing).toBeNull();
    expect(watcher.publications()).toBe(1);
    expect(watcher.violations).toStrictEqual([]);
    expectStep(store, 'undo', base, false, true);
  });

  it('startEdit leaves the selection alone and opens no group', () => {
    const store = loaded();
    withSelection(store);
    store.getState().startEdit('a');
    expect(store.getState().editing).toStrictEqual({ id: 'a', created: false });
    expect(selectionOf(store)).toStrictEqual({ selectedIds: ['b', 'fc'], primaryId: 'fc' });
    expectFlags(store, false, false, false);
  });

  it('Commit a rename: a new title is exactly one undo step', () => {
    const base = sampleMap();
    const store = loaded(base);
    store.getState().startEdit('a');
    store.getState().commitTitle('新想法');
    const renamed = applied(base, [{ op: 'update_node', id: 'a', text: '新想法' }]);
    expect(mapOfStore(store)).toStrictEqual(renamed);
    expect(store.getState().editing).toBeNull();
    expectStep(store, 'undo', base, false, true);
  });

  it.each([
    [
      'unchanged text',
      (state: EditorState) => {
        state.commitTitle('A');
      },
    ],
    [
      'an empty title',
      (state: EditorState) => {
        state.commitTitle('');
      },
    ],
    [
      'a blank title',
      (state: EditorState) => {
        state.commitTitle('  ');
      },
    ],
    [
      'Escape discards',
      (state: EditorState) => {
        state.cancelEdit();
      },
    ],
  ])('%s adds no entry and keeps the text', (_n, act) => {
    const base = sampleMap();
    const store = loaded(base);
    store.getState().startEdit('a');
    act(store.getState());
    expect(mapOfStore(store)).toBe(base);
    expect(store.getState().editing).toBeNull();
    expectFlags(store, false, false);
  });

  it('Long title: a 200-character title is stored in full', () => {
    const title = '长'.repeat(200);
    const store = loaded();
    store.getState().startEdit('fc');
    store.getState().commitTitle(title);
    expect(nodeIn(currentMap(store), 'fc').text).toBe(title);
    expect(title).toHaveLength(200);
  });
});

describe('selection and editing state objects are replaced, never mutated', () => {
  it('no new action writes to the previous state object or its arrays', () => {
    const store = createEditorStore({ now: () => new Date(NOW), newId: () => 'n1' });
    const steps: ((state: EditorState) => void)[] = [
      (state) => {
        state.load(sampleMap());
      },
      (state) => {
        state.select('a');
      },
      (state) => {
        state.toggleSelect('b');
      },
      (state) => {
        state.toggleSelect('a');
      },
      (state) => {
        state.setSelection(['fc', 'b']);
      },
      (state) => {
        state.selectAll();
      },
      (state) => {
        state.openMenu('p');
      },
      (state) => state.createNode('p'),
      (state) => {
        state.cancelEdit();
      },
      (state) => state.createNode('p'),
      (state) => {
        state.commitTitle('想法');
      },
      (state) => {
        state.startEdit('a');
      },
      (state) => {
        state.commitTitle('A2');
      },
      (state) => {
        state.undo();
      },
      (state) => {
        state.closeMenu();
      },
      (state) => {
        state.clearSelection();
      },
    ];
    expectStepsReplaceState(store, steps);
    expect(mapOfStore(store)).toStrictEqual(applied(sampleMap(), [ADD_N1, NAME_N1]));
  });
});
