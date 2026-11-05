# TypeScript / Next.js rules

Stack clauses relocated from `AGENTS.md` (which keeps only the hard kernel). Thresholds come from `constraints.yaml`; enforcement lives in `eslint.config.mjs`, `tsconfig.json`, `.dependency-cruiser.cjs`.

## TypeScript

- **Toolchain**: TypeScript 5.9, Node 22.23 (`.tool-versions`, `package.json` `engines.node`). Package manager pnpm 10, pinned in `packageManager`; lockfile committed.
- **`tsconfig.json`**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals/Parameters`, `useUnknownInCatchVariables`. Relaxing any flag must be justified in the PR description. No `// @ts-ignore`; `// @ts-expect-error` only with an explanation.
- **Linter**: ESLint 9 flat config, `typescript-eslint` strict + stylistic type-checked. Warnings are errors in CI. Naming convention rejects `_v2` / `V2` / `New` / `Old` / `Legacy` suffixes in identifiers (same regex family as `constraints.yaml`).
- **Formatter**: Prettier (`.prettierrc.json`); `lint-staged` runs ESLint + Prettier on changed files in pre-commit.
- **Anti-drift**: duplicate code `jscpd` (2%), dead exports/dependencies `knip`, conventional commits `commitlint`, cycles + layer boundaries `dependency-cruiser`.
- **Size discipline**: files over 700 effective lines or cyclomatic complexity over 10 fail ESLint. Split by feature, route, component responsibility, or server/client boundary before asking to raise a limit.
- **Tests**: Vitest, `*.test.ts(x)` adjacent to source. Coverage 90% per file (`vitest.config.ts`). Route components (`page.tsx`, `layout.tsx`, …) are exempt from unit coverage and verified by the Playwright tier — `constraints.yaml exemptions`.
- **Imports**: no barrel files (`index.ts` re-exporting everything). Direct imports only. `@/` maps to `src/`.
- **Types over interfaces** for unions/intersections; **interfaces over types** for extensible object shapes. Be consistent within a module.
- **Forbidden**: `any` (use `unknown` and narrow); `as` casts without a justification comment; `console.log/info/debug` (use `src/shared/logger.ts`; `warn`/`error` allowed); default exports outside Next.js route files.

## React / Next.js

- Function components only. Server Components by default; `"use client"` only when interactivity requires it, at the top of the file.
- State: `useState`/`useReducer` locally; Zustand only for the map editor store, which dispatches `TreeOp`s (decision 0003). Server state via Route Handlers / Server Components.
- Effects: `react-hooks/exhaustive-deps` is an error. Do not pre-emptively memoize; measure first.
- Data fetching: Server Components or Route Handlers; no `fetch` in `useEffect` for anything non-trivial.
- Forbidden: `<a href>` for internal links (use `<Link>`); inline `style` for static styles; mixing CSS systems.

## Universal stack rules

- Lockfile is the source of truth for resolved versions; run `pnpm install --frozen-lockfile` after pulling and never hand-edit `pnpm-lock.yaml`.
- A new dependency needs a justification line in the PR (what it does, why an existing tool cannot). A package introduced but unused is a CI failure (`knip`).
- Major-version upgrades go through Renovate PRs (`renovate.json`, 3-day minimum release age), never inside a feature PR.
- Allowed licenses: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD. Others need an explicit decision record.
- **Tunables dichotomy**: deployment-varying values (limits, endpoints, feature toggles) are validated config fields (`src/shared/env.ts`), not `DEFAULT_*` constants scattered at call sites. Protocol constants and security invariants are fixed in code, never config.
- **Misconfiguration fails loud**: invalid or missing config throws at load (`loadEnv`); an env toggle set to an unexpected value is an error, never a silent no-op.
