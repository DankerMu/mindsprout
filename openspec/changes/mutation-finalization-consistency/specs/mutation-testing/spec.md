# Spec Delta

## ADDED Requirements

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
