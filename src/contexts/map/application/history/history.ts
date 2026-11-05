import { applyOp } from '../../domain/apply-op';
import { TreeOpError } from '../../domain/errors';
import type { TreeOp } from '../../domain/tree-op';
import type { MindMap } from '../../domain/types';

// Undo history as an inverse-op stack (design D3). In-memory only: never serialised or persisted,
// so a reload starts with an empty history (spec "History is bounded and not persisted").

// Oldest entry is dropped beyond this (spec "Cap at 200").
export const HISTORY_LIMIT = 200;

// Plain data; inverses[i] is the inverse list applyOp returned for ops[i]. Stored as given and
// never mutated, so the same entry can go undo → redo → undo.
export interface HistoryEntry {
  readonly ops: readonly TreeOp[];
  readonly inverses: readonly (readonly TreeOp[])[];
  readonly label: string;
}

export type HistoryErrorCode = 'invalid-entry' | 'group-open' | 'no-group' | 'group-cancelled';

export class HistoryError extends Error {
  override readonly name: string = 'HistoryError';
  readonly code: HistoryErrorCode;

  constructor(code: HistoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

// A dispatch rejected inside a group: the group was reverted and closed. `restored` is the
// pre-group map the caller must keep; `cause` is the reducer's rejection, which the editor store
// rethrows so its caller sees the TreeOpError (design D3).
export class GroupCancelledError extends HistoryError {
  override readonly name: string = 'GroupCancelledError';
  declare readonly cause: TreeOpError;
  readonly restored: MindMap;

  constructor(label: string, restored: MindMap, cause: TreeOpError) {
    super('group-cancelled', `group "${label}" cancelled: ${cause.message}`, { cause });
    this.restored = restored;
  }
}

interface OpenGroup {
  readonly label: string;
  readonly ops: TreeOp[];
  readonly inverses: TreeOp[][];
}

function applyAll(map: MindMap, ops: readonly TreeOp[]): MindMap {
  return ops.reduce((current, op) => applyOp(current, op).map, map);
}

// The one revert: inverse lists run last-first, each in its own order. Used by undo, cancelGroup
// and the rejected-dispatch path.
function applyInverses(map: MindMap, inverses: readonly (readonly TreeOp[])[]): MindMap {
  return inverses.reduceRight(applyAll, map);
}

export class History {
  readonly #past: HistoryEntry[] = [];
  readonly #future: HistoryEntry[] = [];
  #group: OpenGroup | undefined;

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get groupOpen(): boolean {
    return this.#group !== undefined;
  }

  push(entry: HistoryEntry): void {
    this.#assertNoGroup('push');
    if (entry.ops.length === 0 || entry.ops.length !== entry.inverses.length) {
      throw new HistoryError(
        'invalid-entry',
        `history entry needs at least one op and one inverse list per op (got ${String(entry.ops.length)} ops, ${String(entry.inverses.length)} inverse lists)`,
      );
    }
    this.#past.push(entry);
    this.#future.length = 0;
    if (this.#past.length > HISTORY_LIMIT) {
      this.#past.shift();
    }
  }

  // The only place History applies a new op. Outside a group: one entry labelled with the op name
  // (a rejection propagates unwrapped, stacks untouched). Inside a group: recorded into the group,
  // future untouched; a TreeOpError cancels the group and surfaces as GroupCancelledError.
  dispatch(map: MindMap, op: TreeOp): MindMap {
    const group = this.#group;
    if (group === undefined) {
      const { map: next, inverse } = applyOp(map, op);
      this.push({ ops: [op], inverses: [inverse], label: op.op });
      return next;
    }
    try {
      const { map: next, inverse } = applyOp(map, op);
      group.ops.push(op);
      group.inverses.push(inverse);
      return next;
    } catch (error) {
      if (!(error instanceof TreeOpError)) throw error;
      // If the revert itself fails (map is not the group's current map), its TreeOpError
      // propagates from cancelGroup and the group stays open.
      throw new GroupCancelledError(group.label, this.cancelGroup(map), error);
    }
  }

  beginGroup(label: string): void {
    this.#assertNoGroup('beginGroup');
    this.#group = { label, ops: [], inverses: [] };
  }

  // Closes the group; a non-empty group becomes one entry built from fresh arrays and goes through
  // push, so future clears and the cap applies. An empty group pushes nothing.
  endGroup(): void {
    const group = this.#requireGroup('endGroup');
    this.#group = undefined;
    if (group.ops.length === 0) return;
    this.push({ ops: [...group.ops], inverses: [...group.inverses], label: group.label });
  }

  // The reverted map is computed before the group closes: a foreign map throws its TreeOpError
  // and leaves the group open, so the caller can retry with the right map.
  cancelGroup(map: MindMap): MindMap {
    const group = this.#requireGroup('cancelGroup');
    const restored = applyInverses(map, group.inverses);
    this.#group = undefined;
    return restored;
  }

  // The new map is computed before either stack changes, so a TreeOpError (stale or foreign map)
  // leaves the history untouched. The group check precedes the empty-stack return.
  undo(map: MindMap): MindMap {
    this.#assertNoGroup('undo');
    const entry = this.#past.at(-1);
    if (entry === undefined) return map;
    const restored = applyInverses(map, entry.inverses);
    this.#past.pop();
    this.#future.push(entry);
    return restored;
  }

  // Redo starts from a map deep-equal to the one the ops were first applied to, so the stored
  // inverses stay valid for the next undo.
  redo(map: MindMap): MindMap {
    this.#assertNoGroup('redo');
    const entry = this.#future.at(-1);
    if (entry === undefined) return map;
    const next = applyAll(map, entry.ops);
    this.#future.pop();
    this.#past.push(entry);
    return next;
  }

  #assertNoGroup(action: string): void {
    if (this.#group !== undefined) {
      throw new HistoryError(
        'group-open',
        `${action} is not allowed while group "${this.#group.label}" is open`,
      );
    }
  }

  #requireGroup(action: string): OpenGroup {
    if (this.#group === undefined) {
      throw new HistoryError('no-group', `${action} needs an open group`);
    }
    return this.#group;
  }
}
