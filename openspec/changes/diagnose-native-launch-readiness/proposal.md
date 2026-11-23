# Proposal

## Why

Two independent Darwin runs now preserve the same natural test-207 failure: the original 10-second deadline expires in `launching`, with no browser-launched milestone, child exit/signal or stderr. This rules out the earlier connect/ready hypotheses and enables a launch-phase-matched regression; the environmental launch trigger still needs a falsifiable contention experiment.

## What Changes

- Add a real `chromium.launchServer` interception at the existing signal-child IPC seam: hold launch past the original deadline, then release the real browser launch. Assert `launching` evidence, no early signal and immutable failure.
- Add a cleanup-only late-browser ownership channel in the existing fixture. It records and verifies a late PID/identity for forced reaping without changing the frozen `launching` phase, original rejection or signal eligibility; cover graceful and forced cleanup with real browsers.
- Run native browser test files with Node's single-file concurrency to test whether cross-file real-browser launch contention is the trigger. Keep every test, assertion and 10-second deadline; measure the scheduling cost and do not add retry/warmup/skip.
- Require two consecutive full GitHub Darwin native qualifications green before accepting the contention hypothesis and closing #258. Any further launching timeout falsifies the mitigation: remove the serialization change, retain the natural evidence and leave the issue open rather than claiming repair.

Issue type: test
Fixture level: expanded
Upstream suggested level: absent (override: shared native test command, real browser process scheduling, file concurrency and cleanup)
Blast radius: native CI scheduling/duration and signal-fixture launch diagnostics; no application runtime behavior.
Selected risk packs: CI/script entry, concurrency/shared state/ordering, error handling/rollback, resource limits, legacy compatibility, documentation/migration notes.
Evidence floor: natural launching failures preserved; graceful launch regression passes; forced late-browser reaper regression fails before cleanup-only ownership and passes after with guaranteed red-run leak cleanup; parallel baseline and serial full native suite compared; two consecutive full GitHub Darwin/Linux qualifications green with no test/deadline weakening, otherwise serialization reverted and issue left open.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-signal-diagnostics`: launch-phase timeout behavior, late-launch fencing and native test-file scheduling needed to validate the observed natural failure without weakening qualification.

## Impact

- Existing signal fixture/reaper, a focused launch test and its inline hook, `package.json`'s native browser test command, native guide and native-signal spec.
- No production code, dependency, workflow, retry/warmup/skip, browser deadline, signal or cleanup-budget change; no changeset for test tooling.
