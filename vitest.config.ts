import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tier. Coverage is per-file (L4): a well-covered big file cannot subsidize a bare one.
// Threshold source: constraints.yaml testing.min_line_coverage. Every exclude entry below
// has a matching reason + exit_condition in constraints.yaml `exemptions`.
// A test file's environment follows its extension: `.test.ts` runs in the `node` project,
// `.test.tsx` in the `dom` project (jsdom + tests/support/dom-shims.ts). The root sets no
// `include`/`environment`: projects inherit the root with arrays concatenated, so a root
// include would pull `.test.tsx` files into the node project as well.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/support/dom-shims.ts'],
        },
      },
    ],
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
