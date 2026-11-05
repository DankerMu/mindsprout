import { expect } from 'vitest';
import {
  createEditorStore,
  type EditorState,
} from '../../src/contexts/map/application/editor-store/editor-store';
import {
  HistoryError,
  type HistoryErrorCode,
} from '../../src/contexts/map/application/history/history';
import { TreeOpError, type TreeOpErrorCode } from '../../src/contexts/map/domain/errors';
import type { TreeOp } from '../../src/contexts/map/domain/tree-op';
import type { MindMap, MindNode, NodeId } from '../../src/contexts/map/domain/types';
import { deepFreeze, errorFrom, mapOf, node, sampleMap, undo as applied } from './map-domain';

// Shared editor-store test support (design "Fixture — issue #12" and "Fixture — issue #35"): the
// createEditorStore public API over the real History and applyOp, a fixed clock and a scripted id
// source. Expected maps come from the checked applyOp helper, never from the store or History.

export type Store = ReturnType<typeof createEditorStore>;

export const NOW = '2026-11-05T12:34:56.000Z';

// sampleMap(): r ─ p ─ (a, b)          f1 @ (10, 20) ─ fc
export const RENAME_A: TreeOp = { op: 'update_node', id: 'a', text: 'A2' };
export const ADD_C: TreeOp = {
  op: 'add_children',
  parentId: 'p',
  children: [{ id: 'c', text: 'C' }],
};
export const DELETE_PRIMARY: TreeOp = { op: 'delete_node', id: 'r' };

// r ─ (p [collapsed] ─ (a, b), q)     f1 @ (10, 20) ─ fc ─ fcc     f2 @ (300, 200)
export function collapsedMap(): MindMap {
  return mapOf(
    node('r', [node('p', [node('a'), node('b')], { collapsed: true }), node('q')]),
    node('f1', [node('fc', [node('fcc')])], { position: { x: 10, y: 20 } }),
    node('f2', [], { position: { x: 300, y: 200 } }),
  );
}

// Ids handed out by createNode in order; running out is a test bug, not a store behaviour.
function scriptedIds(...ids: NodeId[]): () => NodeId {
  const queue = [...ids];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('scripted ids exhausted');
    return next;
  };
}

export function loaded(map: MindMap = sampleMap(), newId = scriptedIds('n1', 'n2', 'n3')): Store {
  const store = createEditorStore({ now: () => new Date(NOW), newId });
  store.getState().load(map);
  return store;
}

export function mapOfStore(store: Store): MindMap | null {
  return store.getState().map;
}

export function currentMap(store: Store): MindMap {
  const { map } = store.getState();
  if (map === null) throw new Error('expected a loaded map');
  return map;
}

export function expectFlags(
  store: Store,
  canUndo: boolean,
  canRedo: boolean,
  groupOpen = false,
): void {
  const state = store.getState();
  expect({
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    groupOpen: state.groupOpen,
  }).toStrictEqual({ canUndo, canRedo, groupOpen });
}

// Runs one undo or redo and asserts the resulting map and flags.
export function expectStep(
  store: Store,
  action: 'undo' | 'redo',
  map: MindMap,
  canUndo: boolean,
  canRedo: boolean,
): void {
  store.getState()[action]();
  expect(mapOfStore(store)).toStrictEqual(map);
  expectFlags(store, canUndo, canRedo);
}

// Every data field of the state (actions are functions and cannot be cloned).
export function dataOf(state: EditorState) {
  const { map, canUndo, canRedo, groupOpen, viewport, notice } = state;
  const { selectedIds, primaryId, editing, menuTargetId } = state;
  return structuredClone({
    map,
    canUndo,
    canRedo,
    groupOpen,
    viewport,
    notice,
    selectedIds,
    primaryId,
    editing,
    menuTargetId,
  });
}

export function selectionOf(store: Store) {
  const { selectedIds, primaryId } = store.getState();
  return { selectedIds, primaryId };
}

export function expectTreeOpError(error: unknown, code: TreeOpErrorCode): void {
  expect(error).toBeInstanceOf(TreeOpError);
  expect(error).not.toBeInstanceOf(HistoryError);
  expect((error as TreeOpError).code).toBe(code);
}

export function expectHistoryError(error: unknown, code: HistoryErrorCode): void {
  expect(error).toBeInstanceOf(HistoryError);
  expect((error as HistoryError).code).toBe(code);
}

// The state is replaced only by set(): a failed action leaves the very same state object.
export function expectUnchanged(store: Store, act: (state: EditorState) => void): unknown {
  const before = store.getState();
  const snapshot = dataOf(before);
  const error = errorFrom(() => {
    act(store.getState());
  });
  expect(store.getState()).toBe(before);
  expect(dataOf(store.getState())).toStrictEqual(snapshot);
  return error;
}

// A rejection inside a group passes through intermediate states; only the data must come back.
export function expectRestored(store: Store, act: (state: EditorState) => void): unknown {
  const snapshot = dataOf(store.getState());
  const error = errorFrom(() => {
    act(store.getState());
  });
  expect(dataOf(store.getState())).toStrictEqual(snapshot);
  return error;
}

// Undo and redo while a group is open: HistoryError('group-open'), state object and data untouched.
export function expectUndoRedoRefused(store: Store): void {
  for (const action of ['undo', 'redo'] as const) {
    expectHistoryError(
      expectUnchanged(store, (state) => {
        state[action]();
      }),
      'group-open',
    );
  }
}

// The four group primitives as actions; runGrouped's fn must never run where these are refused.
export const GROUP_ACTIONS: [string, (state: EditorState) => void][] = [
  [
    'beginGroup',
    (state) => {
      state.beginGroup('g');
    },
  ],
  [
    'endGroup',
    (state) => {
      state.endGroup();
    },
  ],
  [
    'cancelGroup',
    (state) => {
      state.cancelGroup();
    },
  ],
  [
    'runGrouped',
    (state) => {
      state.runGrouped('g', () => {
        throw new Error('fn must not run when the group cannot open');
      });
    },
  ],
];

// Runs each step against a deep-frozen previous state: any in-place write throws, and the previous
// state's data must be unchanged afterwards (state is only ever replaced through set()).
export function expectStepsReplaceState(
  store: Store,
  steps: ((state: EditorState) => void)[],
): void {
  for (const step of steps) {
    const previous = store.getState();
    deepFreeze(previous);
    const snapshot = dataOf(previous);
    step(previous);
    expect(dataOf(previous)).toStrictEqual(snapshot);
  }
}

export interface Intact {
  store: Store;
  base: MindMap;
  afterA: MindMap;
  afterB: MindMap;
}

// load → dispatch a → dispatch b → undo: the map is "after a" and both canUndo and canRedo are true.
export function intact(): Intact {
  const base = sampleMap();
  const afterA = applied(base, [RENAME_A]);
  const afterB = applied(afterA, [ADD_C]);
  const store = loaded(base);
  store.getState().dispatch(RENAME_A);
  store.getState().dispatch(ADD_C);
  expectStep(store, 'undo', afterA, true, true);
  return { store, base, afterA, afterB };
}

// One redo and then undos walk the same maps as a path on which nothing was ever rejected.
export function expectHistoryIntact({ store, base, afterA, afterB }: Intact): void {
  expectStep(store, 'redo', afterB, true, false);
  expectStep(store, 'undo', afterA, true, true);
  expectStep(store, 'undo', base, false, true);
}

// Test oracle for "visible", written independently of selection.ts: a node is visible when no
// ancestor is collapsed (the collapsed node itself stays visible).
function visibleOracle(map: MindMap): Set<NodeId> {
  const visible = new Set<NodeId>();
  const walk = (nodes: readonly MindNode[]): void => {
    for (const current of nodes) {
      visible.add(current.id);
      if (current.collapsed !== true) walk(current.children);
    }
  };
  walk(map.roots);
  return visible;
}

function existingOracle(map: MindMap): Set<NodeId> {
  const ids = new Set<NodeId>();
  const walk = (nodes: readonly MindNode[]): void => {
    for (const current of nodes) {
      ids.add(current.id);
      walk(current.children);
    }
  };
  walk(map.roots);
  return ids;
}

// Governing invariant of issue #35, checked on EVERY state the store publishes (so a pruning done
// in a later set() than the map change shows up as a violation): selection ids exist and are
// visible, primary is one of them, editing and menu target reference existing nodes.
function violationsOf(state: EditorState): string[] {
  const { map, selectedIds, primaryId, editing, menuTargetId } = state;
  if (map === null) return [];
  const visible = visibleOracle(map);
  const existing = existingOracle(map);
  const violations = selectedIds
    .filter((id) => !visible.has(id))
    .map((id) => `selected ${id} not visible`);
  if (primaryId !== null && !selectedIds.includes(primaryId))
    violations.push(`primary ${primaryId}`);
  if (primaryId === null && selectedIds.length > 0)
    violations.push('primary null with a selection');
  if (editing !== null && !existing.has(editing.id)) violations.push(`editing ${editing.id}`);
  if (menuTargetId !== null && !existing.has(menuTargetId)) violations.push(`menu ${menuTargetId}`);
  return violations;
}

// Subscribes and records every published state's violations plus the number of publications.
export function watch(store: Store): { violations: string[]; publications: () => number } {
  const violations: string[] = [];
  let count = 0;
  store.subscribe((state) => {
    count += 1;
    violations.push(...violationsOf(state));
  });
  return { violations, publications: () => count };
}
