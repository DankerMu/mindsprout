import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { mapOf, node } from '../../../../tests/support/map-domain';
import { type MapRepository, UnsupportedSchemaVersionError } from '../acl/map';
import { PostgresMapStore } from './map-store';

function database() {
  const query = vi.fn();
  const transaction = vi
    .fn<(parts: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const json = vi.fn((value: unknown) => ({ serialized: JSON.stringify(value) }));
  const begin = vi.fn(async (callback: (tx: TransactionSql) => Promise<unknown>) =>
    callback(Object.assign(transaction, { json }) as unknown as TransactionSql),
  );
  return {
    sql: Object.assign(query, { begin }) as unknown as Sql,
    query,
    transaction,
    json,
    begin,
  };
}

function statement(call: [TemplateStringsArray, ...unknown[]] | undefined): string {
  if (!call) throw new Error('Expected a database statement');
  return call[0].join('?').replace(/\s+/g, ' ').trim();
}

const MAP = mapOf(node('root'));
const operations: [string, (repository: MapRepository) => Promise<unknown>][] = [
  ['list', (repository) => repository.list()],
  ['get', (repository) => repository.get('m1')],
  ['put', (repository) => repository.put(MAP)],
  ['delete', (repository) => repository.delete('m1')],
];

describe('PostgresMapStore', () => {
  it.each(operations)(
    '%s awaits transaction-local identity before map SQL on every call',
    async (_, run) => {
      const db = database();
      const store = new PostgresMapStore(db.sql);
      const alice = store.forUser('alice');
      let resolve!: (rows: unknown[]) => void;
      db.transaction.mockReturnValueOnce(
        new Promise((release) => {
          resolve = release;
        }),
      );
      const pending = run(alice);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(statement(db.transaction.mock.calls[0])).toBe(
        "select set_config('app.user_id', ?, true)",
      );
      expect(db.transaction.mock.calls[0]?.slice(1)).toEqual(['alice']);
      resolve([]);
      await pending;
      await run(alice);
      await run(store.forUser('bob'));
      expect(db.begin).toHaveBeenCalledTimes(3);
      expect(db.transaction).toHaveBeenCalledTimes(6);
      expect(statement(db.transaction.mock.calls[2])).toBe(
        "select set_config('app.user_id', ?, true)",
      );
      expect(db.transaction.mock.calls[2]?.slice(1)).toEqual(['alice']);
      expect(statement(db.transaction.mock.calls[4])).toBe(
        "select set_config('app.user_id', ?, true)",
      );
      expect(db.transaction.mock.calls[4]?.slice(1)).toEqual(['bob']);
      expect(db.query).not.toHaveBeenCalled();
    },
  );

  it('upserts verbatim JSON under the facade owner and current schema', async () => {
    const db = database();
    const input = { ...MAP, ownerId: 'untrusted-owner' };
    await expect(new PostgresMapStore(db.sql).forUser('alice').put(input)).resolves.toBeUndefined();
    expect(db.json).toHaveBeenCalledExactlyOnceWith(input);
    expect(statement(db.transaction.mock.calls[1])).toBe(
      'insert into maps (owner_id, id, schema_version, map) values (?, ?, 1, ?) on conflict (owner_id, id) do update set schema_version = excluded.schema_version, map = excluded.map',
    );
    expect(db.transaction.mock.calls[1]?.slice(1)).toEqual([
      'alice',
      'm1',
      { serialized: JSON.stringify(input) },
    ]);
  });

  it('gets stored JSON and reports absence without translating errors', async () => {
    const db = database();
    db.transaction
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ map: MAP, schema_version: 1 }]);
    const repository = new PostgresMapStore(db.sql).forUser('alice');
    expect(await repository.get('m1')).toEqual(MAP);
    expect(statement(db.transaction.mock.calls[1])).toBe(
      'select map, schema_version from maps where id = ?',
    );
    expect(db.transaction.mock.calls[1]?.slice(1)).toEqual(['m1']);
    expect(await repository.get('missing')).toBeUndefined();
  });

  it('rejects only newer versions with the shared error and exact version fields', async () => {
    const db = database();
    db.transaction
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ map: MAP, schema_version: 2 }]);
    await expect(new PostgresMapStore(db.sql).forUser('alice').get('m1')).rejects.toEqual(
      new UnsupportedSchemaVersionError(2, 1),
    );
  });

  it('lists summaries in canonical recency and code-unit order without a schema version filter', async () => {
    const db = database();
    const summaries = [
      { id: 'm1', title: 'older', updatedAt: '2001-01-01T00:00:00.000Z' },
      { id: '\uE000', title: 'BMP', updatedAt: '2001-01-02T00:00:00.000Z' },
      { id: '\u{10000}', title: 'supplementary', updatedAt: '2001-01-02T00:00:00.000Z' },
    ];
    db.transaction.mockResolvedValueOnce([]).mockResolvedValueOnce(summaries);
    const repository = new PostgresMapStore(db.sql).forUser('alice');
    expect(await repository.list()).toStrictEqual([
      { id: '\u{10000}', title: 'supplementary', updatedAt: '2001-01-02T00:00:00.000Z' },
      { id: '\uE000', title: 'BMP', updatedAt: '2001-01-02T00:00:00.000Z' },
      { id: 'm1', title: 'older', updatedAt: '2001-01-01T00:00:00.000Z' },
    ]);
    expect(statement(db.transaction.mock.calls[1])).toBe(
      'select id, title, updated_at as "updatedAt" from maps where title is not null and updated_at is not null order by updated_at desc, id collate "C" asc',
    );
    expect(await repository.list()).toEqual([]);
  });

  it('deletes only the requested id without reading its schema version', async () => {
    const db = database();
    await expect(
      new PostgresMapStore(db.sql).forUser('alice').delete('missing'),
    ).resolves.toBeUndefined();
    expect(statement(db.transaction.mock.calls[1])).toBe('delete from maps where id = ?');
    expect(db.transaction.mock.calls[1]?.slice(1)).toEqual(['missing']);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it.each(operations)(
    '%s propagates identity, query and transaction failures unchanged',
    async (_, run) => {
      const db = database();
      const repository = new PostgresMapStore(db.sql).forUser('alice');
      const failure = new Error('database unavailable');
      db.transaction.mockRejectedValueOnce(failure);
      await expect(run(repository)).rejects.toBe(failure);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      db.transaction.mockResolvedValueOnce([]).mockRejectedValueOnce(failure);
      await expect(run(repository)).rejects.toBe(failure);
      db.begin.mockRejectedValueOnce(failure);
      await expect(run(repository)).rejects.toBe(failure);
    },
  );
});
