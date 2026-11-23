# Design

## Context

See `proposal.md`. Decisions 0030/0031 retain original qualification and bounded diagnostic ownership. This issue addresses the signal-fixture readiness handshake before a signal is sent, not the separate public-create deadline or browser-close cleanup timeout.

## Goals / Non-Goals

Goals: identify the last observed launch/connect/IPC stage at the original readiness failure and make child exit/error plus safe output status visible to the existing assertion. Preserve the real child and collector lifecycle.

Non-goals: increasing deadlines, retries/warmup, skipping signal cases, changing application HMR, accepting incomplete cleanup, or presenting instrumentation as a proven latency repair.

## Decisions

- Reuse the existing parent fixture and signal child. Immediately after `launchNativeBrowser` resolves and before awaiting `chromium.connect`, the child sends `browser-launched` with the browser PID and monotonic elapsed time, then sends `connecting`; `ready` remains after successful connect. Only fixed phases and bounded numeric timing are published—no URL, executable path, browser arguments or environment output.
- On `browser-launched`, the parent synchronously captures and verifies the existing browser process identity before connect/ready can block teardown. Partial-startup tests must prove a real launched browser whose connect does not complete still has verified parent ownership and is reaped with the child inside the existing teardown bounds. No test SIGINT/SIGTERM is sent before `ready`; an unavailable or mismatched identity fails closed and never authorizes signaling that process group.
- Parent records phase transitions and current child state. Once readiness fails or teardown starts, later milestones may be marked only as late diagnostic observations: they cannot resolve the original attempt, authorize a test signal, or replace cleanup. Ordinary `ready` still requires verified process identity.
- Raw child stderr and raw spawn error messages are never copied into CI-visible errors or diagnostic artifacts. Cap retained stderr at 16 KiB and count truncation, but do not treat that cap as sanitization: the only publishable excerpt is an exact full match of the fixed `Browser signal fixture failed\n` line, mapped to `fixture-failed`; everything else becomes `unpublished`. Report only bounded counters/truncation and fixed child exit/signal/spawn-state fields. Credential-canary, mixed, multiline and oversized input must remain absent from the final error/artifact.
- Add red/green seam tests for every transition and for launch-success/connect-stalled partial startup using the real handshake protocol/helper, not a fabricated generic delay passed off as the original CI race. Cover the 10-second readiness deadline, late-event fencing, no early test signal, and verified child/browser reaping. Actual real-browser signal/cleanup tests remain authoritative for unchanged cleanup behavior.
- Keep diagnostics inside test-owned files/output and existing cleanup scope. No new runtime environment flag or second launcher/browser implementation.

Change surface: `scripts/native-hmr-runtime-profile.test.mjs`, `scripts/native-hmr-signal-child.mjs`, their existing fixture/support modules and native test documentation if the public command changes (it does not).
Must preserve: four mode/signal combinations, 10-second readiness deadline, real launch/connect/IPC, verified identity before signalling, bounded teardown and no residual process requirements.
Must add/change: fixed phase attribution and bounded failure context on the original readiness path only.
Governing invariant: readiness diagnostics must identify the observed phase without changing when the test sends a signal or treating later readiness/cleanup as success.
Sibling surfaces: default/profile, SIGINT/SIGTERM; parent error/exit and child stderr; no public-create or application source changes.
Seams under test: real parent/child IPC and browser lifecycle through `pnpm native:browser:test`, plus failure-path unit/seam regression for the new diagnostic contract.
Required evidence: a red failing diagnostic case before implementation, bounded phase/exit output after implementation, and four unchanged real signal/cleanup scenarios with all resources reaped.
Non-goals: #260 original public-create evidence, production HMR or JSON/native auth behavior.
Review focus: process identity/ownership, no unbounded output/secrets, timeout semantics, cleanup under partial startup, and evidence that distinguishes instrumentation from root-cause repair.

## Risks / Trade-offs

- Additional IPC milestones can perturb a timing-sensitive test → only fixed-size messages; preserve actual browser launch/connect and deadlines, and measure all four existing cases.
- Raw child stderr may contain environment data → 16 KiB cap only limits memory; CI-visible output is fixed state/counters or an exact full allowlisted failure line. Test credential canaries and oversized/mixed content against final output; never dump environment or browser command lines.
- Instrumentation alone cannot eliminate the intermittent timeout → report as diagnosis improvement; future cause-specific repair requires observed evidence.

## Migration Plan

No deployment or data migration. Revert the diagnostic instrumentation as one change if it destabilizes the real signal tests; retain original cleanup and deadlines.
