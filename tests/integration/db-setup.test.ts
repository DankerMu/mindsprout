import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { withScratchDatabase } from '../../scripts/test-database.mjs';

const cli = resolve('scripts/db-setup.mjs');
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'mindsprout-bootstrap-'));
  try {
    await mkdir(join(root, 'db/migrations'), { recursive: true });
    await mkdir(join(root, 'db/dev'), { recursive: true });
    await writeFile(join(root, 'db/migrations/0001_probe.sql'), 'create table committed (id int);');
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function command(root: string, env: Partial<NodeJS.ProcessEnv>) {
  return spawnSync(process.execPath, ['--env-file-if-exists=.env', cli], {
    cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}
function undisclosed(output: string, url: string) {
  for (const value of [url, new URL(url).password, 'bootstrap-secret-marker']) {
    expect(output).not.toContain(value);
  }
}

describe('development database setup command', () => {
  it('loads a file-only URL and commits migration before executing bootstrap', async () => {
    await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
      await fixture(async (root) => {
        await writeFile(join(root, '.env'), `MIGRATION_DATABASE_URL=${migrationDatabaseUrl}\n`);
        await writeFile(join(root, 'db/dev/app-role.sql'), 'insert into committed values (42);');
        const result = command(root, {});
        expect(result.status).toBe(0);
        undisclosed(result.stdout + result.stderr, migrationDatabaseUrl);
        const sql = postgres(migrationDatabaseUrl, { max: 1 });
        try {
          expect(await sql`select * from committed`).toEqual([{ id: 42 }]);
          expect(await sql`select name from schema_migrations`).toEqual([
            { name: '0001_probe.sql' },
          ]);
        } finally {
          await sql.end();
        }
      });
    });
  });

  it('a bootstrap failure is redacted and leaves previously committed migration records intact', async () => {
    await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
      await fixture(async (root) => {
        await writeFile(
          join(root, 'db/dev/app-role.sql'),
          "do $$ begin raise exception 'bootstrap-secret-marker'; end $$;",
        );
        const result = command(root, { MIGRATION_DATABASE_URL: migrationDatabaseUrl });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Database setup failed');
        undisclosed(result.stdout + result.stderr, migrationDatabaseUrl);
        const sql = postgres(migrationDatabaseUrl, { max: 1 });
        try {
          expect(await sql`select name from schema_migrations`).toEqual([
            { name: '0001_probe.sql' },
          ]);
          expect(await sql`select * from committed`).toHaveLength(0);
        } finally {
          await sql.end();
        }
      });
    });
  });

  it('production refusal preserves a sentinel and constructs no client', async () => {
    await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
      await fixture(async (root) => {
        const sql = postgres(migrationDatabaseUrl, { max: 1 });
        try {
          await sql`create table sentinel (id int)`;
          await sql`insert into sentinel values (7)`;
          const result = command(root, {
            NODE_ENV: 'production',
            MIGRATION_DATABASE_URL: migrationDatabaseUrl,
          });
          expect(result.status).toBe(1);
          expect(result.stderr).toContain('production');
          undisclosed(result.stdout + result.stderr, migrationDatabaseUrl);
          expect(await sql`select * from sentinel`).toEqual([{ id: 7 }]);
          expect(await sql`select to_regclass('schema_migrations') as metadata`).toEqual([
            { metadata: null },
          ]);
          // Install the driver boundary before loading the CLI; static import runs too early.
          const probe = spawnSync(
            process.execPath,
            [
              '--experimental-test-module-mocks',
              '--input-type=module',
              '-e',
              `
            import { mock } from 'node:test';
            mock.module(${JSON.stringify(import.meta.resolve('postgres'))}, { defaultExport: () => { process.exit(97); } });
            process.argv[1] = ${JSON.stringify(cli)};
            await import(${JSON.stringify(pathToFileURL(cli).href)});
          `,
            ],
            {
              cwd: root,
              env: {
                PATH: process.env.PATH,
                NODE_ENV: 'production',
                MIGRATION_DATABASE_URL: migrationDatabaseUrl,
                NODE_NO_WARNINGS: '1',
              },
              encoding: 'utf8',
            },
          );
          expect(probe.status).toBe(1);
          expect(probe.stderr).toContain('production');
        } finally {
          await sql.end();
        }
      });
    });
  });
});
