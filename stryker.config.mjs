// stryker.config.mjs — mutation testing, scheduled weekly (L4: required, scheduled).
// Surviving mutants are reviewed, not auto-failed; the weekly workflow uploads the report.
export default {
  testRunner: 'vitest',
  // pnpm's isolated layout keeps vitest-runner out of the default '@stryker-mutator/*' glob dir.
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.*', '!src/app/**/{page,layout}.tsx'],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  coverageAnalysis: 'perTest',
  thresholds: { high: 90, low: 70, break: null },
};
