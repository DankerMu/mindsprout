import { describe, expect, it } from 'vitest';
import {
  apply,
  deepFreeze,
  entryIn,
  errorFrom,
  idsOf,
  mapOf,
  node,
  nodeIn,
  rejection,
  // Applies any op list in order through the checked apply helper — the expected-map oracle here.
  undo as applied,
} from '../../../../../tests/support/map-domain';
import { applyOp } from '../../domain/apply-op';
import { createMindMap } from '../../domain/create-mind-map';
import { TreeOpError, type TreeOpErrorCode } from '../../domain/errors';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap } from '../../domain/types';
import {
  GroupCancelledError,
  History,
  HISTORY_LIMIT,
  HistoryError,
  type HistoryEntry,
  type HistoryErrorCode,
} from './history';

// Spec map-undo-history (tasks 2.1, 2.2) and design "Fixture — issue #6" / "#7": the History public
// API over the real applyOp and maps from createMindMap / mapOf — no mocked reducer. Deep-frozen (so
// a write throws): groupMap(), every map handed to the shared apply helper as input, and every map
// dispatchAll returns. Not frozen: seed() output, undo/redo and single-dispatch results, foreign
// maps. Results are asserted by value; expected maps come from the apply helper, never History.

// r("root") ─ n("A")
function seed(): MindMap {
  const empty = createMindMap({
    id: 'm1',
    rootId: 'r',
    title: '导图',
    rootText: 'root',
    now: () => new Date('2026-11-05T09:00:00.000Z'),
  });
  return apply(empty, { op: 'add_children', parentId: 'r', children: [{ id: 'n', text: 'A' }] })
    .map;
}

// One applied op, recorded the way the store will: { ops: [op], inverses: [inverse] }.
function record(map: MindMap, op: TreeOp): { map: MindMap; entry: HistoryEntry } {
  const result = apply(map, op);
  return { map: result.map, entry: { ops: [op], inverses: [result.inverse], label: op.op } };
}

function expectFlags(history: History, canUndo: boolean, canRedo: boolean): void {
  expect({ canUndo: history.canUndo, canRedo: history.canRedo }).toStrictEqual({
    canUndo,
    canRedo,
  });
}

// Shares no node id with the test maps, so every recorded inverse misses on it.
function foreignMap(): MindMap {
  return createMindMap({ id: 'm2', rootId: 'q', title: 't', rootText: 'q' });
}

const RENAME: TreeOp = { op: 'update_node', id: 'n', text: 'B' };

// Seed → push the rename → undo it, asserting the flags after each step.
function renameThenUndo(history: History): { renamed: MindMap; undone: MindMap } {
  const renamed = record(seed(), RENAME);
  history.push(renamed.entry);
  expectFlags(history, true, false);
  const undone = history.undo(renamed.map);
  expectFlags(history, false, true);
  return { renamed: renamed.map, undone };
}

// r ─ p ─ (a, m, b)        f1 @ (10, 20) ─ fc        f2 @ (300, 200) ─ (g1, g2)
//   └ q ─ c
function groupMap(): MindMap {
  const map = mapOf(
    node('r', [node('p', [node('a'), node('m'), node('b')]), node('q', [node('c')])]),
    node('f1', [node('fc')], { position: { x: 10, y: 20 } }),
    node('f2', [node('g1'), node('g2')], { position: { x: 300, y: 200 } }),
  );
  deepFreeze(map);
  return map;
}

// Dispatches every op into the open group and returns the resulting (deep-frozen) map.
function dispatchAll(history: History, map: MindMap, ops: readonly TreeOp[]): MindMap {
  return ops.reduce((current, op) => {
    const next = history.dispatch(current, op);
    deepFreeze(next);
    return next;
  }, map);
}

function runGroup(history: History, map: MindMap, label: string, ops: readonly TreeOp[]): MindMap {
  history.beginGroup(label);
  const after = dispatchAll(history, map, ops);
  history.endGroup();
  return after;
}

function expectState(history: History, canUndo: boolean, canRedo: boolean, groupOpen: boolean) {
  expectFlags(history, canUndo, canRedo);
  expect(history.groupOpen).toBe(groupOpen);
}

function expectHistoryError(fn: () => unknown, code: HistoryErrorCode): void {
  const error = errorFrom(fn);
  expect(error).toBeInstanceOf(HistoryError);
  expect((error as HistoryError).code).toBe(code);
}

function expectTreeOpError(fn: () => unknown, code: TreeOpErrorCode): void {
  const error = errorFrom(fn);
  expect(error).toBeInstanceOf(TreeOpError);
  expect(error).not.toBeInstanceOf(HistoryError);
  expect((error as TreeOpError).code).toBe(code);
}

const EARLIER: TreeOp = { op: 'update_node', id: 'a', text: 'A1' };
const UNDONE: TreeOp = { op: 'update_node', id: 'a', color: 'red' };
const ADD_X: TreeOp = { op: 'add_children', parentId: 'p', children: [{ id: 'x', text: '' }] };
const NAME_X: TreeOp = { op: 'update_node', id: 'x', text: '想法' };
const DELETE_PRIMARY: TreeOp = { op: 'delete_node', id: 'r' };

interface Stacked {
  history: History;
  base: MindMap;
  current: MindMap;
  redone: MindMap;
}

// past = [EARLIER], future = [UNDONE]; `current` is the map after EARLIER.
function stacked(): Stacked {
  const history = new History();
  const base = groupMap();
  const current = applied(base, [EARLIER]);
  const redone = applied(current, [UNDONE]);
  expect(history.dispatch(base, EARLIER)).toStrictEqual(current);
  expect(history.dispatch(current, UNDONE)).toStrictEqual(redone);
  expect(history.undo(redone)).toStrictEqual(current);
  expectState(history, true, true, false);
  return { history, base, current, redone };
}

// past is still exactly [EARLIER] and future exactly [UNDONE]: nothing was pushed, cleared or lost.
function expectStacksAsBefore({ history, base, current, redone }: Stacked): void {
  expectState(history, true, true, false);
  expect(history.redo(current)).toStrictEqual(redone);
  expect(history.undo(redone)).toStrictEqual(current);
  expect(history.undo(current)).toStrictEqual(base);
  expectState(history, false, true, false);
}

describe('History', () => {
  it('keeps at most 200 entries', () => {
    expect(HISTORY_LIMIT).toBe(200);
  });

  it('returns the identical map from undo and redo on empty stacks', () => {
    const history = new History();
    const map = seed();
    expectFlags(history, false, false);

    expect(history.undo(map)).toBe(map);
    expectFlags(history, false, false);
    expect(history.redo(map)).toBe(map);
    expectFlags(history, false, false);
  });

  it('Undo a rename: restores "A" and makes redo available', () => {
    const history = new History();
    const before = seed();
    const renamed = record(before, RENAME);

    history.push(renamed.entry);
    expectFlags(history, true, false);

    const undone = history.undo(renamed.map);
    expect(nodeIn(undone, 'n').text).toBe('A');
    expect(undone).toStrictEqual(before);
    expectFlags(history, false, true);
  });

  it('Redo after undo: the text is "B" again', () => {
    const history = new History();
    const { renamed, undone } = renameThenUndo(history);

    const redone = history.redo(undone);
    expect(nodeIn(redone, 'n').text).toBe('B');
    expect(redone).toStrictEqual(renamed);
    expectFlags(history, true, false);
  });

  it('Undo a multi-child add: one undo removes both nodes', () => {
    const history = new History();
    const before = seed();
    const added = record(before, {
      op: 'add_children',
      parentId: 'n',
      children: [
        { id: 'x', text: 'X' },
        { id: 'y', text: 'Y' },
      ],
    });
    history.push(added.entry);
    expectFlags(history, true, false);

    const undone = history.undo(added.map);
    expect(() => nodeIn(undone, 'x')).toThrow('node x is not in the map');
    expect(() => nodeIn(undone, 'y')).toThrow('node y is not in the map');
    expect(undone).toStrictEqual(before);
    expectFlags(history, false, true);

    expect(history.redo(undone)).toStrictEqual(added.map);
    expectFlags(history, true, false);
  });

  it('Branching history: pushing after an undo discards the redo stack', () => {
    const history = new History();
    const { undone } = renameThenUndo(history);

    const recoloured = record(undone, { op: 'update_node', id: 'n', color: 'green' });
    history.push(recoloured.entry);
    expectFlags(history, true, false);

    expect(history.redo(recoloured.map)).toBe(recoloured.map);
    expectFlags(history, true, false);
    expect(history.undo(recoloured.map)).toStrictEqual(undone);
    expectFlags(history, false, true);
  });

  it('Cap at 200: 201 pushes leave exactly 200 undo steps, the oldest dropped', () => {
    const history = new History();
    let map = seed();
    const states: MindMap[] = [map];
    for (let i = 1; i <= 201; i += 1) {
      const step = record(map, { op: 'update_node', id: 'n', text: `t${String(i)}` });
      map = step.map;
      states.push(map);
      history.push(step.entry);
      expectFlags(history, true, false);
    }

    for (let k = 1; k <= 200; k += 1) {
      const previous = map;
      map = history.undo(map);
      expect(map).not.toBe(previous);
      expect(map).toStrictEqual(states[201 - k]);
      expectFlags(history, k < 200, true);
    }
    expect(nodeIn(map, 'n').text).toBe('t1');

    expect(history.undo(map)).toBe(map);
    expectFlags(history, false, true);
  });

  it('undo then redo k steps walks back through every earlier state (governing invariant)', () => {
    const history = new History();
    const ops: TreeOp[] = [
      {
        op: 'add_children',
        parentId: 'r',
        children: [
          { id: 'x', text: 'X' },
          { id: 'y', text: 'Y' },
        ],
      },
      { op: 'update_node', id: 'x', text: 'X2', note: '备注' },
      { op: 'move_node', id: 'y', newParentId: 'n', index: 0 },
      { op: 'move_node', id: 'x', newParentId: null, position: { x: 100, y: 50 } },
      { op: 'set_root_position', id: 'x', position: { x: -20, y: 30 } },
      { op: 'delete_node', id: 'n' },
    ];
    let map = seed();
    const states: MindMap[] = [map];
    for (const op of ops) {
      const step = record(map, op);
      map = step.map;
      states.push(map);
      history.push(step.entry);
    }

    for (let k = ops.length - 1; k >= 0; k -= 1) {
      map = history.undo(map);
      expect(map).toStrictEqual(states[k]);
      expectFlags(history, k > 0, true);
    }
    for (let k = 1; k <= ops.length; k += 1) {
      map = history.redo(map);
      expect(map).toStrictEqual(states[k]);
      expectFlags(history, true, k < ops.length);
    }
  });

  describe('inverse application order', () => {
    // a = add_children X under r, b = update_node X: b's inverse needs X, so it must run before a's.
    function dependentEntry(): { before: MindMap; after: MindMap; entry: HistoryEntry } {
      const before = seed();
      const a: TreeOp = { op: 'add_children', parentId: 'r', children: [{ id: 'x', text: 'x' }] };
      const b: TreeOp = { op: 'update_node', id: 'x', text: 'named' };
      const first = apply(before, a);
      const second = apply(first.map, b);
      const entry: HistoryEntry = {
        ops: [a, b],
        inverses: [first.inverse, second.inverse],
        label: 'add node',
      };
      deepFreeze(entry);
      return { before, after: second.map, entry };
    }

    it('applies the inverse lists last-first (outer order) and redoes ops first-last', () => {
      const history = new History();
      const { before, after, entry } = dependentEntry();
      history.push(entry);
      expectFlags(history, true, false);

      const undone = history.undo(after);
      expect(undone).toStrictEqual(before);
      expectFlags(history, false, true);

      expect(history.redo(undone)).toStrictEqual(after);
      expectFlags(history, true, false);
    });

    it('applies each inverse list in its own order (inner order)', () => {
      const history = new History();
      const before = seed();
      const add: TreeOp = { op: 'add_children', parentId: 'r', children: [{ id: 'y', text: 'y' }] };
      const added = applyOp(before, add).map;
      // Reversed, delete_node y runs first and update_node y then throws unknown-node.
      const entry: HistoryEntry = {
        ops: [add],
        inverses: [
          [
            { op: 'update_node', id: 'y', text: 'temp' },
            { op: 'delete_node', id: 'y' },
          ],
        ],
        label: 'add node',
      };
      deepFreeze(entry);
      history.push(entry);

      const undone = history.undo(added);
      expect(undone).toStrictEqual(before);
      expectFlags(history, false, true);
      expect(history.redo(undone)).toStrictEqual(added);
      expectFlags(history, true, false);
    });

    it('never mutates a stored entry: the same frozen entry goes undo → redo → undo', () => {
      const history = new History();
      const { before, after, entry } = dependentEntry();
      const snapshot = structuredClone(entry);
      history.push(entry);

      const undone = history.undo(after);
      expect(undone).toStrictEqual(before);
      const redone = history.redo(undone);
      expect(redone).toStrictEqual(after);
      expect(history.undo(redone)).toStrictEqual(before);
      expectFlags(history, false, true);
      expect(entry).toStrictEqual(snapshot);
    });
  });

  describe('atomicity on reducer failure', () => {
    it('undo against a map lacking the node throws unknown-node and keeps the stacks', () => {
      const history = new History();
      const before = seed();
      const renamed = record(before, RENAME);
      history.push(renamed.entry);
      const foreign = foreignMap();

      const error = errorFrom(() => history.undo(foreign));
      expect(error).toBeInstanceOf(TreeOpError);
      expect((error as TreeOpError).code).toBe('unknown-node');
      expectFlags(history, true, false);

      expect(history.undo(renamed.map)).toStrictEqual(before);
      expectFlags(history, false, true);
    });

    it('redo against a map lacking the node throws unknown-node and keeps the stacks', () => {
      const history = new History();
      const { renamed, undone } = renameThenUndo(history);
      const foreign = foreignMap();

      const error = errorFrom(() => history.redo(foreign));
      expect(error).toBeInstanceOf(TreeOpError);
      expect((error as TreeOpError).code).toBe('unknown-node');
      expectFlags(history, false, true);

      expect(history.redo(undone)).toStrictEqual(renamed);
      expectFlags(history, true, false);
    });
  });

  describe('invalid entries', () => {
    const inverse: TreeOp[] = [{ op: 'update_node', id: 'n', text: 'A' }];
    const invalid: [string, HistoryEntry][] = [
      ['zero ops', { ops: [], inverses: [], label: 'empty' }],
      ['fewer inverses than ops', { ops: [RENAME], inverses: [], label: 'short' }],
      ['more inverses than ops', { ops: [RENAME], inverses: [inverse, inverse], label: 'long' }],
    ];

    it.each(invalid)('rejects %s with invalid-entry and leaves both stacks untouched', (_, bad) => {
      const history = new History();
      const { renamed, undone } = renameThenUndo(history);

      const error = errorFrom(() => {
        history.push(bad);
      });
      expect(error).toBeInstanceOf(HistoryError);
      expect(error).toBeInstanceOf(Error);
      expect((error as HistoryError).name).toBe('HistoryError');
      expect((error as HistoryError).code).toBe('invalid-entry');
      expectFlags(history, false, true);

      expect(history.redo(undone)).toStrictEqual(renamed);
      expectFlags(history, true, false);
    });
  });
});

describe('History groups', () => {
  it('Multi-select delete is one step: one undo restores all three at original parents and indices', () => {
    const { history, base, current } = stacked();
    const deletes: TreeOp[] = ['a', 'b', 'c'].map((id) => ({ op: 'delete_node', id }));

    const after = runGroup(history, current, 'delete selection', deletes);
    expect(after).toStrictEqual(applied(current, deletes));
    expect(idsOf(nodeIn(after, 'p').children)).toStrictEqual(['m']);
    expect(nodeIn(after, 'q').children).toStrictEqual([]);
    expectState(history, true, false, false);

    const undone = history.undo(after);
    expect(undone).toStrictEqual(current);
    expect(entryIn(undone, 'a')).toMatchObject({ parentId: 'p', index: 0 });
    expect(entryIn(undone, 'b')).toMatchObject({ parentId: 'p', index: 2 });
    expect(entryIn(undone, 'c')).toMatchObject({ parentId: 'q', index: 0 });
    expectState(history, true, true, false);

    // Exactly one step was gained: the next undo reverts EARLIER, the entry before the group.
    expect(history.undo(undone)).toStrictEqual(base);
    expectState(history, false, true, false);
  });

  it('Empty group leaves no entry: canUndo and canRedo unchanged, the redo stack kept', () => {
    const ctx = stacked();
    ctx.history.beginGroup('empty');
    expectState(ctx.history, true, true, true);
    ctx.history.endGroup();
    expectStacksAsBefore(ctx);
  });

  it('Nested beginGroup is rejected with group-open and the open group is unaffected', () => {
    const { history, base, current } = stacked();
    const toQ: TreeOp[] = [
      { op: 'move_node', id: 'a', newParentId: 'q' },
      { op: 'move_node', id: 'b', newParentId: 'q' },
    ];
    history.beginGroup('drag');
    const first = dispatchAll(history, current, toQ.slice(0, 1));

    expectHistoryError(() => {
      history.beginGroup('other');
    }, 'group-open');
    expectState(history, true, true, true);

    const after = dispatchAll(history, first, toQ.slice(1));
    history.endGroup();
    expect(after).toStrictEqual(applied(current, toQ));
    expectState(history, true, false, false);

    expect(history.undo(after)).toStrictEqual(current);
    expect(history.undo(current)).toStrictEqual(base);
    expectState(history, false, true, false);
  });

  it('Rejected op cancels the group: GroupCancelledError carries the pre-group map and the TreeOpError', () => {
    const ctx = stacked();
    const { history, base } = ctx;
    history.beginGroup('add node');
    const named = dispatchAll(history, ctx.current, [ADD_X, NAME_X]);

    const error = errorFrom(() => history.dispatch(named, DELETE_PRIMARY));
    expect(error).toBeInstanceOf(GroupCancelledError);
    expect(error).toBeInstanceOf(HistoryError);
    const cancelled = error as GroupCancelledError;
    expect(cancelled.name).toBe('GroupCancelledError');
    expect(cancelled.code).toBe('group-cancelled');
    expect(cancelled.restored).toStrictEqual(ctx.current);
    expect(cancelled.cause).toBeInstanceOf(TreeOpError);
    expect(cancelled.cause.code).toBe('primary-root-protected');
    expect(cancelled.cause.message).toBe(rejection(named, DELETE_PRIMARY).message);
    expectStacksAsBefore(ctx);

    // A later group works normally and, being non-empty, clears the redo stack.
    const after = runGroup(history, base, 'retry', [EARLIER]);
    expect(after).toStrictEqual(ctx.current);
    expectState(history, true, false, false);
  });

  it('Cancelled group leaves no entry: cancelGroup returns the pre-group map, canRedo unchanged', () => {
    const ctx = stacked();
    ctx.history.beginGroup('add node');
    const named = dispatchAll(ctx.history, ctx.current, [ADD_X, NAME_X]);
    expect(nodeIn(named, 'x').text).toBe('想法');
    expectState(ctx.history, true, true, true);

    expect(ctx.history.cancelGroup(named)).toStrictEqual(ctx.current);
    expectStacksAsBefore(ctx);
  });

  it('Undo while a group is open: undo and redo throw group-open on empty stacks, nothing changes', () => {
    const history = new History();
    const map = seed();
    history.beginGroup('edit');

    expectHistoryError(() => history.undo(map), 'group-open');
    expectHistoryError(() => history.redo(map), 'group-open');
    expectState(history, false, false, true);

    history.endGroup();
    expect(history.undo(map)).toBe(map);
    expect(history.redo(map)).toBe(map);
    expectState(history, false, false, false);
  });

  it('Undo while a group is open: undo, redo and push throw group-open on non-empty stacks', () => {
    const { history, current } = stacked();
    history.beginGroup('edit');
    const renamed = dispatchAll(history, current, [{ op: 'update_node', id: 'b', text: 'B2' }]);

    expectHistoryError(() => history.undo(renamed), 'group-open');
    expectHistoryError(() => history.redo(renamed), 'group-open');
    expectHistoryError(() => {
      history.push(record(renamed, { op: 'update_node', id: 'b', text: 'B3' }).entry);
    }, 'group-open');
    expectState(history, true, true, true);

    history.endGroup();
    expect(history.undo(renamed)).toStrictEqual(current);
    expectState(history, true, true, false);
  });

  it('Undo a detach: the node returns under its original parent at its original index, unpositioned', () => {
    const history = new History();
    const base = groupMap();
    const detach: TreeOp = {
      op: 'move_node',
      id: 'm',
      newParentId: null,
      position: { x: 50, y: 60 },
    };

    const detached = history.dispatch(base, detach);
    expect(detached).toStrictEqual(applied(base, [detach]));
    expect(entryIn(detached, 'm')).toMatchObject({ parentId: null, index: 3 });
    expectState(history, true, false, false);

    const undone = history.undo(detached);
    expect(entryIn(undone, 'm')).toMatchObject({ parentId: 'p', index: 1 });
    expect(nodeIn(undone, 'm')).not.toHaveProperty('position');
    expect(undone).toStrictEqual(base);
    expectState(history, false, true, false);
  });

  it('Undo deleting a floating root: it returns at roots index 2 with its position and subtree', () => {
    const history = new History();
    const base = groupMap();

    const deleted = history.dispatch(base, { op: 'delete_node', id: 'f2' });
    expect(idsOf(deleted.roots)).toStrictEqual(['r', 'f1']);

    const undone = history.undo(deleted);
    expect(idsOf(undone.roots)).toStrictEqual(['r', 'f1', 'f2']);
    expect(undone.roots[2]).toStrictEqual(
      node('f2', [node('g1'), node('g2')], { position: { x: 300, y: 200 } }),
    );
    expect(undone).toStrictEqual(base);
    expectState(history, false, true, false);
  });

  // Ops in one group interact through indices: B's recorded inverse index shifts once A has left.
  it.each<[string, TreeOp[], (after: MindMap) => void]>([
    [
      'a group drag of siblings at indices 0 and 2 to another parent',
      [
        { op: 'move_node', id: 'a', newParentId: 'q' },
        { op: 'move_node', id: 'b', newParentId: 'q' },
      ],
      (after) => {
        expect(idsOf(nodeIn(after, 'p').children)).toStrictEqual(['m']);
        expect(idsOf(nodeIn(after, 'q').children)).toStrictEqual(['c', 'a', 'b']);
      },
    ],
    [
      'a detach followed by an attach',
      [
        { op: 'move_node', id: 'm', newParentId: null, position: { x: 50, y: 60 } },
        { op: 'move_node', id: 'f1', newParentId: 'm', index: 0 },
      ],
      (after) => {
        expect(idsOf(after.roots)).toStrictEqual(['r', 'f2', 'm']);
        expect(idsOf(nodeIn(after, 'm').children)).toStrictEqual(['f1']);
      },
    ],
  ])('undoes %s in one step and redoes it to the post-group map', (_, ops, check) => {
    const history = new History();
    const base = groupMap();

    const after = runGroup(history, base, 'drag', ops);
    expect(after).toStrictEqual(applied(base, ops));
    check(after);
    expectState(history, true, false, false);

    const undone = history.undo(after);
    expect(undone).toStrictEqual(base);
    expectState(history, false, true, false);
    expect(history.redo(undone)).toStrictEqual(after);
    expectState(history, true, false, false);
  });

  it('groupOpen is false initially and after endGroup, cancelGroup and a rejected dispatch', () => {
    const history = new History();
    const map = groupMap();
    expectState(history, false, false, false);

    history.beginGroup('one');
    expectState(history, false, false, true);
    history.endGroup();
    expectState(history, false, false, false);

    history.beginGroup('two');
    const added = dispatchAll(history, map, [ADD_X]);
    expectState(history, false, false, true);
    expect(history.cancelGroup(added)).toStrictEqual(map);
    expectState(history, false, false, false);

    history.beginGroup('three');
    expect(errorFrom(() => history.dispatch(map, DELETE_PRIMARY))).toBeInstanceOf(
      GroupCancelledError,
    );
    expectState(history, false, false, false);
  });

  it('endGroup and cancelGroup without an open group throw no-group and change nothing', () => {
    const ctx = stacked();
    const { history, current } = ctx;

    expectHistoryError(() => {
      history.endGroup();
    }, 'no-group');
    expectHistoryError(() => history.cancelGroup(current), 'no-group');

    history.beginGroup('closed');
    history.endGroup();
    expectHistoryError(() => {
      history.endGroup();
    }, 'no-group');
    expectHistoryError(() => history.cancelGroup(current), 'no-group');
    expectStacksAsBefore(ctx);
  });

  describe('atomicity', () => {
    it('cancelGroup on a foreign map throws its TreeOpError, keeps the group open, and a retry succeeds', () => {
      const ctx = stacked();
      ctx.history.beginGroup('add node');
      const added = dispatchAll(ctx.history, ctx.current, [ADD_X]);

      expectTreeOpError(() => ctx.history.cancelGroup(foreignMap()), 'unknown-node');
      expectState(ctx.history, true, true, true);

      expect(ctx.history.cancelGroup(added)).toStrictEqual(ctx.current);
      expectStacksAsBefore(ctx);
    });

    it('a rejected dispatch whose revert cannot apply throws the revert TreeOpError, group still open', () => {
      const { history, current } = stacked();
      history.beginGroup('add node');
      const added = dispatchAll(history, current, [ADD_X]);

      // The op itself is rejected as primary-root-protected; reverting ADD_X on the foreign map
      // then fails with unknown-node, and that error is what surfaces — unwrapped.
      expectTreeOpError(
        () => history.dispatch(foreignMap(), { op: 'delete_node', id: 'q' }),
        'unknown-node',
      );
      expectState(history, true, true, true);

      const named = dispatchAll(history, added, [NAME_X]);
      history.endGroup();
      expect(history.undo(named)).toStrictEqual(current);
    });

    it('an error that is not a TreeOpError propagates as-is and leaves the group open', () => {
      const { history, current } = stacked();
      history.beginGroup('add node');
      const added = dispatchAll(history, current, [ADD_X]);
      const broken = { ...added, roots: null } as unknown as MindMap;

      expect(errorFrom(() => history.dispatch(broken, NAME_X))).toBeInstanceOf(TypeError);
      expectState(history, true, true, true);
      expect(history.cancelGroup(added)).toStrictEqual(current);
    });
  });

  it('later group activity never changes an entry already pushed by endGroup', () => {
    const history = new History();
    const base = groupMap();
    const named = runGroup(history, base, 'add node', [ADD_X, NAME_X]);

    history.beginGroup('second');
    const trimmed = dispatchAll(history, named, [{ op: 'delete_node', id: 'a' }]);
    expect(history.cancelGroup(trimmed)).toStrictEqual(named);
    history.beginGroup('third');
    const removed = dispatchAll(history, named, [{ op: 'delete_node', id: 'x' }]);
    expect(errorFrom(() => history.dispatch(removed, DELETE_PRIMARY))).toBeInstanceOf(
      GroupCancelledError,
    );
    history.beginGroup('fourth');
    history.endGroup();

    const undone = history.undo(named);
    expect(undone).toStrictEqual(base);
    expectState(history, false, true, false);
    expect(history.redo(undone)).toStrictEqual(applied(base, [ADD_X, NAME_X]));
  });

  describe('ungrouped dispatch', () => {
    it('pushes one entry per op and clears the redo stack', () => {
      const { history, base, current } = stacked();
      const rename: TreeOp = { op: 'update_node', id: 'm', text: 'M2' };

      const next = history.dispatch(current, rename);
      expect(next).toStrictEqual(applied(current, [rename]));
      expectState(history, true, false, false);
      expect(history.redo(next)).toBe(next);

      expect(history.undo(next)).toStrictEqual(current);
      expect(history.undo(current)).toStrictEqual(base);
      expectState(history, false, true, false);
    });

    it('rethrows a rejected op as the unwrapped TreeOpError and leaves both stacks unchanged', () => {
      const ctx = stacked();
      expectTreeOpError(
        () => ctx.history.dispatch(ctx.current, { op: 'move_node', id: 'p', newParentId: 'a' }),
        'cycle',
      );
      expectStacksAsBefore(ctx);
    });
  });
});
