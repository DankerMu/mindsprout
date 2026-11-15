import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { deriveTestDatabaseTarget } from './scripts/test-database.mjs';

// Preparation runs in a separate process; direct Playwright runs need the same environment.
if (existsSync('.env')) process.loadEnvFile('.env');
deriveTestDatabaseTarget('app_e2e', process.env);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://localhost:3100/api/healthz',
    // E2E must own its server, database and build lock (decision 0026).
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
    },
    timeout: 120_000,
  },
});
