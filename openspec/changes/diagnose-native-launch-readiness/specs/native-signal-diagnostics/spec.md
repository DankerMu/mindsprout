# Spec Delta

## ADDED Requirements

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
