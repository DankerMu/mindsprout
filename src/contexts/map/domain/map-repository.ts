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
 * - `StorageUnavailableError` means exactly "the backing store cannot be opened". Any method MAY
 *   reject with it, because an adapter may open lazily on first use. Callers (autosave, the app
 *   provider) treat it as "storage unavailable" and switch to the in-memory fallback and banner.
 *   Every other storage failure (e.g. a quota error on `put`) rejects with the underlying error,
 *   never with `StorageUnavailableError`, and callers surface it as the "保存失败" notice.
 * - `UnsupportedSchemaVersionError` is thrown only by `get(id)` when the stored record's
 *   `schemaVersion` is newer than the adapter supports. `list` never rejects because of one
 *   record's version: a newer-version record is listed from its id/title/updatedAt when they are
 *   readable, so the library still shows it and opening it reports the version. `put` and
 *   `delete` never throw it.
 * - Adapter-specific behaviour is tested by the adapter. The in-memory adapter produces neither
 *   error: it is always open and holds only current-version maps.
 */
export interface MapRepository {
  list(): Promise<MapSummary[]>;
  get(id: MindMap['id']): Promise<MindMap | undefined>;
  put(map: MindMap): Promise<void>;
  delete(id: MindMap['id']): Promise<void>;
}
