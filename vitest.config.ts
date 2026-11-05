import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tier. Coverage is per-file (L4): a well-covered big file cannot subsidize a bare one.
// Threshold source: constraints.yaml testing.min_line_coverage. Every exclude entry below
// has a matching reason + exit_condition in constraints.yaml `exemptions`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/app/**/{page,layout,loading,error,not-found,template,global-error}.tsx',
      ],
      thresholds: { perFile: true, lines: 90, branches: 90, functions: 90, statements: 90 },
      reportsDirectory: 'coverage',
    },
  },
});
