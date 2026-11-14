import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Integration tier: real Postgres (docker compose locally, service container in CI).
// No self-skip: a missing database is a failure, not a green (verification-tiers rule 6).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globalSetup: ['tests/integration/global-setup.mjs'],
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    passWithNoTests: false,
  },
});
