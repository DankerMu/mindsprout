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
  it('scratch databases exist inside callbacks, have unique names, and are dropped on success and the original throw', async () => {
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
        await expect(
          withScratchDatabase(async (second) => {
            names.push(second.databaseName);
            expect(second.databaseName).not.toBe(first.databaseName);
            expect(
              await sql`select datname from pg_database where datname = ${second.databaseName}`,
            ).toHaveLength(1);
            expect(new URL(second.databaseUrl).pathname).toBe(`/${second.databaseName}`);
            expect(new URL(second.migrationDatabaseUrl).pathname).toBe(`/${second.databaseName}`);
            throw original;
          }),
        ).rejects.toBe(original);
        expect(
          await sql`select datname from pg_database where datname = ${first.databaseName}`,
        ).toHaveLength(1);
      });
      expect(
        await sql`select datname from pg_database where datname in ${sql(names)}`,
      ).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });

  it('reset rewrites source URLs, creates the allowed target and removes its sentinel without touching the source', async () => {
    await withScratchDatabase(async ({ migrationDatabaseUrl, databaseUrl }) => {
      const maintenance = ownerConnection();
      const existing = await maintenance`select datname from pg_database where datname = 'app_e2e'`;
      const source = postgres(migrationDatabaseUrl, { max: 1 });
      const targetUrl = new URL(migrationDatabaseUrl);
      targetUrl.pathname = '/app_e2e';
      const target = postgres(targetUrl.toString(), { max: 1 });
      const code = `
        import assert from 'node:assert/strict';
        import { resetTestDatabase } from ${JSON.stringify(moduleUrl)};
        const target = await resetTestDatabase('app_e2e');
        assert.equal(new URL(target.databaseUrl).pathname, '/app_e2e');
        assert.equal(new URL(target.migrationDatabaseUrl).pathname, '/app_e2e');
      `;
      const env = {
        ...process.env,
        DATABASE_URL: databaseUrl,
        MIGRATION_DATABASE_URL: migrationDatabaseUrl,
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
  });

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
