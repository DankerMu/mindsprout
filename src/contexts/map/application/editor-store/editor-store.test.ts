import { describe, expect, it } from 'vitest';
import {
  ADD_C,
  dataOf,
  DELETE_PRIMARY,
  expectFlags,
  expectHistoryError,
  expectHistoryIntact,
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
  RENAME_A,
} from '../../../../../tests/support/editor-store';
import {
  errorFrom,
  mapOf,
  node,
  sampleMap,
  // Applies any op list in order through the checked apply helper — the expected-map oracle here.
  undo as applied,
} from '../../../../../tests/support/map-domain';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap } from '../../domain/types';
import {
  createEditorStore,
  DEFAULT_VIEWPORT,
  EditorStoreError,
  type EditorState,
  type EditorStoreErrorCode,
  type Viewport,
} from './editor-store';

// Design "Fixture — issue #12" and spec map-undo-history: the createEditorStore public API in the
// node environment over the real History and applyOp — no mocks, no DOM, no React. Expected maps
// come from the shared apply helper (applyOp directly), never from the store or History. Shared
// helpers live in tests/support/editor-store.ts; the #35 slice is tested in editor-store-*.test.ts.

const NO_MAP: EditorStoreErrorCode = 'no-map';

// sampleMap(): r ─ p ─ (a, b)          f1 @ (10, 20) ─ fc
const DELETE_FC: TreeOp = { op: 'delete_node', id: 'fc' };
const COLOR_B: TreeOp = { op: 'update_node', id: 'b', color: 'blue' };
const ADD_X: TreeOp = { op: 'add_children', parentId: 'p', children: [{ id: 'x', text: '' }] };
const NAME_X: TreeOp = { op: 'update_node', id: 'x', text: '想法' };

const EMPTY_SELECTION = { selectedIds: [], primaryId: null, editing: null, menuTargetId: null };

describe('createEditorStore: initial state and load', () => {
  it('starts without a map, without undo, at the default viewport and without a notice', () => {
    const store = createEditorStore();
    expect(DEFAULT_VIEWPORT).toStrictEqual({ x: 0, y: 0, zoom: 1 });
    expect(dataOf(store.getState())).toStrictEqual({
      map: null,
      canUndo: false,
      canRedo: false,
      groupOpen: false,
      viewport: { x: 0, y: 0, zoom: 1 },
      notice: null,
      ...EMPTY_SELECTION,
    });
  });

  it('load sets the map with an empty history, the default viewport and no notice', () => {
    const store = createEditorStore();
    store.getState().setViewport({ x: 5, y: 6, zoom: 2 });
    store.getState().showNotice('未保存到浏览器');
    const map = sampleMap();
    store.getState().load(map);
    expect(mapOfStore(store)).toBe(map);
    expect(dataOf(store.getState())).toStrictEqual({
      map: sampleMap(),
      canUndo: false,
      canRedo: false,
      groupOpen: false,
      viewport: { x: 0, y: 0, zoom: 1 },
      notice: null,
      ...EMPTY_SELECTION,
    });
  });

  it('loading another map after edits never inherits undo or redo steps', () => {
    const { store } = intact();
    // Shares node ids with sampleMap, so an inherited inverse would apply instead of failing.
    const other: MindMap = { ...mapOf(node('r', [node('p', [node('a'), node('b')])])), id: 'm2' };
    store.getState().load(other);
    expectFlags(store, false, false);
    store.getState().undo();
    expect(mapOfStore(store)).toBe(other);
    store.getState().redo();
    expect(mapOfStore(store)).toBe(other);
    expectFlags(store, false, false);
    store.getState().dispatch(COLOR_B);
    expectStep(store, 'undo', other, false, true);
  });

  it('loading a map while a group is open starts without an open group', () => {
    const store = loaded();
    store.getState().beginGroup('add node');
    store.getState().dispatch(ADD_X);
    const other: MindMap = { ...sampleMap(), id: 'm2' };
    store.getState().load(other);
    expectFlags(store, false, false, false);
    store.getState().undo();
    expect(mapOfStore(store)).toBe(other);
    store.getState().beginGroup('next');
    expectFlags(store, false, false, true);
  });
});

describe('createEditorStore: dispatch', () => {
  it('applies the op and records exactly one undo step', () => {
    const base = sampleMap();
    const afterC = applied(base, [ADD_C]);
    const store = loaded(base);
    store.getState().dispatch(ADD_C);
    expect(mapOfStore(store)).toStrictEqual(afterC);
    expectFlags(store, true, false);
    expectStep(store, 'undo', base, false, true);
    expectStep(store, 'redo', afterC, true, false);
  });

  it('an ungrouped rejection reaches the caller as the TreeOpError and changes nothing', () => {
    const setup = intact();
    setup.store.getState().setViewport({ x: 30, y: -40, zoom: 1.5 });
    setup.store.getState().showNotice('保存失败');
    const error = expectUnchanged(setup.store, (state) => {
      state.dispatch(DELETE_PRIMARY);
    });
    expectTreeOpError(error, 'primary-root-protected');
    expect(setup.store.getState().viewport).toStrictEqual({ x: 30, y: -40, zoom: 1.5 });
    expect(setup.store.getState().notice).toBe('保存失败');
    expectHistoryIntact(setup);
  });
});

describe('createEditorStore: runGrouped', () => {
  it('Grouped ops undo together: three ops form one undo step', () => {
    const base = sampleMap();
    const store = loaded(base);
    store.getState().runGrouped('multi-select', () => {
      store.getState().dispatch(DELETE_FC);
      store.getState().dispatch(COLOR_B);
      store.getState().dispatch(ADD_C);
    });
    const afterGroup = applied(base, [DELETE_FC, COLOR_B, ADD_C]);
    expect(mapOfStore(store)).toStrictEqual(afterGroup);
    expectFlags(store, true, false);
    expectStep(store, 'undo', base, false, true);
    expectStep(store, 'redo', afterGroup, true, false);
  });

  it('Rejected op cancels the group: the TreeOpError reaches the caller and history is intact', () => {
    const setup = intact();
    const { store } = setup;
    const openFlags: boolean[] = [];
    const error = errorFrom(() => {
      store.getState().runGrouped('multi-select', () => {
        store.getState().dispatch(DELETE_FC);
        store.getState().dispatch(COLOR_B);
        openFlags.push(store.getState().groupOpen);
        store.getState().dispatch(DELETE_PRIMARY);
      });
    });
    expectTreeOpError(error, 'primary-root-protected');
    expect(openFlags).toStrictEqual([true]);
    expect(mapOfStore(store)).toStrictEqual(setup.afterA);
    expectFlags(store, true, true, false);
    expectHistoryIntact(setup);
  });

  it('a plain Error thrown by fn cancels the group and is rethrown as-is', () => {
    const base = sampleMap();
    const afterA = applied(base, [RENAME_A]);
    const store = loaded(base);
    store.getState().dispatch(RENAME_A);
    const boom = new Error('boom');
    const error = errorFrom(() => {
      store.getState().runGrouped('multi-select', () => {
        store.getState().dispatch(DELETE_FC);
        store.getState().dispatch(COLOR_B);
        throw boom;
      });
    });
    expect(error).toBe(boom);
    expect(mapOfStore(store)).toStrictEqual(afterA);
    expectFlags(store, true, false, false);
    expectStep(store, 'undo', base, false, true);
  });

  it('a swallowed rejection leaves the next op ungrouped and runGrouped fails with no-group', () => {
    const base = sampleMap();
    const afterA = applied(base, [RENAME_A]);
    const store = loaded(base);
    store.getState().dispatch(RENAME_A);
    let swallowed: unknown;
    const error = errorFrom(() => {
      store.getState().runGrouped('multi-select', () => {
        store.getState().dispatch(DELETE_FC);
        swallowed = errorFrom(() => {
          store.getState().dispatch(DELETE_PRIMARY);
        });
        store.getState().dispatch(COLOR_B);
      });
    });
    expectTreeOpError(swallowed, 'primary-root-protected');
    expectHistoryError(error, 'no-group');
    expect(mapOfStore(store)).toStrictEqual(applied(afterA, [COLOR_B]));
    expectFlags(store, true, false, false);
    expectStep(store, 'undo', afterA, true, true);
    expectStep(store, 'undo', base, false, true);
  });

  it('runGrouped while a group is open fails with group-open and leaves that group untouched', () => {
    const base = sampleMap();
    const afterX = applied(base, [ADD_X]);
    const store = loaded(base);
    store.getState().beginGroup('add node');
    store.getState().dispatch(ADD_X);
    let fnRuns = 0;
    const error = expectUnchanged(store, (state) => {
      state.runGrouped('multi-select', () => {
        fnRuns += 1;
      });
    });
    expectHistoryError(error, 'group-open');
    expect(fnRuns).toBe(0);
    expect(mapOfStore(store)).toStrictEqual(afterX);
    expectFlags(store, false, false, true);
    store.getState().dispatch(NAME_X);
    store.getState().endGroup();
    expect(mapOfStore(store)).toStrictEqual(applied(afterX, [NAME_X]));
    expectFlags(store, true, false, false);
    expectStep(store, 'undo', base, false, true);
  });
});

describe('createEditorStore: explicit groups', () => {
  it('beginGroup, dispatch and endGroup mirror groupOpen and record one step', () => {
    const base = sampleMap();
    const afterA = applied(base, [RENAME_A]);
    const store = loaded(base);
    store.getState().dispatch(RENAME_A);
    store.getState().beginGroup('add node');
    expectFlags(store, true, false, true);
    store.getState().dispatch(ADD_X);
    expectFlags(store, true, false, true);
    expect(mapOfStore(store)).toStrictEqual(applied(afterA, [ADD_X]));
    expectUndoRedoRefused(store);
    expectHistoryError(
      expectUnchanged(store, (state) => {
        state.beginGroup('nested');
      }),
      'group-open',
    );
    store.getState().dispatch(NAME_X);
    expectFlags(store, true, false, true);
    store.getState().endGroup();
    expect(mapOfStore(store)).toStrictEqual(applied(afterA, [ADD_X, NAME_X]));
    expectFlags(store, true, false, false);
    expectStep(store, 'undo', afterA, true, true);
    expectStep(store, 'undo', base, false, true);
  });

  it('Cancelled group leaves no entry: cancelGroup restores the pre-group map, canRedo unchanged', () => {
    const setup = intact();
    const { store } = setup;
    store.getState().beginGroup('add node');
    store.getState().dispatch(ADD_X);
    store.getState().dispatch(NAME_X);
    expectFlags(store, true, true, true);
    store.getState().cancelGroup();
    expect(mapOfStore(store)).toStrictEqual(setup.afterA);
    expectFlags(store, true, true, false);
    expectHistoryIntact(setup);
  });

  it('endGroup and cancelGroup without an open group fail with no-group and change nothing', () => {
    const store = loaded();
    store.getState().dispatch(RENAME_A);
    expectHistoryError(
      expectUnchanged(store, (state) => {
        state.endGroup();
      }),
      'no-group',
    );
    expectHistoryError(
      expectUnchanged(store, (state) => {
        state.cancelGroup();
      }),
      'no-group',
    );
  });
});

describe('createEditorStore: rename', () => {
  it('sets the title and stamps updatedAt without an undo step', () => {
    const base = sampleMap();
    const store = loaded(base);
    store.getState().rename('新标题');
    expect(mapOfStore(store)).toStrictEqual({ ...sampleMap(), title: '新标题', updatedAt: NOW });
    expect(base.title).toBe('导图');
    expectFlags(store, false, false);
  });

  it('undo and redo after a rename keep the new title and the redo stack survives it', () => {
    const { store, base, afterB } = intact();
    store.getState().rename('新标题');
    expectFlags(store, true, true);
    expectStep(store, 'undo', { ...base, title: '新标题', updatedAt: NOW }, false, true);
    store.getState().redo();
    expectStep(store, 'redo', { ...afterB, title: '新标题', updatedAt: NOW }, true, false);
  });

  it('stamps the current time when no clock is injected', () => {
    const store = createEditorStore();
    store.getState().load(sampleMap());
    const earliest = Date.now();
    store.getState().rename('新标题');
    const latest = Date.now();
    const updatedAt = mapOfStore(store)?.updatedAt ?? '';
    expect(new Date(updatedAt).toISOString()).toBe(updatedAt);
    expect(Date.parse(updatedAt)).toBeGreaterThanOrEqual(earliest);
    expect(Date.parse(updatedAt)).toBeLessThanOrEqual(latest);
  });
});

describe('createEditorStore: viewport and notice', () => {
  it('setViewport stores the viewport as given and notices set and clear, all without a map', () => {
    const store = createEditorStore();
    const viewport: Viewport = { x: -120, y: 40, zoom: 3 };
    store.getState().setViewport(viewport);
    expect(store.getState().viewport).toBe(viewport);
    expect(store.getState().viewport).toStrictEqual({ x: -120, y: 40, zoom: 3 });
    store.getState().showNotice('主根不能删除');
    expect(store.getState().notice).toBe('主根不能删除');
    store.getState().clearNotice();
    expect(store.getState().notice).toBeNull();
    expect(store.getState().map).toBeNull();
  });
});

describe('createEditorStore: before a map is loaded', () => {
  const actions: [string, (state: EditorState) => void][] = [
    [
      'dispatch',
      (state) => {
        state.dispatch(RENAME_A);
      },
    ],
    [
      'undo',
      (state) => {
        state.undo();
      },
    ],
    [
      'redo',
      (state) => {
        state.redo();
      },
    ],
    ...GROUP_ACTIONS,
    [
      'rename',
      (state) => {
        state.rename('新标题');
      },
    ],
  ];

  it.each(actions)('%s throws EditorStoreError no-map and changes nothing', (_name, act) => {
    const store = createEditorStore();
    const error = expectUnchanged(store, act);
    expect(error).toBeInstanceOf(EditorStoreError);
    expect((error as EditorStoreError).code).toBe(NO_MAP);
  });
});

describe('createEditorStore: state objects are replaced, never mutated', () => {
  it('no action writes to the previous state object or its map', () => {
    const store = createEditorStore({ now: () => new Date(NOW) });
    const steps: ((state: EditorState) => void)[] = [
      (state) => {
        state.load(sampleMap());
      },
      (state) => {
        state.setViewport({ x: 1, y: 2, zoom: 1 });
      },
      (state) => {
        state.showNotice('保存失败');
      },
      (state) => {
        state.dispatch(RENAME_A);
      },
      (state) => {
        state.dispatch(ADD_C);
      },
      (state) => {
        state.undo();
      },
      (state) => {
        state.redo();
      },
      (state) => {
        state.beginGroup('add node');
      },
      (state) => {
        state.dispatch(ADD_X);
      },
      (state) => {
        state.endGroup();
      },
      (state) => {
        state.beginGroup('add node');
      },
      (state) => {
        state.dispatch(DELETE_FC);
      },
      (state) => {
        state.cancelGroup();
      },
      (state) => {
        state.runGrouped('color', () => {
          store.getState().dispatch(COLOR_B);
        });
      },
      (state) => {
        expectTreeOpError(
          errorFrom(() => {
            state.dispatch(DELETE_PRIMARY);
          }),
          'primary-root-protected',
        );
      },
      (state) => {
        const run = () => {
          state.runGrouped('g', () => {
            store.getState().dispatch(DELETE_PRIMARY);
          });
        };
        expectTreeOpError(errorFrom(run), 'primary-root-protected');
      },
      (state) => {
        state.rename('新标题');
      },
      (state) => {
        state.clearNotice();
      },
    ];
    expectStepsReplaceState(store, steps);
    expect(mapOfStore(store)).toStrictEqual({
      ...applied(sampleMap(), [RENAME_A, ADD_C, ADD_X, COLOR_B]),
      title: '新标题',
      updatedAt: NOW,
    });
  });
});
