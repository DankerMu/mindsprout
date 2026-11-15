import { resetTestDatabase } from './test-database.mjs';

try {
  await resetTestDatabase('app_e2e');
} catch {
  // Driver errors and causes can contain credentials; expose only a fixed diagnostic.
  console.error('E2E database setup failed; check database configuration and migrations.');
  process.exitCode = 1;
}
