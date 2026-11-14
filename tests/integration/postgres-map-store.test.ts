import { randomUUID } from 'node:crypto';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupDatabase } from '../../scripts/db-setup.mjs';
import { withScratchDatabase } from '../../scripts/test-database.mjs';
import { UnsupportedSchemaVersionError } from '../../src/contexts/account/acl/map';
import { PostgresMapStore } from '../../src/contexts/account/infrastructure/map-store';
import { entriesOf, mapOf, node } from '../support/map-domain';
import { describeMapRepositoryContract } from '../support/map-repository-contract';

let app: Sql;
let owner: Sql;
let store: PostgresMapStore;
let lifetime: Promise<unknown>;
let markReady!: () => void;
let finish!: () => void;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});
const finished = new Promise<void>((resolve) => {
  finish = resolve;
});

// The unchanged contract includes deletes; all map scenarios stay in this disposable database.
beforeAll(async () => {
  lifetime = withScratchDatabase(
    async ({
      databaseUrl,
      migrationDatabaseUrl,
    }: {
      databaseUrl: string;
      migrationDatabaseUrl: string;
    }) => {
      await setupDatabase({ databaseUrl: migrationDatabaseUrl });
      app = postgres(databaseUrl, { max: 1 });
      owner = postgres(migrationDatabaseUrl, { max: 1 });
      store = new PostgresMapStore(app);
      try {
        expect(await app`select current_user as name`).toEqual([{ name: 'mindsprout_app' }]);
        markReady();
        await finished;
      } finally {
        await app.end();
        await owner.end();
      }
    },
  );
  await Promise.race([ready, lifetime]);
});

afterAll(async () => {
  finish();
  await lifetime;
});

async function freshUser(): Promise<string> {
  const id = randomUUID();
  await owner`insert into users (id, username, password_hash) values (${id}, ${id}, 'fixture-hash')`;
  return id;
}

async function expectNoPoolIdentity() {
  const [row] = await app<[{ identity: string | null; pid: number }]>`
    select current_setting('app.user_id', true) as identity, pg_backend_pid() as pid
  `;
  expect([null, '']).toContain(row.identity);
  expect(await app`select id from maps`).toEqual([]);
  return row.pid;
}

function failAfterPut(sql: Sql) {
  let writes = 0;
  const instrument = (transport: Sql | TransactionSql) => {
    const tagged = async (parts: TemplateStringsArray, ...values: Parameters<Sql>[1][]) => {
      const rows = await transport(parts, ...values);
      if (parts.join('').includes('insert into maps')) {
        writes += 1;
        expect(await transport`select id from maps`).toEqual([{ id: 'rollback' }]);
        await transport`select 1 / 0`;
      }
      return rows;
    };
    return Object.assign(tagged, { json: transport.json.bind(transport) });
  };
  const begin = (callback: (tx: TransactionSql) => Promise<unknown>) =>
    sql.begin((tx) => callback(instrument(tx) as unknown as TransactionSql));
  // Instrument pooled queries too, so bypassing begin still exercises a real post-write fault.
  const client = Object.assign(instrument(sql), { begin }) as unknown as Sql;
  return { client, writes: () => writes };
}

describeMapRepositoryContract('PostgresMapStore', async () => store.forUser(await freshUser()));

describe('PostgresMapStore under real RLS', () => {
  it('keeps another user invisible and unchanged through same-id get, put and delete', async () => {
    const alice = store.forUser(await freshUser());
    const bob = store.forUser(await freshUser());
    const original = mapOf(node('alice-root'));
    const replacement = { ...mapOf(node('bob-root')), title: 'Bob' };
    await alice.put(original);
    expect(await bob.list()).toEqual([]);
    expect(await alice.get('m1')).toEqual(original);
    expect(await bob.get('m1')).toBeUndefined();
    expect(await alice.get('m1')).toEqual(original);
    await bob.delete('m1');
    expect(await alice.get('m1')).toEqual(original);
    await bob.put(replacement);
    expect(await bob.get('m1')).toEqual(replacement);
    expect(await bob.list()).toEqual([
      { id: 'm1', title: 'Bob', updatedAt: replacement.updatedAt },
    ]);
    expect(await alice.get('m1')).toEqual(original);
    await bob.delete('m1');
    expect(await bob.get('m1')).toBeUndefined();
    expect(await bob.list()).toEqual([]);
    expect(await alice.get('m1')).toEqual(original);
    await bob.delete('missing');
    expect(await alice.get('m1')).toEqual(original);
  });

  it('round-trips a valid 500-node forest with floating roots, notes, colors and collapsed nodes', async () => {
    const repository = store.forUser(await freshUser());
    const children = Array.from({ length: 498 }, (_, index) =>
      node(`child-${String(index)}`, [], {
        note: `笔记 ${String(index)}\n第二行`,
        color: 'purple',
        collapsed: index % 2 === 0,
      }),
    );
    const map = mapOf(
      node('primary', children.slice(0, 249)),
      node('floating', children.slice(249), {
        position: { x: -300.5, y: 200.25 },
        note: '浮动根',
        color: 'blue',
        collapsed: true,
      }),
    );
    expect(entriesOf(map)).toHaveLength(500);
    expect(new Set(entriesOf(map).map(({ node }) => node.id)).size).toBe(500);
    await repository.put(map);
    expect(await repository.get(map.id)).toStrictEqual(map);
  });

  it('clears transaction identity on the same pooled connection after every committed call', async () => {
    const alice = store.forUser(await freshUser());
    const bob = store.forUser(await freshUser());
    const pid = await expectNoPoolIdentity();
    const map = mapOf(node('root'));
    await alice.put(map);
    expect(await expectNoPoolIdentity()).toBe(pid);
    expect(await alice.get('m1')).toEqual(map);
    expect(await expectNoPoolIdentity()).toBe(pid);
    expect(await bob.list()).toEqual([]);
    expect(await expectNoPoolIdentity()).toBe(pid);
    expect(await alice.list()).toEqual([{ id: 'm1', title: map.title, updatedAt: map.updatedAt }]);
    expect(await expectNoPoolIdentity()).toBe(pid);
    await bob.delete('m1');
    expect(await expectNoPoolIdentity()).toBe(pid);
    expect(await alice.get('m1')).toEqual(map);
  });

  it('refuses identity-free inserts and returns no maps even when rows exist', async () => {
    const userId = await freshUser();
    const map = mapOf(node('root'));
    await store.forUser(userId).put(map);
    await expectNoPoolIdentity();
    await expect(app`
      insert into maps (owner_id, id, schema_version, map)
      values (${userId}, 'forbidden', 1, ${app.json({ ...map, id: 'forbidden' })})
    `).rejects.toMatchObject({ code: '42501' });
    expect(await owner`select id from maps where owner_id = ${userId}`).toEqual([{ id: 'm1' }]);
  });

  it('rolls back a successful put when a database fault occurs before commit and clears identity', async () => {
    const userId = await freshUser();
    const pid = await expectNoPoolIdentity();
    const fault = failAfterPut(app);
    const repository = new PostgresMapStore(fault.client).forUser(userId);
    const outcome = await Promise.allSettled([
      repository.put({ ...mapOf(node('root')), id: 'rollback' }),
    ]);
    expect(fault.writes()).toBe(1);
    expect(await owner`select id from maps where owner_id = ${userId}`).toEqual([]);
    expect(outcome).toMatchObject([{ status: 'rejected', reason: { code: '22012' } }]);
    expect(await expectNoPoolIdentity()).toBe(pid);
    expect(await store.forUser(userId).get('rollback')).toBeUndefined();
  });

  it('propagates the database embedded-id constraint without leaving a row', async () => {
    const userId = await freshUser();
    const map = mapOf(node('root'));
    const input = { ...map, toJSON: () => ({ ...map, id: 'different' }) };
    await expect(store.forUser(userId).put(input)).rejects.toMatchObject({ code: '23514' });
    expect(await owner`select id from maps where owner_id = ${userId}`).toEqual([]);
    await expectNoPoolIdentity();
  });

  it('lists newer-version maps but get rejects them; put and delete remain available', async () => {
    const userId = await freshUser();
    const repository = store.forUser(userId);
    const map = { ...mapOf(node('root')), id: 'future' };
    await owner`insert into maps (owner_id, id, schema_version, map) values (${userId}, ${map.id}, 2, ${owner.json(map)})`;
    await expect(repository.get('future')).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
    await expect(repository.get('future')).rejects.toMatchObject({ found: 2, supported: 1 });
    expect(await repository.list()).toEqual([
      { id: 'future', title: map.title, updatedAt: map.updatedAt },
    ]);
    await repository.put({ ...map, title: 'Readable replacement' });
    expect(await repository.get('future')).toEqual({ ...map, title: 'Readable replacement' });
    expect(await owner`select schema_version from maps where owner_id = ${userId}`).toEqual([
      { schema_version: 1 },
    ]);
    await owner`update maps set schema_version = 2 where owner_id = ${userId}`;
    await repository.delete('future');
    expect(await repository.get('future')).toBeUndefined();
  });

  it('skips missing and JSON-null summary fields while preserving readable and schema2 peers', async () => {
    const userId = await freshUser();
    const repository = store.forUser(userId);
    const map = mapOf(node('root'));
    const withoutTitle: Partial<typeof map> = { ...map };
    const withoutUpdatedAt: Partial<typeof map> = { ...map };
    delete withoutTitle.title;
    delete withoutUpdatedAt.updatedAt;
    const records = [
      { ...withoutTitle, id: 'missing-title' },
      { ...map, id: 'null-title', title: null },
      { ...withoutUpdatedAt, id: 'missing-updated' },
      { ...map, id: 'null-updated', updatedAt: null },
      { ...map, id: 'readable' },
      { ...map, id: 'future' },
    ];
    for (const record of records) {
      await owner`insert into maps (owner_id, id, schema_version, map)
        values (${userId}, ${record.id}, ${record.id === 'future' ? 2 : 1}, ${owner.json(record)})`;
    }
    expect(
      await owner`select id from maps where owner_id = ${userId} and title is null order by id`,
    ).toEqual([{ id: 'missing-title' }, { id: 'null-title' }]);
    expect(
      await owner`select id from maps where owner_id = ${userId} and updated_at is null order by id`,
    ).toEqual([{ id: 'missing-updated' }, { id: 'null-updated' }]);
    expect(await repository.list()).toEqual([
      { id: 'future', title: map.title, updatedAt: map.updatedAt },
      { id: 'readable', title: map.title, updatedAt: map.updatedAt },
    ]);
    expect(await repository.get('readable')).toEqual({ ...map, id: 'readable' });
    await expect(repository.get('future')).rejects.toMatchObject({ found: 2, supported: 1 });
  });
});
