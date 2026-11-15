import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { deriveTestDatabaseTarget } from './test-database.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const target = deriveTestDatabaseTarget('app_e2e', process.env);

// Keep credentials out of Playwright's serialized config (decision 0026).
const child = spawn('pnpm', ['exec', 'next', 'dev', '--port', '3100'], {
  env: {
    ...process.env,
    DATABASE_URL: target.databaseUrl,
    MIGRATION_DATABASE_URL: target.migrationDatabaseUrl,
  },
  stdio: 'inherit',
});
child.once('error', () => {
  console.error('E2E server failed to start');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
