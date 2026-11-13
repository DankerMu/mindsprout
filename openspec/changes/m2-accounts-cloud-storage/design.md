# Design

## Context

See proposal.md (Why) and decision 0023 for the chosen direction. Facts that shape the approach:

- **Repository port.** `MapRepository { list, get, put, delete }` and its errors live in `src/contexts/map/domain/`. `put` stores verbatim, `list` orders by `updatedAt` desc then id asc, and `UnsupportedSchemaVersionError` comes only from `get`. A reusable contract suite exists: `tests/support/map-repository-contract.ts`, `describeMapRepositoryContract`, 12 cases. The repository is chosen once per document session in `src/app/providers/MapRepositoryProvider.tsx` (decision 0011).
- **Autosave** (`application/editor-store/autosave.ts`):
  - It stamps `updatedAt` at write start.
  - It keeps a failed map pending until the next observe or flush, with no timer.
  - It classifies failures only as `StorageUnavailableError` or other.
  - `EditorSession` flushes on `pagehide` and unmount, and requires `put` to start synchronously inside `flush`.
- **Editor identity guard.** `StoredMap` in `src/app/maps/[id]/MapEditor.tsx` rejects a map whose embedded id differs from the route id (decision 0016).
- **Database roles.** The official `postgres:16` image creates `POSTGRES_USER` as a superuser. Local docker and CI both connect as that user (`app`), and a superuser bypasses RLS. RLS therefore needs a separate login role.
- **Boundary rules** (`.dependency-cruiser.cjs`):
  - Contexts import each other only through `<ctx>/acl/`.
  - `next`, `react`, `postgres` and `@supabase/*` are forbidden in `domain/` and `application/`.
  - `src/components` cannot import `infrastructure/`.
  - `src/app` is unrestricted.
- **Next.js 16** (bundled docs):
  - `middleware` is now `src/proxy.ts`, which always runs on the Node runtime.
  - `cookies()` is async and is writable only in Route Handlers and Server Functions.
  - Route Handlers are uncached by default and take `params` as a Promise.
  - The authentication guide requires the session to be verified next to the data, not only in the proxy (`02-guides/authentication.md` lines 1121 and 1507).
- **Gates:**
  - New `src/**` `.ts`/`.tsx` files need a paired test.
  - `route.ts` is not coverage-exempt (90% per file).
  - knip fails on unused files and exports.
  - The PR diff limit is 400 lines.
  - CI layer7 (e2e) has no database today.
  - Fourteen e2e specs seed IndexedDB through `e2e/support/seed.ts`.

## Goals / Non-Goals

**Goals:**

- A signed-in user's maps are stored server-side, isolated by Postgres RLS. They can be opened from a second browser context after signing in there.
- Accounts are self-hosted with no new runtime dependency. Local, CI and e2e runs all use plain `postgres:16`.
- The M1 editing behaviour is unchanged apart from where it saves; the `MapRepository` contract is unchanged.
- Browser-only storage is fully removed by the end of the change, with no parallel implementation left behind.

**Non-Goals** (owner decisions, decision 0023; each item names the trigger that reopens it):

- OAuth or email sign-in. Reopen before the M6 public launch.
- Login throttling or lockout. Reopen before the first public deployment.
- Users changing their own password, and recovering a forgotten admin password. Reopen at the first public deployment.
- Edit locks or revision checks for concurrent editing. Reopen when users report overwritten edits.
- Timed save retry or an offline queue. Reopen when users report edits lost on a weak network.
- Version history (`map_versions`, M6), quota (`ai_usage`, M4) and user-supplied providers (`user_providers`, M3.5).
- Anonymous trial, and importing existing IndexedDB maps.
- Production deployment and its hosting configuration. The owner deploys; this change documents the procedure only.
- Account deletion and disabling users. No trigger has been named.
- Metrics. They stay deferred until a deployment target exists (`constraints.yaml` downgrade text updated in task 9.2).

## Decisions

### D1. Database: roles, schema, migrations

**Roles.**

- An **owner role** owns every table and runs migrations through `MIGRATION_DATABASE_URL`. Locally and in CI this is `app`.
- The **app role** `mindsprout_app` is `LOGIN NOSUPERUSER NOBYPASSRLS` and owns nothing. It is the only role behind `DATABASE_URL`, so the app, `/api/healthz` and the e2e server all use it.
- Migration `0001` creates `mindsprout_app` as `NOLOGIN` if it is absent, then grants it table privileges.
- The dev/CI bootstrap `db/dev/app-role.sql` does `ALTER ROLE mindsprout_app LOGIN PASSWORD 'app'`. This is a fixed local credential, like `app/app` today.
  - It is applied by `pnpm db:setup`, which runs migrate and then the bootstrap. The script refuses when `NODE_ENV=production`.
  - CI applies it after migrating.
- Production sets the role password by hand; see `docs/engineering/database.md`.
- Alternative rejected: one connection that runs `SET LOCAL ROLE` per transaction. Forgetting the role switch silently runs as a superuser or owner. A separate role that has no power cannot be misused that way.

**Schema** (`db/migrations/0001_accounts_and_maps.sql`):

| Table      | Columns                                                                                                                                                                                                                                                                                  | Notes                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `users`    | `id uuid pk default gen_random_uuid()`, `username text not null unique`, `password_hash text not null`, `is_admin boolean not null default false`, `created_at timestamptz not null default now()`                                                                                       | Partial unique index `users_single_admin on users ((true)) where is_admin` — at most one admin |
| `sessions` | `token_hash text pk`, `user_id uuid not null references users on delete cascade`, `expires_at timestamptz not null`, `created_at timestamptz not null default now()`                                                                                                                     | Index on `user_id` (reset deletes by user)                                                     |
| `maps`     | `id text pk`, `owner_id uuid not null references users on delete cascade`, `schema_version integer not null`, `map jsonb not null`, `title text generated always as (map->>'title') stored`, `updated_at text generated always as (map->>'updatedAt') stored`, `check (map->>'id' = id)` | `ENABLE` + `FORCE ROW LEVEL SECURITY`; index `(owner_id, updated_at desc, id collate "C")`     |

- The whole `MindMap` is kept as one `jsonb` value. `title` and `updatedAt` are generated columns, so there is one source of truth and `get` returns exactly what `put` stored.
- `updatedAt` is always `toISOString()` output (fixed format), so sorting it as text sorts it by time. The `"C"` collation gives the contract's code-unit order for ties.
- **RLS policy.** `maps_owner` applies to all commands: `using (owner_id = nullif(current_setting('app.user_id', true), '')::uuid)`, with the same `with check`.
  - When the setting is missing the comparison yields null, so the query sees no rows.
- **Grants to `mindsprout_app`.**
  - `maps`: select, insert, update, delete. RLS governs.
  - `users`: select, insert, and update of `password_hash`.
  - `sessions`: select, insert, delete.
  - `users` and `sessions` have no RLS. They are the authentication tables, read before an identity exists, and only `account/infrastructure` queries them.

**Migrations.**

- `scripts/db-migrate.mjs` (`pnpm db:migrate`) applies `db/migrations/NNNN_*.sql` in name order. Each file runs in its own transaction under the owner role.
- Applied files are recorded in `schema_migrations(name text pk, applied_at timestamptz)`. A file already recorded is skipped; a file that fails rolls back and stops the run with a non-zero exit.
- There is no down-migration. Rollback means restoring a backup (`docs/engineering/database.md`).

### D2. Account model and use cases

- **Ports** in `account/domain/`: `UserRepository`, `SessionRepository`, `PasswordHasher`, `TokenSource`, `Clock`.
  - Entities: `User { id, username, isAdmin, createdAt }` and `Session { userId, expiresAt }`.
- **Use cases** in `account/application/`: `register`, `signIn`, `signOut`, `resolveSession`, `listUsers`, `resetPassword`.
  - Each use case takes its ports as arguments and contains no framework or SQL.
- **Input bounds** (owner: no policy, technical bounds only). The same bounds apply to registration, sign-in and admin input.
  - `username` is 1–64 UTF-16 code units, compared and stored exactly: no trimming, case folding or normalisation.
  - `password` is 1–256 code units. The upper bound keeps scrypt cost bounded.
  - Out-of-bounds input is rejected with `invalid-input`.
- **Password hashing.** `node:crypto` `scrypt` with N=2^15, r=8, p=1, a 16-byte random salt and a 32-byte key. The result is stored as `scrypt$<N>$<r>$<p>$<saltB64>$<keyB64>`, and verification uses `timingSafeEqual`.
  - Registration already reveals whether a username exists, so sign-in does not equalise timing for unknown users.
  - Every sign-in failure returns the same `invalid-credentials`.
- **First admin.** `register` runs in one transaction. It takes `pg_advisory_xact_lock(<constant>)` and inserts with `is_admin = not exists (select 1 from users)`. The partial unique index backs this up if the lock is ever bypassed.
- **Temporary passwords.** `resetPassword(adminId, userId)` checks that the caller is admin. In one transaction it writes a new hash for a 16-character base64url temporary password from `TokenSource` and deletes every session of that user.
  - It returns the temporary password once; it is never stored or logged.
  - An admin may reset their own password, which signs them out.

### D3. Sessions and cookies

- **Token.** 32 random bytes, base64url, set in cookie `mindsprout_session`.
  - Cookie attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, plus `Secure` when `NODE_ENV=production`.
  - The database stores `sha256(token)` hex as `token_hash`, so a database read does not yield usable cookies.
  - `expires_at` is creation time plus 30 days. Sessions are not sliding.
- **`resolveSession`.**
  - It looks up `token_hash` with `expires_at > now()` and joins the user.
  - Expired rows are left in place; purging them is in `## Not yet specified`.
- **Sign-out** deletes the row and clears the cookie (`Max-Age=0`). It is idempotent.
- **CSRF.** `SameSite=Lax` keeps the cookie off cross-site subrequests. In addition, every non-GET API route requires `Content-Type: application/json`, which a cross-site form cannot send without a preflight; other content types get 415.

### D4. Server map store and payload validation

- **Payload parser.** `parseMindMap(input): MindMap` in `map/domain/` is a pure function using strict Zod schemas over the D1 `MindMap` shape from M1. It enforces the forest invariants:
  - at least one root;
  - `roots[0]` has no `position`;
  - every other root has a finite `position`;
  - no non-root node has a `position`;
  - node ids are unique;
  - `color` is a `ColorToken`;
  - text and note are strings, and collapsed is a boolean;
  - `id`, `title`, `createdAt` and `updatedAt` are strings.

  Failure throws `TreeOpError('invalid-op')` and wraps the Zod issues. This is the existing domain error, so there is no new code. The parser lives in map, the owner of the shape; account reaches it through `account/acl/map.ts`.

- **Store.** `PostgresMapStore.forUser(userId): MapRepository` lives in `account/infrastructure/`. It implements the map port, whose types come through `account/acl/map.ts`.
  - Each call runs `sql.begin(tx => { set_config('app.user_id', userId, true); ... })`, so the GUC is transaction-local and cannot leak through a pooled connection.
  - `put` is an upsert: `insert … on conflict (id) do update … where maps.owner_id = <user>`. If the id belongs to another user, RLS hides the row and the update matches nothing, and `put` throws `MapOwnedElsewhereError`. Routes map that error to 404.
  - `delete` of an absent or foreign id succeeds and affects no row.
  - `get` returns `{ schemaVersion, map }`. Callers above the HTTP layer see `MindMap` or `UnsupportedSchemaVersionError`, as the port requires.
- **Body limit.** 1 MiB, checked against `Content-Length` and the bytes actually read; anything larger gets 413. A generated 500-node map is about 60 KB.

### D5. HTTP API contract

Every body is JSON, and every error body is `{ "error": "<code>" }`. Every map and admin route answers 401 `unauthenticated` without a valid session.

| Route                                           | Success                                                     | Errors                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register` `{username,password}` | 201 `{username,isAdmin}` + session cookie                   | 400 `invalid-input`, 409 `username-taken`, 415                                                                                         |
| `POST /api/auth/login` `{username,password}`    | 200 `{username,isAdmin}` + session cookie                   | 400 `invalid-input`, 401 `invalid-credentials`, 415                                                                                    |
| `POST /api/auth/logout`                         | 204, cookie cleared (also without a session)                | 415                                                                                                                                    |
| `GET /api/auth/session`                         | 200 `{username,isAdmin}`                                    | 401                                                                                                                                    |
| `GET /api/maps`                                 | 200 `MapSummary[]` (contract order)                         | 401                                                                                                                                    |
| `GET /api/maps/{id}`                            | 200 `{schemaVersion,map}`                                   | 401, 404 `not-found` (absent or another user's)                                                                                        |
| `PUT /api/maps/{id}` `{schemaVersion,map}`      | 204                                                         | 400 `invalid-map` (parse failure, `schemaVersion !== 1`, `map.id !== {id}`), 401, 404 (id owned by another user), 413 `too-large`, 415 |
| `DELETE /api/maps/{id}`                         | 204 (absent or foreign id: 204, nothing deleted)            | 401, 415                                                                                                                               |
| `GET /api/admin/users`                          | 200 `[{id,username,isAdmin,createdAt}]` by `created_at` asc | 401, 403 `forbidden`                                                                                                                   |
| `POST /api/admin/users/{id}/password-reset`     | 200 `{temporaryPassword}`                                   | 401, 403, 404 `not-found`, 415                                                                                                         |

- Unexpected failures return 500 `internal` and are logged through `src/shared/logger.ts`. The log never includes the request body, the password or the cookie.
- Every route is registered in `schemas/openapi.yaml` and covered by `smoke/api.hurl`.

### D6. Server composition and route handlers

- **Composition module.** `src/app/server/account-services.ts` is imported only by route handlers.
  - It holds one lazily created `postgres` client per process (pool `max: 5`) built from `loadEnv().DATABASE_URL`, and wires the use cases with the Postgres adapters, the scrypt hasher, the crypto token source and the system clock.
  - A missing `DATABASE_URL` throws on first use (fail loud). `/api/healthz` keeps its own not-configured probe.
- **Route handlers** (`src/app/api/**/route.ts`) parse the request, read the cookie, call one composed use case and map the result to D5. They contain no SQL and no business rules.
  - Unit tests call the exported handlers with `Request` objects and mock the composition module (the `healthz` pattern).
  - Real database behaviour is proven in `tests/integration/`.
- **Shared session reader.** `requireUser(request)` lives in the composition layer and is shared by the map and admin handlers. It returns the user or a 401 `Response`.

### D7. Browser adapter and error surfacing

- **`HttpMapRepository`** in `map/infrastructure/persistence/` implements the port over same-origin `fetch`.
  - `list` → `GET /api/maps`.
  - `get` → `GET /api/maps/{id}`. A 404 returns `undefined`. `schemaVersion > 1` throws `UnsupportedSchemaVersionError(found, 1)`. A malformed envelope throws a plain `Error` naming the id.
  - `put` → `PUT` with `keepalive: true` when the serialised body is at most 60,000 bytes (browser keepalive quota is 64 KiB), otherwise a normal fetch. `put` begins its request synchronously, so the `EditorSession` flush ordering still holds.
  - `delete` → `DELETE`.
  - A 401 on any call throws the new `StorageUnauthorizedError` (`map/domain/errors.ts`). Any other non-2xx, or a network failure, throws a plain `Error`. Network errors are not "unavailable" (decision 0011).
- **Autosave** gains a third outcome. `StorageUnauthorizedError` sets the notice `SESSION_EXPIRED = '登录已过期，请在新标签页重新登录后继续编辑'` and leaves the map pending, exactly as a failed write does today.
  - The session cookie is shared across tabs, so the next edit or flush after re-signing in saves it.
  - `EditorView` shows a `重新登录` link (`/login?next=<current path>`, `target="_blank"`) while that notice is displayed.
- **Load-time 401.** When the library list or the editor `get` rejects with `StorageUnauthorizedError`, the page calls `window.location.assign('/login?next=<current path>')`. Nothing has been edited yet, so nothing is lost.
- **Provider.** `MapRepositoryProvider` constructs one `HttpMapRepository` per document session. It no longer has a fallback or `storageUnavailable`.

### D8. Sign-in routing and pages

- **`src/proxy.ts`** (Node runtime).
  - Matcher: everything except `/_next/static`, `/_next/image`, `/icon.svg`, `/api/` (handlers answer 401 themselves), `/login` and `/register`.
  - With no `mindsprout_session` cookie, it redirects 307 to `/login?next=<pathname+search>`.
  - It only checks that the cookie exists. Validity is checked at the data (D6).
- **`next` sanitising** is one shared pure helper. A value is used only if it starts with `/` and not with `//` or `/\`; anything else becomes `/`. This prevents an open redirect.
- **`/login` and `/register`** are client forms posting JSON to D5. On success they navigate to the sanitised `next`.
  - Error texts: `用户名或密码错误` (401), `用户名已被占用` (409), `请输入用户名和密码` (400).
- **Header session menu** (`src/components/account/`) on `/`, `/maps/[id]` and `/admin`. It fetches `GET /api/auth/session` once per page and shows the username, a `管理后台` link for the admin and `退出登录`, which posts to logout and then navigates to `/login`.

### D9. Admin page

- `/admin` fetches `GET /api/admin/users`. On 403 it shows `无权访问` with a link to `/`.
- Each row shows username, created time and an `管理员` badge, plus a `重置密码` button.
- The button asks for confirmation: `重置后该用户的所有登录将失效`. The result is shown once, in a dialog that lets the admin copy the temporary password and states that it will not be shown again.
- Closing the dialog discards the password from component state.

### D10. Cut-over order (written exception to "no parallel implementations")

`AGENTS.md` forbids parallel implementations without a written cutover exception. This is that exception. The 400-line PR limit makes an atomic swap impossible, so:

1. **Server side first.** Database, account and API (task groups 1–5) land while the browser still uses IndexedDB. Nothing in the UI calls them yet. They are reachable only by tests and smoke, and each is referenced by its route, so knip stays green.
2. **e2e infrastructure** (tasks 6.3 and 6.4) adds the Postgres service, the e2e database lifecycle and a signed-in fixture. Seeding keeps its IndexedDB internals, and specs switch to the fixture without changing assertions.
3. **The flip** (task 6.5, after the sign-in pages and proxy in 7.1 and 7.2) swaps the provider to `HttpMapRepository`.
   - In the same PR it deletes the IndexedDB adapter and its tests (knip would otherwise fail).
   - It switches the seed helper to API `PUT`, so spec bodies stay unchanged.
   - It moves the raw-record e2e cases (corrupt record, mismatched identity, future version) to their new seams (D11).
   - It deletes `e2e/storage-fallback.spec.ts`.
4. **The contract step** (task 6.6) removes what the flip left referenced but dead: `StorageUnavailableError`, the banner, the `storageUnavailable` flags and `onUnavailable`, `InMemoryMapRepository` (moved to `tests/support/` as the contract suite's in-memory double), and the `idb` and `fake-indexeddb` dependencies.

The only transitional state is between steps 3 and 4: a never-thrown error branch and a banner that never renders. Both are inside this change, and the step 4 issue depends on step 3.

### D11. Test database lifecycle

A reset never targets the developer's `app_dev`.

- **Integration** (`pnpm test:integration`).
  - The target database is `app_test`.
  - A Vitest `globalSetup` connects as the owner role to the maintenance database `postgres` and creates `app_test` if it is absent. It then drops and recreates the `public` schema, runs the migrations and applies the dev role bootstrap.
  - Each test creates fresh users through `UserRepository`, so the map contract suite runs against `PostgresMapStore.forUser(<new user>)` and always starts empty.
  - Role-flag, fail-closed and first-admin race tests live here.
  - The defaults are the local URLs from `.env.example`. CI sets `DATABASE_URL` and `MIGRATION_DATABASE_URL` for `app_test`.
- **e2e** (`pnpm e2e`).
  - Playwright starts its own `next dev --port 3100` with `DATABASE_URL` pointed at the `app_e2e` database. `reuseExistingServer` is false, so a developer's `:3000` dev database is never touched.
  - Its `globalSetup` creates and resets `app_e2e` the same way, then registers `e2e-admin` (password from a test constant) first, so that account is the admin.
  - Every other test registers a unique user (`u-<random>`) through the fixture.
  - Screenshot evidence still lands in `.run/ui-evidence/`.
- **Smoke** (`pnpm smoke`) runs against the `:3000` server and whatever database it has.
  - It registers two random users, so it never needs to know who the admin is. The 403 assertion uses the second user, who is never the first registrant.
  - On a brand-new dev database, the first smoke user becomes the admin. `docs/engineering/database.md` therefore tells developers to register their own account before running smoke.

### D12. Copy and documentation

- **README `## Known Limitations`** (spec map-library) lists:
  - no AI;
  - last-write-wins across devices;
  - the 500 ms debounce and its loss window;
  - LR-only layout;
  - no export;
  - no password change or recovery, admin reset only, and a lost admin password is unrecoverable;
  - no login throttling.
- **`docs/engineering/database.md`** covers:
  - the roles and URLs;
  - `pnpm db:migrate` and `pnpm db:setup`;
  - backup before migrating;
  - the deployment procedure: create `mindsprout_app` with a strong password, migrate, start, and register the owner immediately so they become the admin.
- TECH §7 is updated to the implemented layout when the change closes.

## Sketch seams under test

- `parseMindMap`, a pure function in `map/domain`. It is the single place that decides what a storable map is, so every server-side validation scenario is a unit test.
- Account use cases (`account/application`) over in-memory port doubles. Registration, sign-in, expiry, admin checks and the reset semantics are proven without a database.
- The `MapRepository` contract suite, run unchanged against two adapters:
  - `HttpMapRepository`, backed by a fetch double that serves the D5 contract from an in-memory store;
  - `PostgresMapStore.forUser` against real Postgres.

  This is the one seam that proves the cloud path keeps M1's storage semantics.

- Postgres integration tests through the app role:
  - the role flags are false;
  - a query without `app.user_id` returns no rows;
  - user B cannot read, overwrite or delete user A's map;
  - two concurrent first registrations produce exactly one admin;
  - a reset deletes the user's sessions.

  This is the only place RLS and the advisory lock are real.

- Route handlers called with `Request` objects and the composition module mocked. They map status codes, cookies and 415/413/400 handling to D5.
- `smoke/api.hurl` against the running server. It is the end-to-end HTTP contract, including cookies.
- The Playwright two-context M2 acceptance walk: in context A, register, create a map and add nodes; in context B, sign in and see the same map. It is the single proof of the PRD M2 acceptance.

## Risks / Trade-offs

- **[A query runs outside `forUser` and sees nothing, or a future migration grants too much]** → Isolation does not depend on getting each query right. The app role has no `BYPASSRLS`, the policy fails closed, and the integration tests assert both.
- **[First-registrant-is-admin on a public deployment]** → The documented deployment procedure has the owner register first. The owner accepted the residual risk. Reassess at the first public deployment.
- **[A lost admin password is unrecoverable]** → Owner-accepted known limitation, disclosed in the README.
- **[A `keepalive` body over 64 KiB is rejected by the browser]** → Such bodies are sent without `keepalive`, so a pagehide flush of a very large map is best-effort, as the M1 spec already states.
- **[Last-write-wins silently overwrites a second device's edits]** → Owner-accepted and disclosed in the README.
- **[Two parallel adapters exist during the cut-over]** → D10 bounds the parallel state and orders the issues so the removal depends on the flip.
- **[e2e suites spend time on registration]** → One registration per test, and scrypt N=2^15 takes about 50 ms. If it measurably slows CI, reuse a storage state per worker; that is an implementation detail inside the fixture.
- **[AGENTS.md is at 32,596 / 32,768 bytes]** → The task that adds the `db:*` rows and critical paths also trims existing prose to fit, verified by `pnpm test:guardrails` and the instruction-guard hook.

## Migration Plan

- **Development:** `docker compose up -d`, then `pnpm db:setup`. An existing dev volume needs no reset: migration 0001 creates the role and `db:setup` sets its login.
- **Existing browser-local maps are abandoned** (owner decision). There is no import path; the pre-release data is the owner's test maps only.
- **Deployment** (owner, outside this change): follow `docs/engineering/database.md`.
- **Rollback:** revert the PRs. The schema is additive. Dropping the three tables and the role restores the pre-M2 database. Browser IndexedDB data from M1 is left untouched in users' browsers, since nothing deletes it.

## Open Questions

None. Every question raised in Stage 1 was decided by the owner (decision 0023).

## Not yet specified

- **Expired-session housekeeping.** Whether and when expired `sessions` rows are purged (on sign-in, scheduled, or never at v1 scale). No requirement can be stated until there is a deployment and a row count to look at.
- **Connection pooling for the eventual hosting target.** Serverless function concurrency versus `max: 5`, and whether a pooler is needed, depends on a hosting choice that has not been made.
