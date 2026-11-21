# Preserve pre-hydration credentials

## Why

Issue #217's login trace loses a typed username before submission. A real-browser replay isolates the loss to the first controlled-input render after hydration: early DOM input survives hydration, but empty React state overwrites it when the other field changes.

## What Changes

- Preserve early username and password input on both authentication forms.
- Submit the current native field values without changing endpoints, JSON bodies, redirects, validation, or pending/error behavior.
- Add hydration-boundary regression coverage and verify real login and registration.

## Capabilities

### New Capabilities

- `account-auth`: add the credential-retention requirement to the same capability path used by the pending M2 change. Main specs do not contain it yet; the two deltas add different requirements and can archive in either order.

### Modified Capabilities

None.

## Impact

`CredentialsForm`, its paired tests, authentication browser verification, and a patch changeset. No API/schema/dependency/CI change.

## Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent; expanded for shared authentication UI and hydration ordering.
Blast radius: login and registration credentials can be lost or sent incorrectly.
Selected risk packs: Auth / permissions / secrets; Concurrency / shared state / ordering; Legacy compatibility / examples; Error handling / rollback / partial outputs; Documentation / migration notes.
Evidence floor: failing hydration regression, scoped component coverage, real browser JSON payload plus session identity, existing account-auth E2E including native POST cases, unchanged noise and timeout assertions.
