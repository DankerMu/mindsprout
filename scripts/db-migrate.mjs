import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

async function migrationFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function migrateDatabase({ migrationsDir, databaseUrl }) {
  if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL is required');
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('MIGRATION_DATABASE_URL must be a PostgreSQL URL');
  }
  // Server notices may include SQL or credentials; the CLI reports only fixed diagnostics.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const applied = new Set((await sql`select name from schema_migrations`).map((row) => row.name));
    for (const name of await migrationFiles(migrationsDir)) {
      if (applied.has(name)) continue;
      const text = await readFile(join(migrationsDir, name), 'utf8');
      await sql.begin(async (transaction) => {
        await transaction.unsafe(text).simple();
        await transaction`insert into schema_migrations (name) values (${name})`;
      });
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await migrateDatabase({
      migrationsDir: resolve('db/migrations'),
      databaseUrl: process.env.MIGRATION_DATABASE_URL,
    });
  } catch {
    console.error('Migration failed; check MIGRATION_DATABASE_URL and migration SQL.');
    process.exitCode = 1;
  }
}
