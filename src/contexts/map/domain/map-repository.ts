import type { MindMap } from './types';

// Persistence port of the map context (design D7). Type-only: adapters live in infrastructure/.

export interface MapSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/**
 * Stores MindMaps by id. `put` stores the map exactly as given: the application layer stamps
 * `updatedAt` before every `put` (design D1), and an adapter never stamps, validates or aliases.
 * `list` returns `{ id, title, updatedAt }` of each stored map, ordered by `updatedAt` descending
 * (ISO-8601 strings compared as strings), ties broken by id ascending in code-unit order.
 *
 * Error contract:
 * - `StorageUnauthorizedError` identifies an ended session; saves retain pending edits and
 *   show the session-expiry notice, while readers redirect to sign-in.
 * - Other storage failures reject with the underlying error: a failed `put` or `delete`
 *   surfaces as the "保存失败" notice; a failed `get` or `list` is the reader's error state,
 *   never not-found.
 * - `UnsupportedSchemaVersionError` is thrown only by `get(id)` when the stored record's
 *   `schemaVersion` is newer than the adapter supports. `list` never rejects because of one
 *   record's version: a newer-version record is listed from its id/title/updatedAt when they are
 *   readable and skipped when they are not. `put` and `delete` never throw it.
 */
export interface MapRepository {
  list(): Promise<MapSummary[]>;
  get(id: MindMap['id']): Promise<MindMap | undefined>;
  put(map: MindMap): Promise<void>;
  delete(id: MindMap['id']): Promise<void>;
}
