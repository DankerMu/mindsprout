# Spec Delta

## ADDED Requirements

### Requirement: Unexpected readiness failures retain bounded context

When a readiness assertion receives a trusted bounded failure whose reason differs from the expected reason, the assertion SHALL surface the original safe failure and its phase evidence without accepting it as the expected outcome. Unrecognized or raw errors SHALL NOT be published through this mismatch path.

#### Scenario: A readiness deadline wins before the expected identity failure

- **WHEN** an identity assertion expects verified-browser failure but the original readiness deadline expires first
- **THEN** the test remains failed and reports the original bounded readiness-deadline reason and last observed phase, rather than only an expected-reason mismatch

#### Scenario: An untrusted mismatch is not echoed

- **WHEN** an assertion receives an arbitrary error that was not produced by the bounded readiness path
- **THEN** the mismatch path does not publish that error's raw message, stack, cause or secret-bearing content
