# Proposal

## Why

The database setup integration test treats an empty PostgreSQL URL password as a forbidden substring. Every string contains it, so valid passwordless test environments fail without demonstrating a secret leak.

## What Changes

- Run full-URL and bootstrap sentinel disclosure assertions for every URL.
- Assert a parsed password is undisclosed only when that password is nonempty.
- Add consumer-visible regression coverage for passwordless URLs and actual leaks, preserving runtime and authentication behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `database-lifecycle`: define secret-redaction test behavior for empty and nonempty PostgreSQL URL credentials.

## Impact

Integration test `tests/integration/db-setup.test.ts` only; no production code, authentication policy, test gate or dependency changes.

Issue type: bugfix
Fixture level: none
Upstream suggested level: absent (agree: isolated test expectation correction without runtime behavior)
Blast radius: weakening redaction tests could hide leaked credentials; leaving the empty-string assertion blocks valid passwordless integration runs.
Selected risk packs: auth / permissions / secrets; error handling / partial outputs; legacy compatibility / examples; documentation / migration notes for the recorded test contract.
Evidence floor: record the seven-case baseline/post-fix matrix: only passwordless clean acceptance is RED before the fix; the other clean acceptance and isolated rejection controls are already GREEN; passwordless sentinel rejection is masked pre-fix by the empty-password error. Deterministic synthetic-URL tests for all seven cases post-fix plus real-Postgres integration and lint/format/secret guard checks.
Design: omitted at `none`; preserve the public `db-setup` behavior and existing redaction seam.
