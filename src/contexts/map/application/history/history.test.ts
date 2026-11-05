import { describe, expect, it } from 'vitest';
import { apply, deepFreeze, nodeIn } from '../../../../../tests/support/map-domain';
import { applyOp } from '../../domain/apply-op';
import { createMindMap } from '../../domain/create-mind-map';
import { TreeOpError } from '../../domain/errors';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap } from '../../domain/types';
import { History, HISTORY_LIMIT, HistoryError, type HistoryEntry } from './history';

// Spec map-undo-history (task 2.1) and design "Fixture — issue #6": the History public API over the
// real applyOp and maps from createMindMap — no mocked reducer. Every map passes through the shared
// apply helper, which deep-freezes it, so History can never write into a map it is handed.

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

function errorFrom(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
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
      const foreign = createMindMap({ id: 'm2', rootId: 'q', title: 't', rootText: 'q' });

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
      const foreign = createMindMap({ id: 'm2', rootId: 'q', title: 't', rootText: 'q' });

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
