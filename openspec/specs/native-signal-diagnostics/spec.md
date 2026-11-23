# native-signal-diagnostics Specification

## Purpose

Attribute readiness failures in the native signal-fixture handshake without changing browser qualification, process ownership, deadlines or cleanup assertions.

## Requirements

### Requirement: Signal readiness reports bounded phase evidence

The native signal-fixture readiness path SHALL distinguish browser launch, Chromium connection and ready-IPC observation. Immediately after launch, the parent SHALL receive and verify browser identity before connection can block cleanup. When readiness fails, its failure evidence SHALL report the last observed phase and available child exit/error state with bounded, non-secret diagnostic output. Raw stderr and raw error messages SHALL NOT be published: only fixed output states, bounded counters/truncation and an exact full match of the fixture's fixed failure line are allowed. The fixture SHALL retain the existing readiness deadline, verified browser identity before signalling, and all signal/cleanup assertions; later events SHALL NOT retroactively qualify a failed attempt or authorize a test signal.

#### Scenario: Readiness failure identifies the handshake boundary

- **WHEN** a real signal-fixture child cannot complete browser readiness within the existing deadline
- **THEN** the original attempt fails with its last observed launch/connect/ready phase and bounded child status/output, without sending a signal early, publishing raw stderr, relaxing cleanup or treating a later ready message as success

#### Scenario: Connection stall retains browser ownership

- **WHEN** browser launch succeeds but Chromium connection does not complete before readiness fails
- **THEN** the parent has already verified the launched browser identity, sends no test SIGINT/SIGTERM, and reaps both child and browser within the existing teardown bounds

#### Scenario: Untrusted child output is not published

- **WHEN** child stderr contains a credential canary, mixed/multiline content or more than the retained 16 KiB limit
- **THEN** the readiness failure or diagnostic artifact contains only fixed output state and bounded counters/truncation, never the raw content or canary

### Requirement: Unexpected readiness failures retain bounded context

When a readiness assertion receives a trusted bounded failure whose reason differs from the expected reason, the assertion SHALL surface the original safe failure and its phase evidence without accepting it as the expected outcome. Unrecognized or raw errors SHALL NOT be published through this mismatch path.

#### Scenario: A readiness deadline wins before the expected identity failure

- **WHEN** an identity assertion expects verified-browser failure but the original readiness deadline expires first
- **THEN** the test remains failed and reports the original bounded readiness-deadline reason and last observed phase, rather than only an expected-reason mismatch

#### Scenario: An untrusted mismatch is not echoed

- **WHEN** an assertion receives an arbitrary error that was not produced by the bounded readiness path
- **THEN** the mismatch path does not publish that error's raw message, stack, cause or secret-bearing content

### Requirement: Launch timeout remains authoritative after late launch

The signal fixture SHALL preserve the original launching-phase readiness failure when browser launch completes only after the existing deadline. The fixture SHALL NOT authorize a test signal before verified readiness or allow late launch/ready observations to rewrite the failed attempt. It SHALL retain verified late-browser identity exclusively for cleanup so both graceful and forced teardown can reap the owned child and real browser without changing readiness state or diagnostic fields.

#### Scenario: Real launch finishes after the readiness deadline

- **WHEN** actual browser launch is held beyond the original readiness deadline and then released
- **THEN** the original failure reports `launching`, late real launch/ready milestones do not qualify the attempt or authorize a signal, and owned graceful cleanup completes without a residual browser process

#### Scenario: Child termination forces late-browser fallback cleanup

- **WHEN** a real browser launches after the original failure but the child cannot complete graceful collector cleanup
- **THEN** the existing forced reaper uses cleanup-only verified identity to remove the late browser process group while the original rejection, `launching` phase and signal refusal remain unchanged

### Requirement: Native browser files avoid cross-file launch contention

The native browser test command SHALL execute its test files with single-file concurrency while preserving the complete test inventory, per-test deadlines and assertions. It SHALL NOT add retry, warmup or skipped tests to compensate for launch timing.

#### Scenario: Browser-heavy native files run sequentially

- **WHEN** the complete native browser test command runs on a supported platform
- **THEN** test files do not overlap one another, every registered test still runs with its original budget, and a failure remains authoritative rather than being retried or skipped
