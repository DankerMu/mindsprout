import { existsSync } from 'node:fs';
import { resetTestDatabase } from '../../scripts/test-database.mjs';

export default async function setup() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }
  try {
    const target = await resetTestDatabase('app_test');
    process.env.DATABASE_URL = target.databaseUrl;
    process.env.MIGRATION_DATABASE_URL = target.migrationDatabaseUrl;
  } catch (error) {
    // Reconstruct only fixed diagnostics; reporter properties and causes may contain secrets.
    const diagnostic = [
      'DATABASE_URL must be a PostgreSQL URL',
      'MIGRATION_DATABASE_URL must be a PostgreSQL URL',
    ].find((message) => message === error?.message);
    throw new Error(
      diagnostic ??
        'Integration database setup failed; check database configuration and migrations.',
    );
  }
}
