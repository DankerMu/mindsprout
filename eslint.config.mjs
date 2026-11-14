import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// Catches both snake_case (`auth_v2`, `auth_new`) and PascalCase (`AuthV2`, `AuthNew`) drift.
// Pattern source: constraints.yaml → code_canonicality.forbidden_suffixes.patterns. Keep in sync.
const forbiddenVersionSuffix =
  '(_v[0-9]+|_new|_old|_backup|_temp|_copy|_final|_real|_improved|_refactored|_fixed|_legacy|_deprecated|V[0-9]+|New|Old|Backup|Temp|Copy|Final|Real|Improved|Refactored|Fixed|Legacy|Deprecated)$';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'reports/**',
      '.stryker-tmp/**',
      '.run/**',
      '.claude/**',
      '.agents/**',
      '.codex/**',
      // Local tooling is not project source; see decisions/implemented/process/0012-root-local-tooling-outside-project-lint.md.
      '.omp/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@next/next': nextPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // Size discipline — values from constraints.yaml size_limits (L4: 700 / 10). Severity error at L2+.
      'max-lines': ['error', { max: 700, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      // Observability — structured logger only (AGENTS.md ## Observability).
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'forbid',
          custom: { regex: forbiddenVersionSuffix, match: false },
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
          custom: { regex: forbiddenVersionSuffix, match: false },
        },
        {
          selector: 'objectLiteralProperty',
          format: null,
          custom: { regex: forbiddenVersionSuffix, match: false },
        },
        { selector: 'import', format: null },
      ],
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      'max-lines': ['error', { max: 700, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
    },
  },
  prettierConfig,
);
