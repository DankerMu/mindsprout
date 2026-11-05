// stryker.config.mjs — mutation testing, scheduled weekly (L4: required, scheduled).
// Surviving mutants are reviewed, not auto-failed; the weekly workflow uploads the report.
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.*', '!src/app/**/{page,layout}.tsx'],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  coverageAnalysis: 'perTest',
  thresholds: { high: 90, low: 70, break: null },
};
