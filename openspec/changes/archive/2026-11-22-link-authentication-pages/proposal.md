# Proposal

## Why

Signed-out visitors land on `/login`, but the product has no discoverable registration entry or way back to sign-in. Navigating between the public forms also loses the requested return path.

## What Changes

- Add a registration link on `/login` and a sign-in link on `/register`.
- Preserve a sanitized same-site `next` in each link; unsafe or missing values produce the fallback behavior without exposing a foreign URL.
- Add component and browser coverage for both directions, unsafe targets and registration returning to the protected page.
- No API, credential submission, visual redesign or password-recovery change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-auth`: define discoverable cross-links between public forms and their `next` preservation.

## Impact

`CredentialsForm`, its paired unit test, account-auth browser coverage, a patch changeset and the account-auth spec. No API or persistence change.

## Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: absent (override: shared auth form and path safety require expanded review)
Blast radius: broken link construction can hide registration or leak an unsafe next target into page navigation
Selected risk packs: file IO/path safety/overwrite; auth/permissions/secrets; legacy compatibility/examples; documentation/migration notes
Evidence floor: unit link cases including hostile next values and no side effects, protected-path-to-register browser flow with explicit session200, full E2E and strict OpenSpec validation
Design.md included for shared auth navigation ownership and sibling surfaces.
