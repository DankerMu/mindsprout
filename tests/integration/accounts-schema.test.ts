import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../scripts/db-migrate.mjs';
import { withScratchDatabase } from '../../scripts/test-database.mjs';

const owner = postgres(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1 });
const app = postgres(process.env.DATABASE_URL ?? '', { max: 1 });
afterAll(async () => {
  await app.end();
  await owner.end();
});

const map = {
  id: 'shared',
  title: 'First map',
  roots: [{ id: 'root', text: 'Root', children: [] }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
async function user(sql = owner) {
  const id = randomUUID();
  await sql`insert into users (id, username, password_hash) values (${id}, ${id}, 'hash')`;
  return id;
}

describe('accounts and maps database boundary', () => {
  it.each(['superuser', 'bypassrls'])(
    'migration refuses an existing %s role without changing shared privileges',
    async (attribute) => {
      const migration = await readFile(resolve('db/migrations/0001_accounts_and_maps.sql'), 'utf8');
      const before =
        await owner`select oid, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'mindsprout_app'`;
      await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
        const sql = postgres(migrationDatabaseUrl, { max: 1 });
        const rollback = new Error('Rollback isolated role probe');
        try {
          await expect(
            sql.begin(async (tx) => {
              // Roles are cluster-global: unsafe attributes must never be committed.
              await tx.unsafe(`alter role mindsprout_app ${attribute}`);
              const unsafe =
                await tx`select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'mindsprout_app'`;
              expect(unsafe).toEqual([
                {
                  rolcanlogin: true,
                  rolsuper: attribute === 'superuser',
                  rolbypassrls: attribute === 'bypassrls',
                },
              ]);
              await expect(
                tx.savepoint(async (probe) => {
                  await probe.unsafe(migration).simple();
                }),
              ).rejects.toMatchObject({
                code: '42501',
                message: 'mindsprout_app must not have SUPERUSER or BYPASSRLS.',
              });
              expect(
                await tx`select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'mindsprout_app'`,
              ).toEqual(unsafe);
              expect(await tx`select to_regclass('public.users') as users`).toEqual([
                { users: null },
              ]);
              expect(
                await owner`select oid, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'mindsprout_app'`,
              ).toEqual(before);
              throw rollback;
            }),
          ).rejects.toBe(rollback);
        } finally {
          await sql.end();
          expect(
            await owner`select oid, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'mindsprout_app'`,
          ).toEqual(before);
        }
      });
    },
  );

  it('Application role cannot bypass isolation and can use but not create in rebuilt public', async () => {
    expect(await app`select current_user as name`).toEqual([{ name: 'mindsprout_app' }]);
    expect(
      await owner`select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'mindsprout_app'`,
    ).toEqual([{ rolcanlogin: true, rolsuper: false, rolbypassrls: false }]);
    expect(
      await owner`select tablename from pg_tables where tableowner = 'mindsprout_app'`,
    ).toHaveLength(0);
    expect(
      await owner`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'maps'::regclass`,
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(await app`select * from maps`).toHaveLength(0);
    await expect(app`create table forbidden (id int)`).rejects.toMatchObject({ code: '42501' });
  });

  it('Query without a user identity hides existing maps and rejects valid inserts specifically through RLS', async () => {
    const id = await user();
    await owner`insert into maps (owner_id, id, schema_version, map) values (${id}, 'shared', 1, ${owner.json(map)})`;
    expect(await owner`select id from maps where owner_id = ${id}`).toEqual([{ id: 'shared' }]);
    for (const identity of [undefined, '']) {
      await app.begin(async (tx) => {
        if (identity !== undefined) await tx`select set_config('app.user_id', ${identity}, true)`;
        expect(await tx`select * from maps`).toHaveLength(0);
      });
      const insertion = app.begin(async (tx) => {
        if (identity !== undefined) await tx`select set_config('app.user_id', ${identity}, true)`;
        await tx`insert into maps (owner_id, id, schema_version, map) values (${id}, 'new', 1, ${tx.json({ ...map, id: 'new' })})`;
      });
      await expect(insertion).rejects.toMatchObject({ code: '42501' });
      await expect(insertion).rejects.toThrow(/row-level security/);
    }
  });

  it('matching identity permits CRUD, generated fields track payloads and ids are scoped per owner', async () => {
    const alice = await user();
    const bob = await user();
    await owner`insert into maps (owner_id, id, schema_version, map) values (${alice}, 'shared', 1, ${owner.json(map)})`;
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${bob}, true)`;
      expect(await tx`select * from maps`).toHaveLength(0);
      await tx`insert into maps (owner_id, id, schema_version, map) values (${bob}, 'shared', 1, ${tx.json(map)})`;
      expect(await tx`select id, title, updated_at, map from maps`).toEqual([
        { id: 'shared', title: 'First map', updated_at: '2026-01-02T00:00:00.000Z', map },
      ]);
      await tx`update maps set map = ${tx.json({ ...map, title: 'Renamed', updatedAt: '2026-02-01T00:00:00.000Z' })}`;
      expect(await tx`select title, updated_at from maps`).toEqual([
        { title: 'Renamed', updated_at: '2026-02-01T00:00:00.000Z' },
      ]);
      expect(await tx`delete from maps returning owner_id`).toEqual([{ owner_id: bob }]);
      expect(await tx`select * from maps`).toHaveLength(0);
    });
    expect(await owner`select map from maps where owner_id = ${alice}`).toEqual([{ map }]);
    expect(await app`select * from maps`).toHaveLength(0);
    await expect(
      owner`insert into maps (owner_id, id, schema_version, map) values (${bob}, 'wrong', 1, ${owner.json(map)})`,
    ).rejects.toMatchObject({ code: '23514' });
    const insertion = app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${bob}, true)`;
      await tx`insert into maps (owner_id, id, schema_version, map) values (${alice}, 'new', 1, ${tx.json({ ...map, id: 'new' })})`;
    });
    await expect(insertion).rejects.toMatchObject({ code: '42501' });
    await expect(insertion).rejects.toThrow(/row-level security/);
  });

  it('permits authentication operations but denies admin updates and table ownership operations', async () => {
    const id = await user(app);
    expect(await app`select is_admin from users where id = ${id}`).toEqual([{ is_admin: false }]);
    await app`update users set password_hash = 'replacement' where id = ${id}`;
    expect(await app`select password_hash from users where id = ${id}`).toEqual([
      { password_hash: 'replacement' },
    ]);
    await app`insert into sessions (token_hash, user_id, expires_at) values (${id}, ${id}, '2027-01-01T00:00:00Z')`;
    expect(await app`select user_id from sessions where token_hash = ${id}`).toEqual([
      { user_id: id },
    ]);
    await expect(app`update users set is_admin = true where id = ${id}`).rejects.toMatchObject({
      code: '42501',
    });
    await expect(app`delete from users where id = ${id}`).rejects.toMatchObject({ code: '42501' });
    await expect(
      app`update sessions set expires_at = now() where token_hash = ${id}`,
    ).rejects.toMatchObject({ code: '42501' });
    expect(await app`delete from sessions where token_hash = ${id} returning token_hash`).toEqual([
      { token_hash: id },
    ]);
    for (const table of ['users', 'sessions', 'maps', 'schema_migrations']) {
      await expect(app`drop table ${app(table)}`).rejects.toMatchObject({ code: '42501' });
      await expect(app`alter table ${app(table)} add column forbidden int`).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(app`select * from schema_migrations`).rejects.toMatchObject({ code: '42501' });
  });

  it('single-admin index rejects a distinct valid second admin and cascade deletes dependent rows', async () => {
    await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
      await migrateDatabase({
        migrationsDir: resolve('db/migrations'),
        databaseUrl: migrationDatabaseUrl,
      });
      const sql = postgres(migrationDatabaseUrl, { max: 1 });
      try {
        const first = randomUUID();
        const second = randomUUID();
        await sql`insert into users (id, username, password_hash, is_admin) values (${first}, 'first', 'hash', true)`;
        await expect(
          sql`insert into users (id, username, password_hash, is_admin) values (${second}, 'second', 'hash', true)`,
        ).rejects.toMatchObject({ code: '23505', constraint_name: 'users_single_admin' });
        await sql`insert into sessions (token_hash, user_id, expires_at) values ('token', ${first}, now())`;
        await sql`insert into maps (owner_id, id, schema_version, map) values (${first}, 'shared', 1, ${sql.json(map)})`;
        await sql`delete from users where id = ${first}`;
        expect(await sql`select * from sessions`).toHaveLength(0);
        expect(await sql`select * from maps`).toHaveLength(0);
      } finally {
        await sql.end();
      }
    });
    expect(await owner`select rolname from pg_roles where rolname = 'mindsprout_app'`).toHaveLength(
      1,
    );
  });

  it('persists the D1 column, key and ordered-index contract', async () => {
    const columns = await owner<
      { table: string; column: string; type: string; nullable: string; generated: string }[]
    >`select table_name as table, column_name as column, data_type as type, is_nullable as nullable, is_generated as generated from information_schema.columns where table_schema = 'public' and table_name in ('users', 'sessions', 'maps') order by table_name, ordinal_position`;
    expect(columns.map((c) => [c.table, c.column, c.type, c.nullable, c.generated])).toEqual([
      ['maps', 'id', 'text', 'NO', 'NEVER'],
      ['maps', 'owner_id', 'uuid', 'NO', 'NEVER'],
      ['maps', 'schema_version', 'integer', 'NO', 'NEVER'],
      ['maps', 'map', 'jsonb', 'NO', 'NEVER'],
      ['maps', 'title', 'text', 'YES', 'ALWAYS'],
      ['maps', 'updated_at', 'text', 'YES', 'ALWAYS'],
      ['sessions', 'token_hash', 'text', 'NO', 'NEVER'],
      ['sessions', 'user_id', 'uuid', 'NO', 'NEVER'],
      ['sessions', 'expires_at', 'timestamp with time zone', 'NO', 'NEVER'],
      ['sessions', 'created_at', 'timestamp with time zone', 'NO', 'NEVER'],
      ['users', 'id', 'uuid', 'NO', 'NEVER'],
      ['users', 'username', 'text', 'NO', 'NEVER'],
      ['users', 'password_hash', 'text', 'NO', 'NEVER'],
      ['users', 'is_admin', 'boolean', 'NO', 'NEVER'],
      ['users', 'created_at', 'timestamp with time zone', 'NO', 'NEVER'],
    ]);
    const indexes = await owner<
      { indexdef: string }[]
    >`select indexdef from pg_indexes where schemaname = 'public'`;
    expect(indexes.map((i) => i.indexdef)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('UNIQUE INDEX maps_pkey ON public.maps USING btree (owner_id, id)'),
        expect.stringContaining(
          'ON public.maps USING btree (owner_id, updated_at DESC, id COLLATE "C")',
        ),
        expect.stringContaining('ON public.sessions USING btree (user_id)'),
      ]),
    );
  });
});
