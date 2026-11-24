# Proposal

## Why

`/admin` has no way back to the map library (issue #283). The administrator is also an ordinary user with maps; opening `/admin` directly (bookmark, new tab) leaves no browser history, so returning means editing the URL. The ready editor already links back (`返回导图列表`, #235), the non-admin refusal uses a different wording (`返回首页`), and the list-read error state has no exit at all.

## What Changes

- Render one visible, keyboard-focusable `返回导图列表` link targeting `/` at page level in `src/app/admin/page.tsx`, so it is present in the loading, account-list, read-error and refusal states. The session-expired state is out of scope: it already redirects to `/login`.
- Remove the forbidden branch's `返回首页` link from `AdminUserList` so each state has exactly one link to `/` with one wording; the "无权访问" text and the no-account-data guarantee stay.
- No shared component: the editor fix (PR #248) is a one-line inline `next/link`; this repeats that one line.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-admin`: `/admin` links back to the library in every state.

## Impact

`src/app/admin/page.tsx`, `src/components/account/AdminUserList.tsx` (+ paired test), `e2e/account-admin.spec.ts`, a patch changeset, account-admin spec. No API, auth, session, persistence or style-module change.

## Triage

Issue type: feature
Fixture level: compact
Upstream suggested level: absent (compact: one static same-origin link plus removal of a duplicate link; no shared entrypoint, schema, auth logic or persisted state)
Blast radius: a link rendered inside the refused state must not expose account data; a misplaced link could duplicate or disappear in some state
Selected risk packs: Auth / permissions / secrets (preserve refusal); Error handling / rollback / partial outputs (read-error exit); Legacy compatibility / examples (existing admin e2e/smoke assertions); Documentation / migration notes (spec delta + changeset)
Evidence floor: AdminUserList unit tests + coverage; e2e for admin ready (direct open, keyboard activation reaches `/` showing the admin's seeded map), loading, forbidden (+ API 403) and read-error states each with exactly one `/` link; existing account-admin and smoke /admin tests green; strict OpenSpec validation
design.md omitted (compact).
