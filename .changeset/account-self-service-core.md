---
'mindsprout': minor
---

Add framework-independent account registration, sign-in, session resolution and sign-out with exact credential bounds and fixed thirty-day sessions. Session issuance atomically binds to the registered or verified credential so password reset invalidates existing sessions and prevents stale issuance. Interrupted registration fails internally while retaining the account and its replacement credential.

Add administrator-only account listing and password reset. Reset returns a temporary password and atomically replaces the credential while ending all of the target's sessions, including the administrator's own sessions on self-reset. Other accounts remain unchanged; non-admin actors are refused before any port operation.

Add Node crypto adapters for asynchronously salted scrypt password hashes with a fixed resource profile, canonical credential verification and timing-safe key comparison. Malformed hashes and verification failures refuse authentication; hashing failures propagate. Session tokens use 32 random bytes and temporary passwords use 12 random bytes, encoded as base64url.

Add injected-client Postgres account and session repositories. First registration is serialized before admin assignment; exact duplicate usernames preserve existing credentials. Session tokens are stored as SHA-256 digests with strict supplied-clock expiry. Password reset and credential-bound issuance share a user-row lock, so reset either removes an issued session or refuses stale issuance while preserving other accounts.

Add the account-to-map ACL and injected-client Postgres map store. Each operation uses transaction-local RLS identity; owner-scoped upserts preserve verbatim maps and isolate identical ids across users. Lists retain readable newer-version summaries while skipping null summary fields; only get rejects newer schema versions.

Add GET `/api/auth/session`, returning only the current username and administrator flag or a generic unauthenticated response. Server composition lazily shares a five-connection Postgres pool, preserves opaque session cookies, and provides scoped HttpOnly cookie issuance and clearing with Secure in production. Unexpected failures return a generic internal error without logging credentials.

Add POST `/api/auth/register` and `/api/auth/login`, returning only the username and administrator flag and setting the session cookie on success. Malformed JSON and non-string credential fields return `400 invalid-input` before account or session operations; exact-string bounds remain in the account core. Duplicate usernames return 409, invalid sign-in credentials return 401, and interrupted registration returns a generic 500 without a cookie or retry. Browser sign-in is not included.

Add POST `/api/auth/logout`, deleting the current session and clearing its cookie with an empty 204 response, including absent or unknown sessions. Register, login and logout share an application/json media-type guard that returns `415 unsupported-media-type` before reading the body or changing state. Logout failures return a generic 500 without clearing the cookie or logging secrets.

Add authenticated GET `/api/maps` and `/api/maps/{id}` on the shared account Postgres pool. Lists preserve repository order; individual reads return a version-one map envelope, 404 for absent or other-user maps, or 409 with the stored unsupported version. Session denial precedes map access and dynamic parameters. Unexpected failures return a generic 500 without logging map content or credentials.

Add authenticated PUT and DELETE `/api/maps/{id}` with the shared JSON media guard. PUT limits declared and streamed bodies to 1 MiB and validates the forest, version and path id before saving; invalid maps return 400 and oversized bodies return 413 without writing. DELETE is idempotent for absent or other-user maps. Both return empty 204 responses on success; browser storage cutover is not included.

Serialize development role bootstrap through a shared maintenance-database lock while keeping per-database migrations concurrent. Scratch database setup retains LOGIN credentials, role safety flags and application grants without racing updates to the cluster-wide role catalog.
