import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { withScratchDatabase } from '../../scripts/test-database.mjs';

const moduleUrl = pathToFileURL(resolve('scripts/test-database.mjs')).href;

async function subprocess(code: string, env: NodeJS.ProcessEnv) {
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
    env,
  });
  return { code: 0, output: result.stdout + result.stderr };
}
function ownerConnection() {
  const url = new URL(
    process.env.MIGRATION_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test',
  );
  url.pathname = '/postgres';
  return postgres(url.toString(), { max: 1 });
}

describe('test database lifecycle', () => {
  it.each(['success', 'throw'])(
    'scratch cleanup ignores callback descriptor mutation on %s',
    async (outcome) => {
      const sql = ownerConnection();
      const names: string[] = [];
      const original = new Error('callback failure');
      try {
        await withScratchDatabase(async (first) => {
          names.push(first.databaseName);
          expect(first.databaseName).toMatch(/^app_scratch_[a-z0-9]+$/);
          expect(
            await sql`select datname from pg_database where datname = ${first.databaseName}`,
          ).toHaveLength(1);
          const inner = withScratchDatabase(async (second) => {
            names.push(second.databaseName);
            expect(second.databaseName).not.toBe(first.databaseName);
            expect(
              await sql`select datname from pg_database where datname = ${second.databaseName}`,
            ).toHaveLength(1);
            expect(new URL(second.databaseUrl).pathname).toBe(`/${second.databaseName}`);
            expect(new URL(second.migrationDatabaseUrl).pathname).toBe(`/${second.databaseName}`);
            second.databaseName = first.databaseName;
            if (outcome === 'throw') throw original;
            return 'callback result';
          });
          if (outcome === 'throw') await expect(inner).rejects.toBe(original);
          else expect(await inner).toBe('callback result');
          if (names[1] === undefined) throw new Error('Inner scratch callback did not run');
          expect(
            await sql`select datname from pg_database where datname = ${names[1]}`,
          ).toHaveLength(0);
          expect(
            await sql`select datname from pg_database where datname = ${first.databaseName}`,
          ).toHaveLength(1);
          const outer = postgres(first.migrationDatabaseUrl, { max: 1 });
          try {
            expect(await outer`select current_database() as name`).toEqual([
              { name: first.databaseName },
            ]);
          } finally {
            await outer.end();
          }
        });
        expect(
          await sql`select datname from pg_database where datname in ${sql(names)}`,
        ).toHaveLength(0);
      } finally {
        for (const name of names) await sql`drop database if exists ${sql(name)} with (force)`;
        await sql.end();
      }
    },
  );

  it.each(['pathname', 'query'])(
    'reset binds the %s destination and preserves its disposable source',
    async (kind) => {
      await withScratchDatabase(async ({ databaseName, migrationDatabaseUrl, databaseUrl }) => {
        const maintenance = ownerConnection();
        const existing =
          await maintenance`select datname from pg_database where datname = 'app_e2e'`;
        const source = postgres(migrationDatabaseUrl, { max: 1 });
        const targetUrl = new URL(migrationDatabaseUrl);
        targetUrl.pathname = '/app_e2e';
        const target = postgres(targetUrl.toString(), { max: 1 });
        const code = `
        import assert from 'node:assert/strict';
        import postgres from ${JSON.stringify(import.meta.resolve('postgres'))};
        import { resetTestDatabase, withScratchDatabase } from ${JSON.stringify(moduleUrl)};
        async function check(destination, name) {
          for (const url of [destination.databaseUrl, destination.migrationDatabaseUrl]) {
            const sql = postgres(url, { max: 1 });
            try {
              assert.equal((await sql\`select current_database() as name\`)[0].name, name);
              assert.equal((await sql\`show application_name\`)[0].application_name, 'destination-probe');
            } finally { await sql.end(); }
          }
        }
        const target = await resetTestDatabase('app_e2e');
        await check(target, 'app_e2e');
        await withScratchDatabase(async scratch => {
          await check(scratch, scratch.databaseName);
          const sql = postgres(scratch.migrationDatabaseUrl, { max: 1 });
          try {
            assert.equal((await sql\`select count(*)::int as count from pg_stat_activity
              where application_name = 'destination-probe' and datname = 'postgres'\`)[0].count, 1);
          } finally { await sql.end(); }
        });
      `;
        const options =
          kind === 'query'
            ? `?application_name=destination-probe&database=${databaseName}&%64atabase=${databaseName}`
            : '?application_name=destination-probe';
        const env = {
          ...process.env,
          DATABASE_URL: databaseUrl + options,
          MIGRATION_DATABASE_URL: migrationDatabaseUrl + options,
        };
        try {
          await source`create table source_sentinel (id int)`;
          expect((await subprocess(code, env)).code).toBe(0);
          await target`create table reset_sentinel (id int)`;
          expect((await subprocess(code, env)).code).toBe(0);
          expect(
            await target`select to_regclass('public.reset_sentinel') as sentinel, to_regclass('public.schema_migrations') as metadata`,
          ).toEqual([{ sentinel: null, metadata: 'schema_migrations' }]);
          expect(await source`select to_regclass('public.source_sentinel') as sentinel`).toEqual([
            { sentinel: 'source_sentinel' },
          ]);
        } finally {
          await source.end();
          await target.end();
          if (existing.length === 0) await maintenance`drop database app_e2e`;
          await maintenance.end();
        }
      });
    },
  );

  it('refuses every non-allowlisted reset before even opening a socket', async () => {
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TCP listener unavailable');
    try {
      const result = await subprocess(
        `
        import { resetTestDatabase } from ${JSON.stringify(moduleUrl)};
        for (const name of ['app_dev', 'postgres', 'arbitrary', 'app_test;drop database app_dev', 'APP_TEST', '']) {
          try { await resetTestDatabase(name); process.exitCode = 1; }
          catch (error) { if (!error.message.includes('app_test or app_e2e')) throw error; }
        }
      `,
        {
          ...process.env,
          DATABASE_URL: 'invalid-app-credential-marker',
          MIGRATION_DATABASE_URL: `postgres://sentinel:credential-marker@127.0.0.1:${String(address.port)}/app_dev`,
        },
      );
      expect(result.code).toBe(0);
      expect(result.output).toBe('');
      expect(connections).toBe(0);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
