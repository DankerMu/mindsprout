# Design: pin-unit-test-timezone

## Context

Stryker's Vitest runner uses the `threads` pool, and plain Vitest uses `forks`. In a worker thread, `process.env` is a thread-local copy. Writing `TZ` there leaves ICU's process-wide default timezone unchanged. A main-thread write updates ICU for the whole process. A worker that already exists also keeps its cached local-time offset in `Date` getters, so the write must happen before any worker starts. Probes on Node 22.23.2 and 24.13.1 confirmed this.

## Goals / Non-Goals

- Goal: every unit test passes in any host timezone under both pools, so Stryker's initial test run passes again.
- Non-goal: changing `formatTimestamp`, the Stryker pool, mutation thresholds or the 0018 budget.

## Decisions

- **Pin the process timezone in `vitest.config.ts`.** The config is evaluated in the main thread of the process that owns the pool, before workers are created. That process is Vitest's, or Stryker's forked runner child, which calls `createVitest` in `init()`. Forked children inherit the variable. Alternative rejected: `stryker.config.mjs` `pool: 'forks'`. It is one line, but the 0018 budget would need re-measuring, and the tests would still depend on pool semantics.
- **The `format-timestamp` zone cases stand in for the browser's local zone through an `Intl.DateTimeFormat` spy.** The spy builds the real formatter with `{ timeZone: caseZone, ...moduleOptions }`. A module that names its own zone overrides the stand-in, and a zone outside the case set fails all three cases. Alternatives rejected: subprocess runs per zone, which are heavy; a product API that takes a zone, which is out of scope.

## Risks / Trade-offs

- Forcing UTC hides any future test that silently depends on the host timezone. The grep guard and the spec requirement make "no runtime TZ write" the rule. A test that needs another zone uses the spy pattern.

## Not yet specified

None.
