import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeMapRepositoryContract } from '../../../../../tests/support/map-repository-contract';
import { mapOf, node } from '../../../../../tests/support/map-domain';
import { StorageUnavailableError, UnsupportedSchemaVersionError } from '../../domain/errors';
import type { MindMap } from '../../domain/types';
import {
  MAP_DB_NAME,
  MAP_DB_VERSION,
  MAP_SCHEMA_VERSION,
  MAP_STORE,
  openIndexedDbMapRepository,
} from './indexed-db-map-repository';

// IndexedDB adapter under fake-indexeddb (design "Fixture — issue #11"). Every case installs a
// fresh IDBFactory as the global indexedDB, so it starts from an empty browser profile; raw
// records are seeded and inspected through idb's openDB on that same factory.

afterEach(() => {
  vi.unstubAllGlobals();
});

function freshIndexedDb(): void {
  vi.stubGlobal('indexedDB', new IDBFactory());
}

// A second connection to the adapter's database, for seeding and inspecting raw records.
function rawDatabase() {
  return openDB(MAP_DB_NAME, MAP_DB_VERSION);
}

async function seed(key: IDBValidKey, value: unknown): Promise<void> {
  const db = await rawDatabase();
  await db.put(MAP_STORE, value, key);
  db.close();
}

async function rawRecords(): Promise<{ keys: IDBValidKey[]; values: unknown[] }> {
  const db = await rawDatabase();
  const [keys, values] = (await Promise.all([db.getAllKeys(MAP_STORE), db.getAll(MAP_STORE)])) as [
    IDBValidKey[],
    unknown[],
  ];
  db.close();
  return { keys, values };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

function storedMap(id: string, title = `导图 ${id}`): MindMap {
  return { ...mapOf(node(`${id}-root`)), id, title, updatedAt: '2026-11-05T10:00:00.000Z' };
}

// Spec "Floating root round-trip": a floating root at (300, 200) with a collapsed child carrying
// a note and a color.
function floatingMap(): MindMap {
  return {
    ...mapOf(
      node('r', [node('a')]),
      node(
        'f1',
        [node('fc', [node('fc1')], { collapsed: true, note: '原文\n摘录', color: 'green' })],
        {
          position: { x: 300, y: 200 },
        },
      ),
    ),
    id: 'floating',
    title: '浮动',
  };
}

describeMapRepositoryContract('IndexedDbMapRepository', () => {
  freshIndexedDb();
  return openIndexedDbMapRepository();
});

describe('IndexedDbMapRepository storage layout', () => {
  it('names the database, version, store and schema version of the persisted format', () => {
    expect({ MAP_DB_NAME, MAP_DB_VERSION, MAP_STORE, MAP_SCHEMA_VERSION }).toStrictEqual({
      MAP_DB_NAME: 'mindsprout',
      MAP_DB_VERSION: 1,
      MAP_STORE: 'maps',
      MAP_SCHEMA_VERSION: 1,
    });
  });

  it('stores exactly { schemaVersion: 1, map } under the key map.id', async () => {
    freshIndexedDb();
    const repository = await openIndexedDbMapRepository();
    const map = storedMap('m1');

    await repository.put(map);

    expect(await rawRecords()).toStrictEqual({
      keys: ['m1'],
      values: [{ schemaVersion: 1, map: storedMap('m1') }],
    });
  });

  it('reads a floating root, collapsed child, note and color back after a reload', async () => {
    freshIndexedDb();
    const before = await openIndexedDbMapRepository();
    await before.put(floatingMap());

    const reloaded = await openIndexedDbMapRepository();

    expect(await reloaded.get('floating')).toStrictEqual(floatingMap());
    expect(await reloaded.list()).toStrictEqual([
      { id: 'floating', title: '浮动', updatedAt: '2026-11-05T10:00:00.000Z' },
    ]);
  });
});

describe('IndexedDbMapRepository versioned and unreadable records', () => {
  it('rejects a newer schemaVersion on get, leaves the record untouched and still lists it', async () => {
    freshIndexedDb();
    const repository = await openIndexedDbMapRepository();
    await seed('x', { schemaVersion: 2, map: storedMap('x', '新版导图') });

    const error = await rejectionOf(repository.get('x'));

    expect(error).toBeInstanceOf(UnsupportedSchemaVersionError);
    expect(error).toMatchObject({ found: 2, supported: 1 });
    expect(await rawRecords()).toStrictEqual({
      keys: ['x'],
      values: [{ schemaVersion: 2, map: storedMap('x', '新版导图') }],
    });
    expect(await repository.list()).toStrictEqual([
      { id: 'x', title: '新版导图', updatedAt: '2026-11-05T10:00:00.000Z' },
    ]);
  });

  it('rejects a newer schemaVersion on get even when its shape changed', async () => {
    freshIndexedDb();
    const repository = await openIndexedDbMapRepository();
    await seed('v3', { schemaVersion: 3, data: 'x' });

    const error = await rejectionOf(repository.get('v3'));

    expect(error).toBeInstanceOf(UnsupportedSchemaVersionError);
    expect(error).toMatchObject({ found: 3, supported: 1 });
    expect(await rawRecords()).toStrictEqual({
      keys: ['v3'],
      values: [{ schemaVersion: 3, data: 'x' }],
    });
  });

  it('lists only readable summaries and never rejects because of a record', async () => {
    freshIndexedDb();
    const repository = await openIndexedDbMapRepository();
    await repository.put(storedMap('ok', '可读'));
    await seed('v3', { schemaVersion: 3, data: { id: 'v3', title: '更新', updatedAt: 'later' } });
    await seed('text', 'not an envelope');
    await seed('null', null);
    await seed('v1-null-map', { schemaVersion: 1, map: null });
    await seed('v1-numeric-title', { schemaVersion: 1, map: { ...storedMap('t'), title: 42 } });
    await seed('v1-missing-updated-at', { schemaVersion: 1, map: { title: '无时间' } });
    await seed(7, { schemaVersion: 1, map: storedMap('numeric-key') });

    expect(await repository.list()).toStrictEqual([
      { id: 'ok', title: '可读', updatedAt: '2026-11-05T10:00:00.000Z' },
    ]);
  });

  it.each([
    ['no-version', { map: storedMap('no-version') }],
    ['string-version', { schemaVersion: '1', map: storedMap('string-version') }],
    ['null-map', { schemaVersion: 1, map: null }],
    ['string-map', { schemaVersion: 1, map: 'map' }],
    ['fractional-version', { schemaVersion: 1.5, map: storedMap('fractional-version') }],
    ['fractional-newer', { schemaVersion: 2.5, map: storedMap('fractional-newer') }],
    ['zero-version', { schemaVersion: 0, map: storedMap('zero-version') }],
    ['null-value', null],
    ['text-value', 'text'],
    ['undefined-value', undefined],
  ])(
    'rejects get of the unreadable record %s with a plain Error naming the id',
    async (id, value) => {
      freshIndexedDb();
      const repository = await openIndexedDbMapRepository();
      await seed(id, value);

      const error = await rejectionOf(repository.get(id));

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(StorageUnavailableError);
      expect(error).not.toBeInstanceOf(UnsupportedSchemaVersionError);
      expect((error as Error).message).toContain(id);
      expect(await rawRecords()).toStrictEqual({ keys: [id], values: [value] });
    },
  );
});

describe('IndexedDbMapRepository failures', () => {
  it('rejects with StorageUnavailableError when indexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);

    const error = await rejectionOf(openIndexedDbMapRepository());

    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect((error as StorageUnavailableError).cause).toBeInstanceOf(Error);
  });

  it('rejects with StorageUnavailableError when indexedDB.open throws synchronously', async () => {
    const denied = new DOMException('The operation is insecure.', 'SecurityError');
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw denied;
      },
    });

    const error = await rejectionOf(openIndexedDbMapRepository());

    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect((error as StorageUnavailableError).cause).toBe(denied);
  });

  it('rejects with StorageUnavailableError when the open request fails', async () => {
    freshIndexedDb();
    const newer = await openDB(MAP_DB_NAME, 2, {
      upgrade(db) {
        db.createObjectStore(MAP_STORE);
      },
    });
    newer.close();

    const error = await rejectionOf(openIndexedDbMapRepository());

    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect((error as StorageUnavailableError).cause).toHaveProperty('name', 'VersionError');
  });

  it('rejects a put the structured clone refuses with the underlying error, storing nothing', async () => {
    freshIndexedDb();
    const repository = await openIndexedDbMapRepository();
    const unclonable = { ...storedMap('fn'), title: (() => '函数') as unknown as string };

    const error = await rejectionOf(repository.put(unclonable));

    expect(error).toHaveProperty('name', 'DataCloneError');
    expect(error).not.toBeInstanceOf(StorageUnavailableError);
    expect(await rawRecords()).toStrictEqual({ keys: [], values: [] });
  });
});
