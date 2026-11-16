---
id: 0028
title: Bind queued map writes to the invoking account
kind: bug-fix
status: implemented
date: 2026-11-16
---

# Bind queued map writes to the invoking account

## Problem

The HTTP repository preserves same-session mutation order by deferring later requests behind a per-document tail. That also defers cookie lookup. Sign-out, same-document sign-in and the supported new-tab re-login path can replace the shared session cookie while the old document and serialized map body remain alive. Without an account binding, an older Alice operation can run with Bob's cookie and persist Alice's content under Bob; RLS cannot reject a request that legitimately authenticates as Bob.

## Decision

Bind first-party browser repositories to the account, not to an individual session token:

- Login and registration set `mindsprout_session_binding` to the base64url UTF-8 encoding of the exact username, with the same 30-day Path=/, SameSite=Lax and production-Secure scope as the authentication cookie but without HttpOnly. It is an opaque client binding, not an authentication credential. Logout clears both cookies; the HttpOnly `mindsprout_session` remains the only session credential.
- The provider keys its cached document repository by the binding read from `document.cookie`. A changed binding produces a new adapter on the next provider open; an old adapter remains bound to its original account. If the cookie is absent or empty (including a valid credential-only legacy session), the default provider substitutes an empty but present header value rather than constructing a headerless first-party adapter. The server rejects it, and same-account reauthentication establishes the binding before map access.
- `HttpMapRepository` captures that value and sends it as `x-mindsprout-session-binding` on every list/get/put/delete request. `requireUser` compares a present header with the binding derived from the authenticated exact username. A mismatch returns the existing 401 `unauthenticated` response before map access. Missing headers retain the existing API contract for test/API clients; first-party adapters always send one.
- Same-account reauthentication produces the same binding, so pending edits may continue after the supported new-tab re-login. A different account fails closed even if a cookie changes after the client queued the request. No client notification is relied on for authorization.

## Alternatives considered

- **BroadcastChannel or storage-event invalidation.** Cookie replacement and event delivery are not atomic; a predecessor can settle in that gap and release the stale write. Events may still be useful for UI freshness, but are not an authorization boundary.
- **Fresh-document sign-out only.** It destroys the old queue for that one navigation path, but cannot destroy the original editor when a user signs in through the supported new-tab path.
- **Bind to the session token.** It would reject the same account's newly issued session and break the specified pending-edit recovery after re-login. Exposing the token to JavaScript would also defeat HttpOnly.
- **Server revisions, client sequence columns and deletion tombstones.** These can address distributed mutation ordering, but are unnecessary for the account-confusion defect and introduce a schema/protocol migration. Same-adapter transport ordering remains the separate decision recorded in OpenSpec D10.2.
- **Client-only generation checks without a server comparison.** They cannot prove which cookie the browser will attach when deferred fetch actually executes.

## Consequences

- The server check is the fail-closed boundary; JavaScript can read or alter the binding but cannot use it to authenticate. A client that forges the current account's binding can only act as that already-authenticated account.
- The new header is additive and optional for existing direct API callers. The default first-party provider never omits it: a missing binding cookie becomes a guaranteed-mismatch empty header and requires same-account reauthentication before map access. Explicitly unbound adapter constructors remain test/direct-client seams. All login/register/logout routes and browser repository construction must preserve the two-cookie invariant together.
- Account switching in either the same document or another tab rejects stale queued operations with the existing session-ended classification; Bob's own new adapter continues normally. Same-account re-login does not discard pending edits.
- The binding contains only a reversible encoding of the username already returned to the signed-in browser. It is never logged and carries no password, session token, map content or owner UUID.
- No active decision is superseded. [Decision 0023](../architecture/0023-self-hosted-accounts-on-postgres-rls.md) continues to govern sessions and RLS; [decision 0025](../architecture/0025-expired-session-document-navigation.md) continues to govern fresh-document load expiry and new-tab editing recovery.
- Rollback removes the binding cookie, header comparison, provider binding key and cross-account regressions together with the ordered transport that requires them. Restoring unordered HTTP writes without another ordering mechanism reopens the data-loss defect.
