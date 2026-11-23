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
