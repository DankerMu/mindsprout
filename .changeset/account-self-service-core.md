---
'mindsprout': minor
---

Add framework-independent account registration, sign-in, session resolution and sign-out with exact credential bounds and fixed thirty-day sessions. Session issuance atomically binds to the registered or verified credential so password reset invalidates existing sessions and prevents stale issuance. Interrupted registration fails internally while retaining the account and its replacement credential. Persistence and cryptography remain injected ports; this core does not expose account routes or browser sign-in.

Add administrator-only account listing and password reset. Reset returns a temporary password and atomically replaces the credential while ending all of the target's sessions, including the administrator's own sessions on self-reset. Other accounts remain unchanged; non-admin actors are refused before any port operation.

Add Node crypto adapters for asynchronously salted scrypt password hashes with a fixed resource profile, canonical credential verification and timing-safe key comparison. Malformed hashes and verification failures refuse authentication; hashing failures propagate. Session tokens use 32 random bytes and temporary passwords use 12 random bytes, encoded as base64url. Production composition and account routes are not included.
