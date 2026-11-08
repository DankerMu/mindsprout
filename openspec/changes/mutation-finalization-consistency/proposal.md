# Proposal

## Why

Issue #121 identifies contradictory final artifacts: a caught late write failure removes acceptance and fails the step, but finalization.log can still say complete. Diagnostic consumers need the failure state and original write error, not a stale success label.

## Triage

Issue type: bugfix. Fixture level: expanded. Upstream level: absent; file publication and workflow gate integrity require expanded/high-risk review. Blast radius: mutation artifact consumers, not the product or score semantics. Selected packs: CLI/config, file IO, status schema, ordering, compatibility, errors and documentation. Evidence floor: actual production finalizer with native one-shot filesystem faults, same-oracle RED/GREEN, successful control, scoped checks and exact-head hosted full run.

## What Changes

- Synchronize finalization diagnostics after a caught late file-write failure; invalidate stale success before fallible recovery writes.
- Retain original exit precedence, accepted-marker-last ordering, all report validation and unchanged mutation workload/budget.
- Clarify the existing decision0018 failure-output obligation; no new dependency or recovery architecture.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mutation-testing`: add an explicit final-artifact consistency requirement for caught write failures and successful publication.

## Impact

Only the finalization error boundary in .github/workflows/mutation.yml and its existing decision documentation change. Verification harnesses remain disposable; no product code, dependency, test selection, score, timeout, trigger, permission or required-check changes. Functional acceptance is consolidated at the end of the queue.
