import { defineConfig } from 'vitest/config';

// Contract tier: public API schema snapshot (Pillar 4). Runs inside `pnpm test:unit`'s
// sibling job in CI; kept separate so a schema diff is reported as a contract failure.
export default defineConfig({
  test: {
    include: ['tests/contract/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
