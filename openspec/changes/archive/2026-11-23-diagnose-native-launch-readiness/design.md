# Design

## Context

See `proposal.md` and the archived native-signal diagnostics contract. Natural runs 45143217383 and 45145539846 attempt 2 both report test 207 timing out in `launching` (10.007s and 10.034s), with spawned child and no exit/signal/stderr. The existing connect-stall regression is not a match. Current native tests run multiple files concurrently; contention is the leading falsifiable trigger, not an established OS root cause.

## Goals / Non-Goals

**Goals:**

- Pin the natural launching-phase outcome using the real launch/IPC/child cleanup path.
- Test cross-file launch-contention mitigation without changing any test assertion or deadline.
- Close #258 only if the launch regression and repeated full CI qualifications support the matched mechanism.

**Non-Goals:**

- No claim about an unobserved Playwright-internal or OS resource cause; no product HMR change.
- No increased deadline, retry, warmup, skipped test, weaker cleanup or reduced native test inventory.

## Decisions

- Add focused launch cases in `native-hmr-signal-launch.test.mjs` to the existing native command. An inline child preload wraps the real `chromium.launchServer`: it reports a fixed `launch-stalled` test message, waits for `release-launch`, then calls the original launcher. No alternate browser implementation or fabricated timeout is introduced; the existing readiness clock produces the failure.
- The graceful case proves no SIGINT is authorized, parses the original 10-second `launching` rejection, then releases actual launch and observes real late `browser-launched`/`ready` IPC. The original rejection and parent phase remain immutable and signals remain refused. The existing child collector closes the real browser; guaranteed teardown verifies no surviving process group even when an earlier assertion fails.
- Add a separate cleanup-only ownership record inside `startSignalChild`, outside the diagnostic `observed` schema. Normal verified launch initializes it. A late `browser-launched` received after terminal readiness may initialize it only after PID/process-group identity verification, but must not mutate `observed.phase`, `observed.browserPid`, the original rejection or signal eligibility. `reapSignalChild` consumes this record for its existing verified fallback reaper; all ordinary consumers retain their current ownership behavior.
- Add a forced-cleanup case: after the same original launch timeout and real late launch, terminate the child so graceful collector cleanup cannot complete, then invoke the existing reaper fallback. Before the ownership channel, the real late browser survives because authoritative `observed.browserPid` is null; this is the genuine red regression. After the fix, the fallback reaps the verified late browser while the original failure/phase remain unchanged. Test-owned `after`/finally cleanup uses the captured real PID to guarantee no leak even on the red run.
- The graceful case is a preservation regression for #263/#267 and the natural CI failures are its red oracle. The forced case supplies a genuine local red-before/green-after for the newly identified ownership defect. Do not delete diagnostics or expect the correct launching timeout itself to become success.
- Add Node `--test-concurrency=1` to the existing `native:browser:test` command. This serializes test files, not tests within a file, and preserves every file in the same order. The measured local serial baseline is 265/265 in 53.478s versus approximately 23.5s parallel; the additional roughly 30 seconds bounds scheduling cost.
- Treat serialization as a falsifiable contention experiment. Require two consecutive full GitHub Darwin native jobs green on the final head, with Linux and required checks also green. If launching recurs, revert the flag in the same PR, record falsification and leave #258 open; never use a lucky green rerun alone as root proof.

Current behavior/must preserve: real launch/connect/IPC, fixed bounded reasons and observed schema, original 10-second deadline, no pre-ready signal, authoritative late-event fencing, existing cleanup budgets and all 265 current tests.
Must add/change: graceful and forced launch regressions, cleanup-only late ownership, and single-file native scheduling; no application behavior change.
Governing invariant: launch timeout remains authoritative after late launch, every verified late browser remains owned by cleanup, and CI scheduling must not reduce qualification coverage or alter per-test budgets.
Sibling surfaces: default/profile launch, SIGINT/SIGTERM, child exit/stderr, graceful/forced reaping, browser process identity, other native test files and CI runtime.
Seams under test: real `chromium.launchServer` interception inside the existing signal child, the existing reaper fallback, and public `pnpm native:browser:test`.
Required evidence: natural launching logs; graceful preservation; forced-cleanup red-before/green-after with guaranteed test-owned leak cleanup; serial 267/267 local suite; two consecutive full final-head CI qualifications green or explicit falsification/rollback.
Non-goals: increasing timeout, hiding intermittent failures, changing readiness state to facilitate cleanup, or claiming serialization proves an OS-level root cause.
Review focus: cleanup-only provenance and identity, release/reap on every failure path, no real browser leak on red or green, immutable failed state/signal refusal, complete test discovery, scheduling-only diff and honest root-cause wording.

## Risks / Trade-offs

- Cleanup now retains verified late-browser identity solely for reaping; it must never feed readiness, diagnostics or signal authorization.
- Forced-case red execution deliberately proves the old leak, so independent test-owned cleanup is mandatory even when the assertion fails.
- Serial files add about 30 seconds locally and more on CI; this is explicit scheduling overhead, not hidden retry/warmup.
- Each launch case consumes one original 10-second timeout plus real launch/cleanup; serial scheduling prevents added cross-file contention.
- Two green CI runs cannot prove every environmental cause. They only support contention as the trigger for this repeated launching signature; any contrary failure reopens the hypothesis.
