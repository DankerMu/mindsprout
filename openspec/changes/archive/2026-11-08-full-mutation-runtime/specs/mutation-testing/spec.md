# Spec Delta

## ADDED Requirements

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
