# mutation-testing Specification

## Purpose

How `pnpm mutation` (Stryker, `stryker.config.mjs`) runs, locally and in the weekly advisory job.

## Requirements

### Requirement: Mutation testing runs under the repository's pnpm layout

`pnpm mutation` SHALL load the vitest test runner under pnpm's default isolated layout and write the HTML report to `reports/mutation/index.html`. Survivors are advisory and never fail the run.

#### Scenario: Weekly mutation job

- **WHEN** the weekly `Mutation testing (stryker, advisory)` job runs
- **THEN** it completes without "Cannot find TestRunner plugin" and uploads the `mutation-report` artifact

### Requirement: Full mutation completion is bounded and verifiable

The hosted mutation workflow SHALL execute the entire configured mutant scope within an evidence-based command deadline and a larger job deadline that reserves time for cleanup and artifact upload. It SHALL retain the existing mutation scope, test selection, concurrency, per-mutant timeouts and advisory thresholds. Successful execution SHALL produce nonempty final HTML and JSON reports, with exactly one native terminal result for every planned mutant at its corresponding source path and no missing, duplicate, unexpected or Pending result. Native tool-error statuses SHALL remain visible and SHALL NOT be converted to killed or surviving mutants.

#### Scenario: Full configured execution completes

- **WHEN** the mutation command completes within its bounded budget and the final report exactly covers its plan
- **THEN** the workflow reports successful completion and uploads final score/report artifacts with the existing advisory thresholds

#### Scenario: Incomplete or mismatched report

- **WHEN** a final HTML or JSON report is independently absent or empty, the plan is absent, duplicated or empty, or a report misses a planned mutant, duplicates or invents an ID, binds an ID to the wrong source path, or contains Pending or an unknown status
- **THEN** completion validation fails rather than treating that report as a full mutation result

#### Scenario: Native tool-error status remains visible

- **WHEN** a completed planned mutant has native RuntimeError status
- **THEN** its exact status remains visible and counts as a terminal result, without conversion to Killed, Survived or Ignored and without omission as skipped work

### Requirement: Interrupted mutation retains diagnostic evidence

A mutation command failure or deadline termination SHALL remain nonzero even if log capture or artifact upload succeeds. The workflow SHALL stop its owned diagnostic sampler and attempt to upload available phase logs, process/resource samples, emitted mutation events and exit metadata even when no final score/report exists. Missing diagnostic artifacts SHALL be reported as failure; partial evidence SHALL never be described as a completed score.

#### Scenario: Bounded interruption

- **WHEN** the mutation command reaches its deadline before every planned mutant completes
- **THEN** the workflow fails, preserves the interruption status and uploads its available diagnostic artifacts without claiming a final score

#### Scenario: Failure before mutant execution

- **WHEN** initialization fails before the first mutation result
- **THEN** the workflow retains the failing phase and process exit evidence, cleans up its sampler and does not report mutation completion

#### Scenario: Command failure with otherwise usable reports

- **WHEN** the mutation command exits nonzero even though report files are present and usable
- **THEN** the command failure remains authoritative, available artifacts are retained as diagnostics, and the workflow does not claim accepted mutation completion

#### Scenario: Required diagnostic is missing

- **WHEN** a required diagnostic artifact is missing
- **THEN** the workflow fails explicitly, attempts to upload other available evidence, and does not claim successful completion

#### Scenario: Diagnostic cleanup is bounded to owned resources

- **WHEN** execution succeeds, fails before mutation or is interrupted by its deadline
- **THEN** the workflow stops and reaps its owned sampler without terminating an unrelated process

### Requirement: Mutation finalization artifacts agree on the terminal outcome

A caught finalization write failure SHALL preserve nonzero failure and invalidate accepted completion. Retained finalization diagnostics SHALL NOT retain a stale complete label. When recovery writes succeed, the terminal log SHALL identify diagnostics-only failure and the caught write error, and exit metadata SHALL agree. Successful finalization SHALL retain complete diagnostics and publish its accepted-completion marker last.

#### Scenario: Late terminal metadata or acceptance write fails once

- **WHEN** the terminal log has been written successfully and a one-shot filesystem failure occurs while writing terminal metadata or the accepted-completion marker
- **THEN** the invocation exits nonzero, the marker is absent, exit metadata is diagnostics-only with nonzero status, and the retained terminal log records the caught write error instead of complete

#### Scenario: Failure-log recovery cannot be written

- **WHEN** a late finalization write fails and writing its failure log also fails
- **THEN** the invocation remains nonzero without accepted completion or a retained stale complete terminal log

#### Scenario: Successful finalization publishes acceptance last

- **WHEN** finalization completes without a filesystem failure
- **THEN** the invocation exits zero, log and exit metadata indicate complete, and the accepted-completion marker is published after those diagnostics

### Requirement: Debug-level mutation runs initialize with the repository Vitest config

Enabling Stryker debug logging SHALL NOT change whether the Vitest runner initializes or which tests run. Logging the resolved Vitest configuration MUST tolerate circular and non-JSON values while still emitting the configuration content for diagnosis.

#### Scenario: Circular resolved Vitest config at debug level

- **WHEN** a mutation run starts with debug logging and the resolved Vitest config contains a circular reference such as `resolvedProjects[0].viteConfig.test`
- **THEN** runner initialization completes and the initial test run starts
- **AND** the debug log contains a `vitest final config:` message naming the top-level keys `root`, `include` and `resolvedProjects`
- **AND** an info-level run executes the same number of initial tests and logs no `vitest final config:` message

### Requirement: Collected runner errors are always reportable

Formatting a collected error for a mutation report SHALL NOT throw because the value cannot be converted with `String`; a value whose `name`, `message` or `stack` accessor itself throws is outside this guarantee (upstream parity). When a value cannot be converted with `String`, the formatter MUST return its `name: message` and stack when present, or the object tag otherwise, and the runner MUST return its original error result with every collected message.

#### Scenario: Unstringifiable value in the Vitest error set

- **WHEN** a Vitest run collects a null-prototype error-like value together with an ordinary `Error`
- **THEN** the runner returns an error result instead of throwing
- **AND** its error message contains the formatted null-prototype value and the ordinary error's message
- **AND** values that were already formattable produce the same text as before
