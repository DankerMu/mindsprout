# Spec Delta

## ADDED Requirements

### Requirement: Unit tests do not depend on the Vitest pool or the host timezone

Every unit test SHALL pass in any host timezone, under both the `forks` pool and the `threads` pool. Stryker's initial test run uses the `threads` pool. No unit test SHALL write `process.env.TZ` at runtime. The unit configuration SHALL fix the process timezone to UTC before any test worker starts. A test that needs another timezone SHALL supply it without changing the process timezone.

#### Scenario: Stryker dry run in a non-UTC host timezone

- **WHEN** `pnpm exec stryker run --mutate src/shared/format-timestamp.ts --dryRunOnly` runs with `TZ=America/New_York`
- **THEN** the initial test run passes and the command exits 0

#### Scenario: Timestamp tests under the threads pool

- **WHEN** the full unit suite runs with `--pool=threads` in the non-UTC host timezone `America/New_York`
- **THEN** it passes with the same results as under `--pool=forks`, and no test file writes `process.env.TZ`
