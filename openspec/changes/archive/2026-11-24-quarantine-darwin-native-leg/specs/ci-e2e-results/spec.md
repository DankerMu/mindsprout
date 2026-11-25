# ci-e2e-results Specification Delta

## MODIFIED Requirements

### Requirement: E2E result checking preserves failure and artifact contracts

Ordinary E2E assertion failure SHALL remain a failed E2E job and required aggregate. Runtime-result validation SHALL preserve workflow triggers, permissions, top-level concurrency group/cancellation, job identities and dependency handling. All checks passed SHALL retain if:always, its needs set (every CI job except the Darwin installed-native leg while decision 0037 quarantines it) and rejection of failed, cancelled or skipped jobs. UI evidence upload SHALL retain if:always, the ui-evidence artifact name, .run/ui-evidence/ path and if-no-files-found:ignore behavior, including after failure.

#### Scenario: Ordinary assertion failure

- **WHEN** an executed E2E assertion fails
- **THEN** its nonzero result remains authoritative, the required aggregate fails and available UI evidence upload is still attempted
