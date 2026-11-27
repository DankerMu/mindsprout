# Tasks

## 1. Pool-independent timezone tests

- [x] 1.1 `vitest.config.ts`: set `process.env.TZ = 'UTC'` at load, with a comment on why. Delete the three `vi.stubEnv('TZ', 'UTC')` hoists, their paired `afterAll(() => vi.unstubAllEnvs())`, and any `afterAll` import that becomes unused.
- [x] 1.2 `src/shared/format-timestamp.test.ts`: replace the `process.env.TZ` writes with an `Intl.DateTimeFormat` spy that supplies the case zone as the default `timeZone`, and keep the three expected strings. Write the spy as a `function` or a `class`, because Vitest cannot `new` an arrow function, and call `vi.restoreAllMocks()` in `afterEach`. Prove with a temporary hard-coded `timeZone: 'Asia/Tokyo'` mutation that all three cases fail, then revert it.
- [x] 1.3 Verify: run the four files under `TZ=UTC` and `TZ=America/New_York`, each with `--pool=threads` and `--pool=forks`. Run the Stryker `--dryRunOnly` command in a non-UTC host timezone, then `TZ=America/New_York pnpm exec vitest run --pool=threads` (full suite), the `process.env.TZ`/`stubEnv('TZ'` one-time grep check, `pnpm test:unit`, `pnpm lint`, `pnpm typecheck` and `pnpm fmt:check`.

Suggested fixture level: expanded - shared unit-test configuration
Minimal mergeable slice: atomic - the config pin and the test edits must land together, or the three files lose UTC
