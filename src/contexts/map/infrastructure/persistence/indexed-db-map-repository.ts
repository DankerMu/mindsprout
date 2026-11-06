import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { StorageUnavailableError, UnsupportedSchemaVersionError } from '../../domain/errors';
import type { MapRepository, MapSummary } from '../../domain/map-repository';
import type { MindMap } from '../../domain/types';
import { byRecency } from './summary-order';

// Browser store of the map context (design D7, Migration Plan). One object store with out-of-line
// keys: each record is { schemaVersion, map } under map.id, so a record written by a newer schema
// stays addressable by id even if its shape changes. Error contract: MapRepository.

export const MAP_DB_NAME = 'mindsprout';
export const MAP_DB_VERSION = 1;
export const MAP_STORE = 'maps';
export const MAP_SCHEMA_VERSION = 1;

// Keys and values are typed as whatever may be on disk: another writer or a newer schema can
// leave anything there, and the readers below check before they trust.
interface MapDatabase extends DBSchema {
  [MAP_STORE]: { key: IDBValidKey; value: unknown };
}

// "Object" means a non-null object throughout this file.
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// A v1 envelope yields its map as stored (no validation); an integer version above ours is
// reported as such; anything else is unreadable, which is an error and never "not found".
function mapFromRecord(id: MindMap['id'], record: unknown): MindMap {
  if (isObject(record)) {
    const { schemaVersion, map } = record;
    if (schemaVersion === MAP_SCHEMA_VERSION && isObject(map)) return map as unknown as MindMap;
    const newer =
      typeof schemaVersion === 'number' &&
      Number.isInteger(schemaVersion) &&
      schemaVersion > MAP_SCHEMA_VERSION;
    if (newer) throw new UnsupportedSchemaVersionError(schemaVersion, MAP_SCHEMA_VERSION);
  }
  throw new Error(`stored map "${id}" is unreadable`);
}

// Any schemaVersion is listed when id, title and updatedAt are readable; otherwise skipped.
function summaryFromRecord(key: IDBValidKey, record: unknown): MapSummary[] {
  if (typeof key !== 'string' || !isObject(record) || !isObject(record.map)) return [];
  const { title, updatedAt } = record.map;
  return typeof title === 'string' && typeof updatedAt === 'string'
    ? [{ id: key, title, updatedAt }]
    : [];
}

class IndexedDbMapRepository implements MapRepository {
  readonly #db: IDBPDatabase<MapDatabase>;

  constructor(db: IDBPDatabase<MapDatabase>) {
    this.#db = db;
  }

  async list(): Promise<MapSummary[]> {
    const tx = this.#db.transaction(MAP_STORE, 'readonly');
    const [keys, records] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll(), tx.done]);
    return keys.flatMap((key, index) => summaryFromRecord(key, records[index])).sort(byRecency);
  }

  async get(id: MindMap['id']): Promise<MindMap | undefined> {
    const tx = this.#db.transaction(MAP_STORE, 'readonly');
    // getKey tells an absent key from a record whose stored value is itself undefined.
    const [key, record] = await Promise.all([tx.store.getKey(id), tx.store.get(id), tx.done]);
    return key === undefined ? undefined : mapFromRecord(id, record);
  }

  async put(map: MindMap): Promise<void> {
    const tx = this.#db.transaction(MAP_STORE, 'readwrite');
    await Promise.all([tx.store.put({ schemaVersion: MAP_SCHEMA_VERSION, map }, map.id), tx.done]);
  }

  async delete(id: MindMap['id']): Promise<void> {
    const tx = this.#db.transaction(MAP_STORE, 'readwrite');
    await Promise.all([tx.store.delete(id), tx.done]);
  }
}

// Opens eagerly and resolves only with a usable repository. openDB is called inside the try so a
// synchronous throw (no indexedDB global, SecurityError from open) is mapped like a failed request.
export async function openIndexedDbMapRepository(): Promise<MapRepository> {
  try {
    const db = await openDB<MapDatabase>(MAP_DB_NAME, MAP_DB_VERSION, {
      upgrade(database) {
        database.createObjectStore(MAP_STORE);
      },
    });
    return new IndexedDbMapRepository(db);
  } catch (error) {
    throw new StorageUnavailableError('IndexedDB could not be opened', { cause: error });
  }
}
