import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { migrateDatabase } from './db-migrate.mjs';

export function assertDevelopmentDatabaseSetup() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Database setup is unavailable in production.');
  }
}

export async function setupDatabase({ databaseUrl }) {
  assertDevelopmentDatabaseSetup();
  await migrateDatabase({ migrationsDir: resolve('db/migrations'), databaseUrl });
  const bootstrap = await readFile(resolve('db/dev/app-role.sql'), 'utf8');
  // Bootstrap failure does not undo migrations already committed by the runner.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(bootstrap).simple();
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await setupDatabase({ databaseUrl: process.env.MIGRATION_DATABASE_URL });
  } catch {
    console.error(
      process.env.NODE_ENV === 'production'
        ? 'Database setup is unavailable in production.'
        : 'Database setup failed; check MIGRATION_DATABASE_URL and database SQL.',
    );
    process.exitCode = 1;
  }
}
