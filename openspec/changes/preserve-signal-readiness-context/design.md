# Design

## Context

See `proposal.md` and decision 0030/0031's bounded diagnostic ownership. `readinessError` already constructs every trusted fixed reason plus bounded JSON. `publishedSignalReadiness` currently destructures the error and, when the expected prefix differs, replaces the actual failure with a generic assertion. A real delayed-ready IPC probe reproduces the Darwin assertion and reveals a connecting-phase 10-second timeout underneath; this proves the masking mechanism, not the original CI delay's root cause.

## Goals / Non-Goals

**Goals:**

- Preserve trusted bounded rejection identity and message when a caller expected a different readiness reason.
- Keep arbitrary external/raw errors on the existing generic assertion path.
- Make the next natural CI failure show its actual safe phase evidence without changing qualification behavior.

**Non-Goals:**

- No deadline/retry/warmup/skip change, no acceptance of timeout as identity success, no root-cause repair claim.
- No application runtime, signal/cleanup, browser launcher, public API, dependency or artifact schema change.

## Decisions

- Keep a module-local `WeakSet` of error objects created by `readinessError`. The weak marker has no message/schema surface and does not retain failures. `publishedSignalReadiness` receives the original error object; on expected-prefix mismatch it rethrows only an object present in that set. All other mismatches retain the generic assertion. This avoids duplicating the fixed-reason list and never echoes arbitrary raw text.
- Expected-reason parsing and returned status remain unchanged. Rethrowing an unexpected trusted error fails the caller's `assert.rejects` validator, so the original timeout/exit/identity failure still fails the test and appears in TAP with its bounded message.
- Add a fast regression using an actual fixture-produced spawn failure with a deliberately different expected reason. Before the fix, the helper throws its generic assertion; after the fix it must throw the identical bounded error object. Also cover an unmarked raw/canary error so the new path cannot publish it.
- Re-run the real delayed-ready IPC probe as diagnostic evidence: expected old output is the exact Darwin masking assertion; expected new output is the original `Signal child browser readiness exceeded 10000ms` and `phase:"connecting"`, with cleanup still successful. Normal identity and full native suites remain authoritative.

Current behavior/must preserve: fixed readiness reasons and bounded fields, no secret publication, original 10-second deadline, four mode/signal combinations, identity gates and cleanup.
Must add/change: mismatch propagation for trusted readiness errors only; no behavior change for matching reasons.
Governing invariant: an unexpected readiness failure must remain a failure with its original safe diagnostic evidence; it must never be accepted or replaced by less informative output.
Sibling surfaces: timeout, spawn/process error, early exit, launch/ready identity and teardown failures; parent/child IPC and assertion/TAP output.
Seams under test: existing fixture helper with real fixture-produced errors, plus the existing real signal-child test under a throwaway parent-IPC scheduling probe.
Required evidence: focused red-before/green-after mismatch tests; delayed-ready old/new error comparison; ordinary identity tests and `pnpm native:browser:test` green; static/OpenSpec checks and required CI.
Non-goals: root cause of the natural CI delay and any relaxation that makes its red test pass.
Review focus: trusted-error provenance, no raw secret/path publication, mismatch still fails, unchanged schema/deadline/cleanup, and no claim that the injected delay proves the natural root.

## Risks / Trade-offs

- Rethrowing inside an assertion validator changes the displayed failure from the helper assertion to the original error; this is intentional and limited to internally constructed bounded errors.
- A weak marker cannot validate errors reconstructed from serialized text; those remain on the generic path rather than being trusted by shape alone.
- The delayed-ready probe is controlled scheduling evidence only. It must not be checked in as a claimed reproduction of the original CI resource/scheduler cause.
