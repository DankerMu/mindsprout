import type { Page } from '@playwright/test';
import {
  MAP_DB_NAME,
  MAP_DB_VERSION,
  MAP_SCHEMA_VERSION,
  MAP_STORE,
} from '../../src/contexts/map/infrastructure/persistence/indexed-db-map-repository';

// Raw IndexedDB seeding for the e2e walks (design "Fixture — issue #16"; reused by #18–#20). Records
// are written and read in the page through the browser's real IndexedDB, with the adapter's own
// constants and envelope, so a seed is exactly what the adapter would have stored.
//
// Seeding protocol: the root layout's provider opens the database on every app page, so seeding
// runs on a same-origin page without it (/api/healthz): open at MAP_DB_VERSION with the adapter's
// upgrade, write, close, then navigate to the page under test.

const SEED_PAGE = '/api/healthz';

const DATABASE = { name: MAP_DB_NAME, version: MAP_DB_VERSION, store: MAP_STORE };

// One raw record: `value` is stored as given under `key`, so it may be any envelope, including a
// newer schemaVersion or a corrupt map.
export interface RawRecord {
  key: string;
  value: unknown;
}

// The adapter's put envelope: { schemaVersion, map } under map.id.
export function envelopeOf(
  map: { id: string },
  schemaVersion: number = MAP_SCHEMA_VERSION,
): RawRecord {
  return { key: map.id, value: { schemaVersion, map } };
}

export async function seedRecords(page: Page, records: readonly RawRecord[]): Promise<void> {
  await page.goto(SEED_PAGE);
  await page.evaluate(
    async ({ database, entries }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database.name, database.version);
        // The adapter's upgrade: one object store with out-of-line keys.
        request.onupgradeneeded = () => {
          request.result.createObjectStore(database.store);
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('seed: open failed'));
        };
        request.onblocked = () => {
          reject(new Error('seed: open blocked by another connection'));
        };
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(database.store, 'readwrite');
          for (const { key, value } of entries) tx.objectStore(database.store).put(value, key);
          tx.oncomplete = () => {
            resolve();
          };
          tx.onabort = () => {
            reject(tx.error ?? new Error('seed: write aborted'));
          };
        });
      } finally {
        db.close();
      }
    },
    { database: DATABASE, entries: records },
  );
}

// The raw stored value under `key` (undefined when absent), read without the adapter. Safe on an
// app page: it opens at the same version as the adapter's open connection, so nothing upgrades.
export async function readRecord(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    async ({ database, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database.name, database.version);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('read: open failed'));
        };
      });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const request = db.transaction(database.store).objectStore(database.store).get(id);
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(request.error ?? new Error('read: get failed'));
          };
        });
      } finally {
        db.close();
      }
    },
    { database: DATABASE, id: key },
  );
}
