import { applyOp } from '../../domain/apply-op';
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

// Issue #7 extends the union with 'group-open' | 'no-group'.
export type HistoryErrorCode = 'invalid-entry';

export class HistoryError extends Error {
  override readonly name = 'HistoryError';
  readonly code: HistoryErrorCode;

  constructor(code: HistoryErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function applyAll(map: MindMap, ops: readonly TreeOp[]): MindMap {
  return ops.reduce((current, op) => applyOp(current, op).map, map);
}

export class History {
  readonly #past: HistoryEntry[] = [];
  readonly #future: HistoryEntry[] = [];

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  push(entry: HistoryEntry): void {
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

  // Inverse lists run last-first, each in its own order. The new map is computed before either
  // stack changes, so a TreeOpError (stale or foreign map) leaves the history untouched.
  undo(map: MindMap): MindMap {
    const entry = this.#past.at(-1);
    if (entry === undefined) return map;
    const restored = entry.inverses.reduceRight(applyAll, map);
    this.#past.pop();
    this.#future.push(entry);
    return restored;
  }

  // Redo starts from a map deep-equal to the one the ops were first applied to, so the stored
  // inverses stay valid for the next undo.
  redo(map: MindMap): MindMap {
    const entry = this.#future.at(-1);
    if (entry === undefined) return map;
    const next = applyAll(map, entry.ops);
    this.#future.pop();
    this.#past.push(entry);
    return next;
  }
}
