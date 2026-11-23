# Proposal

## Why

Darwin CI test 207 expected an identity rejection but its assertion replaced the actual rejection with `Expected bounded diagnostics …`. A deterministic real-IPC delay reproduces the same assertion when the original 10-second readiness deadline wins, so the current helper can hide the exact phase evidence that issue #258 requires.

## What Changes

- Preserve the actual safe readiness failure when `publishedSignalReadiness` receives a different bounded rejection than its caller expected; never accept that failure as satisfying the identity assertion.
- Keep the existing fixed readiness reasons, diagnostic JSON schema, secret guards, 10-second deadline, real launch/connect/IPC path and cleanup assertions unchanged. Do not publish arbitrary raw error text.
- Add a focused regression for mismatched bounded readiness failures and verify the real delayed-ready reproduction reports `Signal child browser readiness exceeded 10000ms` with its last phase instead of the misleading wrapper. This is diagnostic attribution, not acceptance of timeout or proof of the original CI root cause.

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent (override: shared native test helper, CI diagnostics, async ordering and secret-publication boundary)
Blast radius: Darwin native test failure evidence and required CI diagnosability; no product runtime behavior.
Selected risk packs: CI/script entry, concurrency/shared state/ordering, auth/permissions/secrets, error handling/rollback, legacy compatibility.
Evidence floor: mismatched-reason regression fails before the fix and passes after; real delayed-ready path preserves the actual bounded timeout/phase; normal identity cases and full `pnpm native:browser:test` pass; required Darwin/Linux CI remains green without retry/deadline changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-signal-diagnostics`: a readiness assertion that receives an unexpected bounded failure must preserve that failure's safe reason and phase evidence rather than replacing it with an expected-reason assertion.

## Impact

- Existing signal fixture diagnostic helper and its focused native tests; native-signal spec and guide only where needed to describe mismatch behavior.
- No application code, public API, dependency, workflow, native package, retry/warmup, deadline, signal or cleanup change; no changeset for test-only diagnostics.
