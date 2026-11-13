# Proposal

## Why

PRD §8 M2 acceptance is "换设备能看到同一张图". Today maps live only in one browser's IndexedDB (M1), with no accounts and no server persistence. The owner's Stage 1 grill (2026-11-13, decision 0023) fixed how M2 gets there: lightweight self-hosted username + password accounts on plain Postgres with RLS, sign-in required, and the browser-only storage retired.

## What Changes

- **Accounts (new, `account` context).** Users register openly and sign in with a username and password.
  - Passwords are stored as a scrypt hash.
  - Sessions are server rows referenced by an httpOnly cookie, valid for 30 days. Signing out deletes the session.
  - The first user to register on an empty database becomes the single admin.
  - There is no password change, no recovery flow and no login throttling (decision 0023 non-goals).
- **Admin panel (new).** `/admin` lists users and resets a user's password to a one-time-displayed temporary password. A reset signs that user out everywhere. Admins cannot read anyone's maps.
- **Cloud map storage (new).**
  - Maps are stored in Postgres under RLS: `owner_id = current_setting('app.user_id')`. The app role is neither table owner nor `BYPASSRLS`, and migrations run as a separate owner role.
  - New routes `/api/maps` and `/api/maps/{id}` implement the existing `MapRepository` contract over HTTP. The server validates every saved map against the forest invariants.
  - Another user's map is indistinguishable from a missing one (404).
- **Database tooling (new).** Numbered SQL migrations applied by `pnpm db:migrate` through the existing `postgres` package. There is no ORM.
- **Sign-in required (BREAKING, user-visible).**
  - `src/proxy.ts` redirects signed-out visitors to `/login?next=<path>`. `/login`, `/register`, `/api/auth/*` and `/api/healthz` stay public.
  - Every route handler verifies the session itself.
  - A session that expires mid-edit shows a notice and keeps pending edits.
- **Browser storage removed (BREAKING).**
  - The browser saves through `/api/maps`.
  - The IndexedDB adapter, the in-memory fallback, the "未保存到浏览器" banner and `StorageUnavailableError` are deleted, along with the `idb` and `fake-indexeddb` dependencies.
  - Existing browser-local maps are not imported.
  - The `MapRepository` port and its contract suite stay.
- The stored `schemaVersion` stays 1; M1's announced bump to 2 is withdrawn. Concurrent editing of one map on two devices is last-write-wins and documented.
- Verification surfaces:
  - The CI e2e job gains a Postgres service.
  - Playwright runs against its own reset database with a seeded admin.
  - `smoke/api.hurl` covers the new routes.
  - The M2 acceptance walk uses two browser contexts.

## Capabilities

### New Capabilities

- `account-auth`: registration, sign-in, sign-out, sessions, first-admin assignment, sign-in-required routing and session expiry.
- `account-admin`: the admin user list and admin password reset.
- `cloud-map-storage`: the per-user server map store behind `/api/maps`. Covers isolation by RLS, payload validation, the HTTP contract and the migration-managed schema with its least-privilege role.

### Modified Capabilities

- `map-persistence`:
  - Autosave writes to the cloud store.
  - The versioned envelope travels over HTTP.
  - The pagehide flush is a keepalive request.
  - A session that expires while editing gets its own notice.
  - The "Storage unavailable is visible" requirement is removed.
- `map-library`:
  - The library lists the signed-in user's cloud maps.
  - The unknown-id requirement now covers other users' maps.
  - The unreadable-map scenarios are restated against the store rather than raw IndexedDB records.
  - The "Library works without storage" requirement is removed.
  - The README limitations requirement is revised for cloud storage and accounts.

## Impact

- **New code:**
  - `src/contexts/account/{domain,application,infrastructure,acl}`
  - `src/contexts/map/domain` (map payload parser, unauthorized storage error)
  - `src/contexts/map/infrastructure/persistence` (HTTP adapter)
  - `src/app/api/{auth,maps,admin}/**`, plus a server-only composition module in `src/app/`
  - `src/proxy.ts`
  - `/login`, `/register` and `/admin` pages, and the header session menu
  - `db/migrations/`, a migration runner in `scripts/`, and integration tests under `tests/integration/`
- **Removed code:**
  - The IndexedDB adapter and its tests
  - The in-memory fallback wiring, the storage-unavailable banner and `StorageUnavailableError`
  - `e2e/storage-fallback.spec.ts`
  - The IndexedDB seeding in `e2e/support/seed.ts`, replaced by API seeding
- **Dependencies:**
  - No new runtime dependency (`postgres` and `node:crypto` already exist).
  - `idb` and `fake-indexeddb` are removed.
- **APIs:**
  - New: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/api/maps`, `/api/maps/{id}`, `/api/admin/users`, `/api/admin/users/{id}/password-reset`.
  - Each new route gets an entry in `schemas/openapi.yaml`, a snapshot update and coverage in `smoke/api.hurl`.
- **Configuration:**
  - `.env.example`: `DATABASE_URL` now names the app role, `MIGRATION_DATABASE_URL` is new, and the Supabase variables are removed.
  - `docker-compose.yml` gains a dev role bootstrap.
  - `.github/workflows/ci.yml` changes in layer3 (migrate and app role) and layer7 (Postgres service).
  - `playwright.config.ts` uses its own e2e database and server.
  - `constraints.yaml` updates the key routes.
  - `AGENTS.md` adds the `db:*` commands, a migration verification row and the new critical paths.
  - Every edit to a gate or Critical Path above is flagged in its PR, with `pnpm test:guardrails` evidence.
- **Documents:** decision 0023 and the PRD/TECH/CONTEXT/AGENTS/README revisions already landed on this branch. This change adds the database and deployment procedure to `docs/engineering/database.md`, and updates README `## Known Limitations` and TECH §7 as the code lands.
