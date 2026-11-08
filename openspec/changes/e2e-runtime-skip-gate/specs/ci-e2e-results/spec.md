# Spec Delta

## Purpose

Define how the required browser-test tier derives its zero-skip decision from actual same-invocation execution evidence while preserving test failures and route-smoke coverage.

## ADDED Requirements

### Requirement: E2E acceptance uses same-invocation runtime results

The required E2E tier SHALL produce machine-readable results from the same single execution that emits its human-readable console output. Its zero-skip gate SHALL reject any skipped runtime test, identify the skipped case, and fail closed on missing, malformed, structurally invalid or outcome-inconsistent evidence. The report-level errors field SHALL be an empty array for qualification; wrong-typed or nonempty errors SHALL be rejected with attributable diagnostics. A previous invocation's report SHALL NOT qualify. The gate SHALL preserve the existing requirement for at least one route-smoke case in the actual report and SHALL NOT rerun discovery or execution to infer outcomes.

#### Scenario: Runtime skip despite discoverable route tests

- **WHEN** an E2E case is skipped during execution while route-smoke titles remain discoverable
- **THEN** the gate fails with that skipped case's identity and the required aggregate fails

#### Scenario: Complete no-skip execution

- **WHEN** the E2E execution succeeds and its valid report contains no skipped outcomes and retains route-smoke entries
- **THEN** the gate succeeds using that report

#### Scenario: Unusable or stale report

- **WHEN** the current execution produces no report, invalid JSON, invalid consumed fields, inconsistent outcome counts or wrong-typed/nonempty report-level errors, even if a prior report existed
- **THEN** the gate fails with diagnostic evidence rather than accepting the previous or unusable report

#### Scenario: Route-smoke evidence disappears

- **WHEN** a report contains no route-smoke entry despite other successful tests
- **THEN** the gate fails instead of dropping the prior route-presence guarantee

### Requirement: E2E result checking preserves failure and artifact contracts

Ordinary E2E assertion failure SHALL remain a failed E2E job and required aggregate. Runtime-result validation SHALL preserve workflow triggers, permissions, top-level concurrency group/cancellation, job identities and dependency handling. All checks passed SHALL retain if:always, its complete needs set and rejection of failed, cancelled or skipped jobs. UI evidence upload SHALL retain if:always, the ui-evidence artifact name, .run/ui-evidence/ path and if-no-files-found:ignore behavior, including after failure.

#### Scenario: Ordinary assertion failure

- **WHEN** an executed E2E assertion fails
- **THEN** its nonzero result remains authoritative, the required aggregate fails and available UI evidence upload is still attempted
