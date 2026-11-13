# Tasks

## Conventions

**Module boundaries.** Follow `AGENTS.md ## Directory Map`.

**Tests and docs.**

- Every task lands its own tests: TDD is required, coverage is ≥ 90% per file, and every new `src/**` file ships with its paired test.
- Every task also lands the docs its own work calls for.
- A task that edits a Critical Path (`src/contexts/account/`, `src/app/api/`, `.github/workflows/`, `constraints.yaml`, `AGENTS.md`) flags that edit in its PR and attaches `pnpm test:guardrails` evidence.

**Verification tiers.**

| Tier        | What it is                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit        | Vitest in node (domain, application, route handlers with the composition module mocked) or the jsdom component tier. This is what the coverage gate measures. |
| integration | `pnpm test:integration` against real Postgres, using the `app_test` lifecycle from design D11.                                                                |
| contract    | `pnpm test:contract`.                                                                                                                                         |
| smoke       | `pnpm smoke` (hurl) against a running server.                                                                                                                 |
| e2e         | Playwright against its own server and the `app_e2e` database (design D11).                                                                                    |

**Scenario naming.** A task's verify clause names the spec scenarios it proves.

**Ordering.** The cut-over order is design D10: groups 1–5 are server-only; 6.3–6.4 prepare e2e; 7.1–7.2 add the sign-in pages and the proxy; 6.5 flips the browser to the cloud store; 6.6 removes the leftovers.

## 1. Database foundation

- [ ] 1.1 Add the migration runner and the integration database lifecycle (design D1, D11).
  - Add `scripts/db-migrate.mjs` and the `pnpm db:migrate` script:
    - it applies `db/migrations/NNNN_*.sql` in name order under `MIGRATION_DATABASE_URL`, one transaction per file;
    - it records applied files in `schema_migrations`, skips files already recorded, and on failure rolls back and stops with a non-zero exit.
  - Add a Vitest `globalSetup` to `vitest.integration.config.ts`. As the owner role it connects to the `postgres` maintenance database, creates `app_test` if it is absent, drops and recreates its `public` schema, then migrates.
  - Move the default URL in `tests/integration/database.test.ts` to `app_test` (never `app_dev`).
  - Add `MIGRATION_DATABASE_URL` to `.env.example` and to the CI layer3 env (owner `app` on `app_test`).
  - Add a `pnpm db:migrate` row to the `AGENTS.md` daily-commands table, trimming existing prose so the file stays within the instruction-guard limits.
  - Verify (integration): runner tests over fixture migration directories, each in a scratch database, cover cloud-map-storage "Fresh database", "Re-run is a no-op" and "Failing migration" (no partial statement remains, not recorded, later files not applied, non-zero exit).
  - Verify (gate): `pnpm test:guardrails` passes, and the PR flags the `ci.yml` and `AGENTS.md` edits.
- [ ] 1.2 Add migration `0001_accounts_and_maps.sql`, exactly per design D1.
  - Schema:
    - create the `mindsprout_app` role `NOLOGIN` if it is absent;
    - create `users`, `sessions` and `maps` with the `users_single_admin` partial unique index, the generated `title` and `updated_at` columns, and the `map->>'id' = id` check;
    - put `maps` under `ENABLE` + `FORCE` RLS with the fail-closed `maps_owner` policy;
    - grant `mindsprout_app` only the D1 privileges.
  - Add the dev/CI bootstrap `db/dev/app-role.sql` and `pnpm db:setup` (migrate, then bootstrap; refuses when `NODE_ENV=production`), and have the integration `globalSetup` apply the bootstrap.
  - Point `.env.example` `DATABASE_URL` at `mindsprout_app` and remove the three Supabase variables. Do the same for CI layer3 `DATABASE_URL`, and run `pnpm db:setup` before the smoke step.
  - `AGENTS.md`:
    - extend the daily-commands row with `pnpm db:setup`;
    - add the Verification Matrix "DB migration" row promised there;
    - add `db/migrations/` to the account Critical Paths row.
  - Verify (integration):
    - cloud-map-storage "Application role cannot bypass isolation" (`rolsuper` and `rolbypassrls` false; no table owned);
    - "Query without a user identity" (select returns no rows; insert refused);
    - the app role cannot update `users.is_admin` and cannot drop or alter any table;
    - `/api/healthz` still answers 200 through the app role (`pnpm smoke` in CI).
  - Verify (gate): `pnpm test:guardrails` passes.

Suggested fixture level: expanded - persisted schema, the RLS security boundary and CI workflow edits (Critical Path: gate integrity); a wrong grant silently voids user isolation.
Minimal mergeable slice: 1.1 - the runner and test-database lifecycle are self-verifying against fixture migrations with no product schema; 1.2 adds the schema on top.

## 2. Map payload validation

- [ ] 2.1 Add `parseMindMap(input): MindMap` to `src/contexts/map/domain` (design D4). It uses strict Zod schemas over the M1 `MindMap` shape and enforces the forest invariants:
  - at least one root;
  - no `position` on `roots[0]`;
  - a finite `position` on every other root, and none on any non-root node;
  - unique node ids, and `ColorToken` colours;
  - string `id`, `title`, `createdAt` and `updatedAt`.

  It throws `TreeOpError('invalid-op')` with the Zod issues.
  - Verify (unit): cloud-map-storage "Floating root without a position" and "Duplicate node ids" at the parser level. Also cover a primary root with a position, a non-finite position, a position on a child, an unknown colour and an extra key. A generated 500-node map is accepted deep-equal. `pnpm boundaries` passes.

Suggested fixture level: compact - one pure domain function, no persistence or entrypoint.
Minimal mergeable slice: atomic - a single function and its unit tests; there is no smaller independently useful part.

## 3. Account domain and use cases

- [ ] 3.1 In `src/contexts/account/domain`, define `User`, `Session`, the `AccountError` codes (`invalid-input`, `username-taken`, `invalid-credentials`, `forbidden`, `not-found`) and the ports `UserRepository`, `SessionRepository`, `PasswordHasher`, `TokenSource` and `Clock` (design D2, D3).
  - In `account/application`, implement `register`, `signIn`, `signOut` and `resolveSession`:
    - the input bounds are username 1–64 and password 1–256 code units, compared exactly;
    - a session expires 30 days after creation by the `Clock`;
    - `signOut` is idempotent.
  - Verify (unit, with in-memory port doubles under `tests/support/`):
    - account-auth "Out-of-bounds input";
    - a wrong password and an unknown user yield the identical `invalid-credentials` and create no session;
    - registering a taken username yields `username-taken`;
    - `resolveSession` rejects a session whose expiry has passed by the clock;
    - `signOut` without a session succeeds.
  - `pnpm boundaries` shows no framework or SQL in `domain/` or `application/`.
- [ ] 3.2 Implement `listUsers(actor)` and `resetPassword(actor, userId)` (design D2).
  - Both refuse a non-admin with `forbidden`.
  - `resetPassword` refuses an unknown id with `not-found`, draws a 16-character temporary password from `TokenSource`, and calls the port's single atomic `replacePasswordAndEndSessions`.
  - It returns the temporary password and never logs it.
  - Verify (unit): forbidden for a non-admin; not-found; the returned password hashes to the stored value; the port receives exactly one atomic call; the admin may reset their own password.

Suggested fixture level: compact - pure application logic over ports; security-relevant behaviour is fully observable through port doubles.
Minimal mergeable slice: 3.1 - the self-service account use cases are complete and green alone; the admin use cases are additive.

## 4. Account infrastructure

- [ ] 4.1 Implement the scrypt `PasswordHasher` (N=2^15, r=8, p=1, 16-byte salt, 32-byte key, `scrypt$N$r$p$salt$key` format, `timingSafeEqual`) and the `node:crypto` `TokenSource` in `src/contexts/account/infrastructure` (design D2, D3).
  - Verify (unit): account-auth "Password is never stored in plaintext" (salted, does not contain the password, `pw` verifies and `px` fails). Two hashes of the same password differ. A malformed stored hash verifies false and does not throw. Tokens are 32 random bytes in base64url.
- [ ] 4.2 Implement `PostgresUserRepository` and `PostgresSessionRepository` (design D1–D3).
  - `register` runs in one transaction with `pg_advisory_xact_lock` and `is_admin = not exists (…)`.
  - Sessions store `sha256(token)`, and lookup filters on `expires_at > now()`.
  - `replacePasswordAndEndSessions` runs in one transaction.
  - Verify (integration):
    - account-auth "First registrant is admin", "Racing first registrations" (two concurrent registrations on an empty `users` table produce exactly one admin), "Usernames are exact" and "Session expires after 30 days" (a row with a past `expires_at` resolves to no user);
    - a reset deletes every session of that user and leaves other users' sessions intact.
- [ ] 4.3 Add `src/contexts/account/acl/map.ts`, re-exporting the map port types and errors account needs, and implement `PostgresMapStore.forUser(userId): MapRepository` (design D4).
  - Every call runs in its own transaction that sets `app.user_id` with `set_config(…, true)`.
  - `put` is an owner-scoped upsert that throws `MapOwnedElsewhereError` when the id belongs to another user.
  - `get` returns the stored envelope's map, or throws `UnsupportedSchemaVersionError` for `schema_version > 1`.
  - `delete` of an absent or foreign id is a no-op.
  - Verify (integration):
    - cloud-map-storage "Contract over HTTP and over the database", database half: the shared contract suite passes unchanged against `forUser(<fresh user>)`;
    - "Another user's map is invisible", at the store level;
    - "Valid 500-node map", database round trip deep-equal;
    - a seeded `schema_version = 2` row makes `get` throw `UnsupportedSchemaVersionError`.

Suggested fixture level: expanded - Critical Path (`src/contexts/account/`: credentials, RLS persistence); real-database integration evidence is required.
Minimal mergeable slice: 4.1 - the hasher and token source are pure adapters with unit tests; 4.2 and 4.3 are independent PRs on top of 1.2.

## 5. API routes

- [ ] 5.1 Add the server-only composition `src/app/server/account-services.ts` (design D6).
  - It holds one lazy `postgres` client per process (`max: 5`) from `loadEnv().DATABASE_URL`, wires the use cases, and fails loud when `DATABASE_URL` is missing.
  - It provides `requireUser(request)` and the cookie helpers (design D3).
  - Add the auth routes `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` and `GET /api/auth/session`, returning exactly the design D5 statuses and bodies, with JSON-only enforcement (415).
  - Register the routes in `schemas/openapi.yaml`, review and update the snapshot hunk by hunk, and add the auth section of `smoke/api.hurl` (cookie-jar flow).
  - Add `/api/auth/*` to `constraints.yaml` `key_api_routes`.
  - Verify (unit, composition module mocked):
    - account-auth "Session cookie attributes";
    - register 201 with the cookie, 409 and 400;
    - login 401 `invalid-credentials`;
    - logout 204 without a session, and 415 for a form body;
    - session 200/401;
    - no password, cookie or request body appears in log calls.
  - Verify (contract): `pnpm test:contract` passes. Verify (smoke): `pnpm smoke` passes. Verify (gate): `pnpm test:guardrails` passes.
- [ ] 5.2 Add `GET /api/maps`, and `GET`/`PUT`/`DELETE /api/maps/{id}` (design D4, D5).
  - `PUT` validates with `parseMindMap`, enforces `schemaVersion === 1` and `map.id === {id}`, and limits the body to 1 MiB.
  - Register the routes in `schemas/openapi.yaml` and its snapshot, add them to `smoke/api.hurl`, and mark `/api/maps` covered in `constraints.yaml`.
  - Verify (unit):
    - cloud-map-storage "Embedded id differs from the path" (400, nothing written) and "Oversized body" (413);
    - account-auth "API without a session" (401 on every map route, including a forged cookie) and "Cross-site form post" (415 on `PUT`);
    - 404 for an absent id and for `MapOwnedElsewhereError`.
  - Verify (smoke): cloud-map-storage "Round trip through the API".
  - Verify (contract): `pnpm test:contract` passes.
- [ ] 5.3 Add `GET /api/admin/users` and `POST /api/admin/users/{id}/password-reset` (design D5).
  - Register them in `schemas/openapi.yaml` and the snapshot, and add them to `smoke/api.hurl`. Smoke registers two fresh users and asserts 403 for the second (design D11).
  - Add `/api/admin/*` to `constraints.yaml`.
  - Verify (unit): account-admin "Reset of an unknown account" (404, nothing changes); 401 without a session; 403 for a non-admin; 200 `{temporaryPassword}` for the admin; ordering by `created_at` ascending.
  - Verify (contract and smoke): cloud-map-storage "Published contract matches", with every auth, map and admin route present.

Suggested fixture level: expanded - Critical Path (`src/app/api/`: public API contract) plus `schemas/openapi.yaml`, `smoke/` and `constraints.yaml` updates.
Minimal mergeable slice: 5.1 - composition, session reading and the auth routes merge and smoke-test alone; 5.2 and 5.3 are independent PRs on top of it.

## 6. Browser storage cut-over

- [ ] 6.1 Add `StorageUnauthorizedError` to `src/contexts/map/domain/errors.ts`. Implement `HttpMapRepository` in `src/contexts/map/infrastructure/persistence` (design D7):
  - `get` maps 404 to `undefined`, and a `schemaVersion > 1` envelope to `UnsupportedSchemaVersionError`;
  - `put` uses keepalive only for bodies of at most 60,000 bytes and starts its request synchronously;
  - a 401 throws `StorageUnauthorizedError`; any other failure, including network errors, throws a plain `Error`.

  Add a fetch double under `tests/support/` that serves the D5 map contract from memory.
  - Verify (unit):
    - cloud-map-storage "Contract over HTTP and over the database", HTTP half: the contract suite passes unchanged against `HttpMapRepository` with the fetch double;
    - map-persistence "Flush outlives the page";
    - a malformed envelope rejects with an `Error` naming the id;
    - `put` has issued its request before its returned promise settles.

- [ ] 6.2 Handle the new storage outcomes in the editor and library (design D7).
  - Autosave classifies `StorageUnauthorizedError` and sets `SESSION_EXPIRED`; the map stays pending.
  - `EditorView` shows the `重新登录` link (`/login?next=<path>`, new tab) while that notice is displayed.
  - The library list and the editor `get` redirect to `/login?next=<path>` on a load-time `StorageUnauthorizedError`.
  - Verify (unit/component, fetch double):
    - account-auth "Edit after the session ended" and "Pending edits saved after signing in again" (401 then 204: the second save contains both edits);
    - "Expired session on page load";
    - map-persistence "Write failure is visible" (500 and network error show "保存失败", the next edit saves both).
- [ ] 6.3 Prepare e2e for the database (design D11).
  - Add a Postgres service to CI layer7, plus `MIGRATION_DATABASE_URL` and `DATABASE_URL` for `app_e2e`.
  - `playwright.config.ts` starts its own `next dev --port 3100` against `app_e2e` with `reuseExistingServer: false`.
  - Its `globalSetup` creates and resets `app_e2e`, migrates, applies the bootstrap, and registers `e2e-admin` first.
  - `e2e/support/session.ts` exports a `test` fixture whose `page` is signed in as a freshly registered user, and an `adminPage` signed in as `e2e-admin`.
  - Seeding keeps its IndexedDB internals.
  - Verify (e2e): the full existing suite passes unchanged, and a new fixture test proves the fixture page carries a valid session (`GET /api/auth/session` returns 200 with its username). Verify (gate): `pnpm test:guardrails` passes and the PR flags the workflow edit.
- [ ] 6.4 Switch every e2e spec to the signed-in `test` fixture from `e2e/support/session.ts`. This is a mechanical import change with no assertion edits.
  - Verify (e2e): the full suite passes with zero skips and zero console errors.
- [ ] 6.5 Flip the browser to the cloud store (design D10 step 3).
  - `MapRepositoryProvider` constructs one `HttpMapRepository` per document session.
  - In the same PR, delete `indexed-db-map-repository.ts` and its test, and rewrite the provider tests for the HTTP adapter.
  - Switch `e2e/support/seed.ts` internals to API `PUT` with an unchanged call signature.
  - Delete `e2e/storage-fallback.spec.ts`.
  - Move the raw-record e2e cases to component tests over a repository double: map-library "Corrupt record", "Mismatched stored map identity" and "Matching identity preserves normal persistence", and map-persistence "Future version".
  - Remove the "browser-only storage" README limitation.
  - Verify (unit/component): the moved scenarios. Verify (e2e): the full suite passes against the cloud store with unchanged assertions, including map-persistence "Reload after edits" and "Edits older than the save window survive reload", and map-library "Stale link". `pnpm dead-code` passes.
- [ ] 6.6 Remove the browser-storage leftovers (design D10 step 4).
  - Delete `StorageUnavailableError`, the storage-unavailable banner, every `storageUnavailable` flag and the autosave `onUnavailable` path.
  - Move `InMemoryMapRepository` into `tests/support/` as the contract suite's in-memory double, keeping the contract suite running against it.
  - Remove the `idb` and `fake-indexeddb` dependencies, with the lockfile change.
  - Verify: `pnpm test:unit`, `pnpm dead-code`, `pnpm licenses:check` and `pnpm e2e` pass. `grep -r "StorageUnavailable\|未保存到浏览器\|indexedDB" src e2e` finds nothing. The lockfile guard passes.

Suggested fixture level: expanded - cross-module cut-over of the persisted-state boundary with e2e infrastructure and a CI workflow edit; a slip loses user edits.
Minimal mergeable slice: 6.1 - the HTTP adapter is fully contract-tested and unused by the UI until the flip; 6.2, the 6.3/6.4 e2e preparation, the 6.5 flip and the 6.6 removal follow in that dependency order (6.5 also depends on 7.1 and 7.2).

## 7. Sign-in pages and routing

- [ ] 7.1 Add `/login` and `/register` pages with client forms in `src/components/account/` (design D8).
  - The forms post JSON to the auth routes and show `用户名或密码错误`, `用户名已被占用` and `请输入用户名和密码`.
  - On success they navigate to `next`, sanitised by a shared pure `safeNextPath` helper in `src/shared/`.
  - Add `/login` to `constraints.yaml` `key_ui_paths` and to the `e2e/smoke.spec.ts` walk.
  - Verify (unit/component): account-auth "Taken username" and "Wrong password or unknown user" (the texts), and "Foreign redirect target is ignored" (`safeNextPath`). Verify (e2e): "Register and land signed in" and "Sign in".
- [ ] 7.2 Add `src/proxy.ts` (design D8).
  - The matcher excludes `/_next/static`, `/_next/image`, `/icon.svg`, `/api/`, `/login` and `/register`.
  - When the session cookie is missing it redirects 307 to `/login?next=<path+query>`. It checks only that the cookie exists.
  - Add `src/proxy.ts` to the `AGENTS.md` Critical Paths table.
  - Verify (unit): account-auth "Public surfaces need no session" (proxy and matcher). Verify (e2e): "Signed-out visit returns after sign-in". Verify (gate): `pnpm test:guardrails` passes.
- [ ] 7.3 Add the header session menu in `src/components/account/` to `/`, `/maps/[id]` and `/admin` (design D8).
  - It shows the username, a `管理后台` link for the admin only, and `退出登录`.
  - Verify (unit/component): account-admin "Admin link visibility". Verify (e2e): account-auth "Sign out".

Suggested fixture level: expanded - `src/proxy.ts` gates every page and becomes a Critical Path; the redirect target is an open-redirect surface.
Minimal mergeable slice: 7.1 - the public sign-in and registration pages work alone; the proxy (7.2) needs them to exist, and the header (7.3) is independent of the proxy.

## 8. Admin page

- [ ] 8.1 Add `/admin`, listing users via `GET /api/admin/users` (username, creation time, 管理员 badge, oldest first), with "无权访问" on 403 (design D9).
  - Add `/admin` to `constraints.yaml` `key_ui_paths` and to the `e2e/smoke.spec.ts` walk.
  - Verify (unit/component): account-admin "Regular user is refused" (page). Verify (e2e): "Admin sees all accounts" (`e2e-admin` plus two registered users, in order).
- [ ] 8.2 Add the per-row `重置密码` action: a confirmation ("重置后该用户的所有登录将失效"), a call to the reset API, and a one-time dialog with the temporary password that is discarded on close (design D9).
  - Verify (unit/component): account-admin "Cancel the reset" and "Temporary password is shown once". Verify (e2e): "Reset signs the user out and issues a temporary password" (two contexts as the user, one as the admin).

Suggested fixture level: compact - UI over an already-tested admin API; no persistence or entrypoint of its own.
Minimal mergeable slice: 8.1 - the read-only list merges alone; the reset action is additive.

## 9. M2 acceptance and documentation closure

- [ ] 9.1 Add the M2 acceptance walk `e2e/m2-acceptance.spec.ts` with two browser contexts.
  - Verify (e2e):
    - cloud-map-storage "Open on a second device";
    - map-library "Only the user's own maps" and "Another user's map";
    - account-admin "Admin opens another user's map" (`e2e-admin` gets the not-found state for a user's map URL);
    - screenshots in `.run/ui-evidence/` and zero console errors.
- [ ] 9.2 Close the documentation.
  - Rewrite README `## Known Limitations` to the seven items of map-library "Published canvas limitations".
  - Add `docs/engineering/database.md` covering roles and URLs, `db:migrate` and `db:setup`, backup before migrating, the deployment procedure (create the `mindsprout_app` login with a strong password, migrate, start, and register the owner first) and the smoke-on-fresh-dev-database caveat (design D11, D12).
  - Update TECH §7 to the implemented layout, including the account context, `db/` and the new routes.
  - Update the `constraints.yaml` metrics downgrade text from "deferred to M2" to "deferred until a deployment target exists".
  - Verify (gate): map-library "M1 documentation closure", "M2 documentation closure" and "Missing limitations are rejected"; `pnpm docs:check` and `pnpm test:guardrails` pass.

Suggested fixture level: compact - an acceptance test and documentation over finished behaviour.
Minimal mergeable slice: 9.1 - the acceptance walk merges alone; the documentation closure is an independent PR.
