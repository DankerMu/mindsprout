import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../scripts/db-migrate.mjs';
import { withScratchDatabase } from '../../scripts/test-database.mjs';

const cli = resolve('scripts/db-migrate.mjs');

async function fixture(run: (root: string, directory: string) => Promise<void> | void) {
  const root = await mkdtemp(join(tmpdir(), 'mindsprout-migrations-'));
  const directory = join(root, 'db/migrations');
  await mkdir(directory, { recursive: true });
  try {
    await run(root, directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function command(root: string, databaseUrl: string) {
  return spawnSync(process.execPath, [cli], {
    cwd: root,
    env: { ...process.env, MIGRATION_DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function undisclosed(output: string, databaseUrl: string) {
  const url = new URL(databaseUrl);
  for (const value of [databaseUrl, url.username, url.password]) {
    if (value) expect(output).not.toContain(decodeURIComponent(value));
  }
}

describe('ordered database migrations', () => {
  it('Fresh database: applies files in name order and records each timestamp; Re-run is a no-op', async () => {
    await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
      await fixture(async (root, migrationsDir) => {
        await writeFile(
          join(migrationsDir, '0002_second.sql'),
          "insert into migration_order values (2, 'second');",
        );
        await writeFile(
          join(migrationsDir, '0001_first.sql'),
          "create table migration_order (position int, label text); insert into migration_order values (1, 'first');",
        );
        await writeFile(join(migrationsDir, 'notes.sql'), 'invalid SQL ignored');
        await mkdir(join(migrationsDir, '0003_directory.sql'));
        await migrateDatabase({ migrationsDir, databaseUrl: migrationDatabaseUrl });
        const sql = postgres(migrationDatabaseUrl, { max: 1 });
        try {
          expect(await sql`select * from migration_order order by position`).toEqual([
            { position: 1, label: 'first' },
            { position: 2, label: 'second' },
          ]);
          const records = await sql<
            { name: string; appliedAt: Date }[]
          >`select name, applied_at as "appliedAt" from schema_migrations order by name`;
          expect(records.map((row) => row.name)).toEqual(['0001_first.sql', '0002_second.sql']);
          expect(records.every((row) => row.appliedAt instanceof Date)).toBe(true);
          // Any re-executed statement fails, independently of the metadata assertions.
          await writeFile(join(migrationsDir, '0001_first.sql'), 'invalid SQL must never execute');
          const result = command(root, migrationDatabaseUrl);
          expect(result.status).toBe(0);
          undisclosed(result.stdout + result.stderr, migrationDatabaseUrl);
          expect(
            await sql`select name, applied_at as "appliedAt" from schema_migrations order by name`,
          ).toEqual(records);
          expect(await sql`select count(*)::int as count from migration_order`).toEqual([
            { count: 2 },
          ]);
        } finally {
          await sql.end();
        }
      });
    });
  });

  it('Failing migration: rolls back every statement and its record, retains earlier files and stops before later files', async () => {
    await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
      await fixture(async (root, directory) => {
        await writeFile(join(directory, '0001_first.sql'), 'create table committed (id int);');
        await writeFile(
          join(directory, '0002_failure.sql'),
          "create table partial (id int); do $$ begin raise exception 'credential-marker'; end $$;",
        );
        await writeFile(join(directory, '0003_later.sql'), 'create table later (id int);');
        const result = command(root, migrationDatabaseUrl);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Migration failed');
        expect(result.stdout + result.stderr).not.toContain('credential-marker');
        undisclosed(result.stdout + result.stderr, migrationDatabaseUrl);
        const sql = postgres(migrationDatabaseUrl, { max: 1 });
        try {
          expect(
            await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
          ).toEqual([{ tablename: 'committed' }, { tablename: 'schema_migrations' }]);
          expect(await sql`select name from schema_migrations`).toEqual([
            { name: '0001_first.sql' },
          ]);
        } finally {
          await sql.end();
        }
      });
    });
  });

  it.each(['missing', 'empty'])(
    '%s migration directory exits zero with only metadata',
    async (kind) => {
      await withScratchDatabase(async ({ migrationDatabaseUrl }) => {
        await fixture(async (root, directory) => {
          if (kind === 'missing') await rm(directory, { recursive: true });
          const result = command(root, migrationDatabaseUrl);
          expect(result.status).toBe(0);
          undisclosed(result.stdout + result.stderr, migrationDatabaseUrl);
          const sql = postgres(migrationDatabaseUrl, { max: 1 });
          try {
            expect(await sql`select tablename from pg_tables where schemaname = 'public'`).toEqual([
              { tablename: 'schema_migrations' },
            ]);
            expect(await sql`select * from schema_migrations`).toHaveLength(0);
          } finally {
            await sql.end();
          }
        });
      });
    },
  );

  it('CLI rejects missing and malformed owner URLs without disclosing values', async () => {
    await fixture((root) => {
      for (const value of ['', 'not-a-url-credential-marker']) {
        const result = command(root, value);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Migration failed');
        expect(result.stderr).not.toContain('credential-marker');
      }
    });
  });

  it('documents the built-in environment-loading command without adding dotenv', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.scripts['db:migrate']).toBe(
      'node --env-file-if-exists=.env scripts/db-migrate.mjs',
    );
    expect({ ...manifest.dependencies, ...manifest.devDependencies }).not.toHaveProperty('dotenv');
  });
});
