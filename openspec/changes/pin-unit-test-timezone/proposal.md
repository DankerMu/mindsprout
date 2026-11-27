# Proposal: pin-unit-test-timezone

Issue type: bug
Fixture level: expanded
Upstream suggested level: absent (expanded: `vitest.config.ts` is the shared unit-test configuration, as the precedent m1-canvas 5.x set; no product code, gate threshold or workflow changes)
Blast radius: a wrong edit could make the timestamp tests stop proving local-timezone formatting, mask a host-timezone dependency elsewhere in the unit suite, or leave Stryker's dry run red, which keeps the mutation signal off.
Selected risk packs: Config / project setup (`vitest.config.ts` sets the process timezone before workers start; forks and threads pools give the same results). Not selected: Public API, Schema, Auth, File IO, Concurrency, Legacy, Release, Docs.
Evidence floor:

- `TZ=UTC` and `TZ=America/New_York` runs of the four affected files pass with both `--pool=threads` and `--pool=forks`.
- `pnpm exec stryker run --mutate src/shared/format-timestamp.ts --dryRunOnly` exits 0 in a non-UTC host timezone.
- A temporary mutation that hard-codes a `timeZone` outside the case set (`Asia/Tokyo`) fails all three `format-timestamp` zone cases (`Tests 3 failed`). The mutation is reverted.
- The full unit suite passes under `TZ=America/New_York pnpm exec vitest run --pool=threads`, without coverage.
- `grep -rnE "process\.env\.TZ|stubEnv\('TZ'" src tests` has no hit.
- `pnpm test:unit` passes with per-file coverage. `pnpm lint`, `pnpm typecheck` and `pnpm fmt:check` pass.
- PR CI passes, including the `Mutation testing (stryker, advisory)` initial test run, which `vitest.config.ts` triggers.

## Why

Issue #324. `@stryker-mutator/vitest-runner` runs Vitest in its default `threads` pool. Inside a worker thread, `process.env` is a thread-local copy, so writing `TZ` does not change ICU's default timezone. Plain Vitest defaults to `forks`, where it does. Four test files added in #251 write `TZ` at runtime. Since then, Stryker's initial test run fails in every host timezone: on CI the `format-timestamp` Los_Angeles case fails, and on a UTC-5 host the MapLibrary cases fail. No mutant runs, and every PR that touches a mutation path trigger goes red.

## What Changes

- `vitest.config.ts`: sets `process.env.TZ = 'UTC'` at load, with a comment naming the failure mode. The config loads in the runner's main thread before any worker starts, so every pool and every host sees UTC.
- `src/components/library/MapLibrary.test.tsx`, `MapLibrary-mutations.test.tsx` and `src/components/account/AdminUserList.test.tsx`: delete `vi.hoisted(() => vi.stubEnv('TZ', 'UTC'))` and its paired `afterAll(() => vi.unstubAllEnvs())`, plus the `afterAll` import where it becomes unused. The config now provides UTC.
- `src/shared/format-timestamp.test.ts`: stops writing `process.env.TZ`. Each zone case stands in for the browser's local timezone: it spies `Intl.DateTimeFormat` so that the module's formatter is built as the real constructor with `{ timeZone: <case zone>, ...moduleOptions }`, then re-imports the module. A formatter that names its own `timeZone` overrides the stand-in and fails the case. The expected strings (UTC, Los_Angeles, Shanghai) are unchanged.
- `src/shared/format-timestamp.ts` is unchanged. `stryker.config.mjs` keeps the `threads` pool, so the 170-minute budget of decision 0018 still holds.

## Impact

Tests and `vitest.config.ts` only. `vitest.integration.config.ts` and `vitest.contract.config.ts` are untouched, because their tests format no local time. There is no decision record, because this is a mechanical test-configuration edit, and no changeset, because nothing is user-visible. Closes #324.
