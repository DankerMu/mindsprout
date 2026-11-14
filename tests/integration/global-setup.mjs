import { existsSync } from 'node:fs';
import { resetTestDatabase } from '../../scripts/test-database.mjs';

export default async function setup() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }
  const target = await resetTestDatabase('app_test');
  process.env.DATABASE_URL = target.databaseUrl;
  process.env.MIGRATION_DATABASE_URL = target.migrationDatabaseUrl;
}
