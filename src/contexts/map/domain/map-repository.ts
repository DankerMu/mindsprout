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
 * - `StorageUnavailableError` means exactly "the backing store cannot be opened or has become
 *   unusable". An adapter opens its store before it is handed out (an async factory rejects with
 *   this error). The composition-root provider awaits that once per session and, on this error,
 *   falls back to one `InMemoryMapRepository` and sets the session's storage-unavailable state;
 *   no other caller swaps repositories. Mid-session any method MAY still reject with it: autosave
 *   then sets its storageUnavailable flag (no "保存失败", no swap) and a reader (`get`/`list`)
 *   shows the banner state, never not-found.
 * - Every other storage failure rejects with the underlying error, never with
 *   `StorageUnavailableError`: a failed `put` or `delete` surfaces as the "保存失败" notice; a
 *   failed `get` or `list` is the reader's error state, never not-found.
 * - `UnsupportedSchemaVersionError` is thrown only by `get(id)` when the stored record's
 *   `schemaVersion` is newer than the adapter supports. `list` never rejects because of one
 *   record's version: a newer-version record is listed from its id/title/updatedAt when they are
 *   readable and skipped when they are not. `put` and `delete` never throw it.
 * - Adapter-specific behaviour is tested by the adapter. The in-memory adapter produces neither
 *   error: it is always open and holds only current-version maps.
 */
export interface MapRepository {
  list(): Promise<MapSummary[]>;
  get(id: MindMap['id']): Promise<MindMap | undefined>;
  put(map: MindMap): Promise<void>;
  delete(id: MindMap['id']): Promise<void>;
}
