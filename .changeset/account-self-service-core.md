---
'mindsprout': minor
---

Add framework-independent account registration, sign-in, session resolution and sign-out with exact credential bounds and fixed thirty-day sessions. Session issuance atomically binds to the registered or verified credential so password reset invalidates existing sessions and prevents stale issuance. Interrupted registration fails internally while retaining the account and its replacement credential.

Add administrator-only account listing and password reset. Reset returns a temporary password and atomically replaces the credential while ending all of the target's sessions, including the administrator's own sessions on self-reset. Other accounts remain unchanged; non-admin actors are refused before any port operation.

Add Node crypto adapters for asynchronously salted scrypt password hashes with a fixed resource profile, canonical credential verification and timing-safe key comparison. Malformed hashes and verification failures refuse authentication; hashing failures propagate. Session tokens use 32 random bytes and temporary passwords use 12 random bytes, encoded as base64url.

Add injected-client Postgres account and session repositories. First registration is serialized before admin assignment; exact duplicate usernames preserve existing credentials. Session tokens are stored as SHA-256 digests with strict supplied-clock expiry. Password reset and credential-bound issuance share a user-row lock, so reset either removes an issued session or refuses stale issuance while preserving other accounts.

Add the account-to-map ACL and injected-client Postgres map store. Each operation uses transaction-local RLS identity; owner-scoped upserts preserve verbatim maps and isolate identical ids across users. Lists retain readable newer-version summaries while skipping null summary fields; only get rejects newer schema versions. Map routes and browser cutover are not included.

Add GET `/api/auth/session`, returning only the current username and administrator flag or a generic unauthenticated response. Server composition lazily shares a five-connection Postgres pool, preserves opaque session cookies, and provides scoped HttpOnly cookie issuance and clearing with Secure in production. Unexpected failures return a generic internal error without logging credentials. Browser sign-in and other account routes are not included.
