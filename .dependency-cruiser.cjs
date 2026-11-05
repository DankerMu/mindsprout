/* .dependency-cruiser.cjs — module boundaries for MindSprout (DDD strict).
 * Values mirror constraints.yaml module_boundaries. CI layer1 runs `pnpm boundaries`.
 */
const CONTEXTS = ['map', 'ai', 'account', 'export'];

const crossContextRules = CONTEXTS.map((ctx) => ({
  name: `no-cross-context-${ctx}`,
  comment: `${ctx} may only reach other contexts through its own acl/ directory`,
  severity: 'error',
  from: { path: `^src/contexts/${ctx}/`, pathNot: `^src/contexts/${ctx}/acl/` },
  to: { path: '^src/contexts/', pathNot: `^src/contexts/${ctx}/` },
}));

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular imports are forbidden (constraints.yaml dependencies.no_circular_dependencies)',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'domain/ depends on nothing but itself, src/shared and zod (decision 0005)',
      from: { path: '^src/contexts/[^/]+/domain/' },
      to: {
        pathNot: [
          '^src/contexts/[^/]+/domain/',
          '^src/shared/',
          // zod only, both pnpm layouts; two entries because the single optional-group form
          // `(\.pnpm/[^/]+/node_modules/)?` is rejected by depcruise's safe-regex check.
          '^node_modules/zod/',
          '^node_modules/\\.pnpm/[^/]+/node_modules/zod/',
        ],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'application-not-infrastructure',
      severity: 'error',
      comment: 'application/ orchestrates domain through ports; it never imports infrastructure/',
      from: { path: '^src/contexts/[^/]+/application/' },
      to: { path: '^src/contexts/[^/]+/infrastructure/' },
    },
    {
      name: 'no-framework-in-domain-or-application',
      severity: 'error',
      comment: 'next/react/drizzle/postgres stay in infrastructure/ and src/app',
      from: { path: '^src/contexts/[^/]+/(domain|application)/' },
      to: { path: '^(next|react|react-dom|drizzle-orm|postgres|@supabase)(/|$)' },
    },
    {
      name: 'components-and-shared-not-infrastructure',
      severity: 'error',
      comment: 'client-safe code must not import infrastructure/',
      from: { path: '^src/(components|shared)/' },
      to: { path: '^src/contexts/[^/]+/infrastructure/' },
    },
    {
      name: 'nothing-imports-app-routes',
      severity: 'error',
      comment: 'src/app is the composition root; nothing imports from it',
      from: { path: '^src/', pathNot: '^src/app/' },
      to: { path: '^src/app/' },
    },
    ...crossContextRules,
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
