# Tasks

## Conventions

**Module boundaries.** Follow `AGENTS.md ## Directory Map`.

**Tests and docs.**

- Every task lands its own tests: TDD is required, coverage is ≥ 90% per file, and every new `src/**` file ships with its paired test.
- Every task also lands the docs its own work calls for.
- A task that edits a Critical Path (`src/contexts/account/`, `src/app/api/`, `src/app/server/` from task 5.1 on, `.github/workflows/`, `constraints.yaml`, `AGENTS.md`) flags that edit in its PR and attaches `pnpm test:guardrails` evidence.

**Verification tiers.**

| Tier        | What it is                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit        | Vitest in node (domain, application, route handlers with the composition module mocked) or the jsdom component tier. This is what the coverage gate measures. |
| integration | `pnpm test:integration` against real Postgres, using the `app_test` lifecycle from design D11.                                                                |
| contract    | `pnpm test:contract`.                                                                                                                                         |
| smoke       | `pnpm smoke` (hurl) against a running server.                                                                                                                 |
| e2e         | Playwright against its own server and the `app_e2e` database (design D11).                                                                                    |

**Scenario naming.** A task's verify clause names the spec scenarios it proves.

**Ordering.** The cut-over order is design D10. Every task has a place in it:

1. Groups 1–5 are server-only. Group 5 starts after 4.2 (5.1–5.3 and 5.6) and 4.3 (5.4 and 5.5).
2. 6.1–6.2 add the HTTP adapter and its error outcomes before the flip; the UI does not use them until 6.8.
3. 6.3 moves e2e onto its own database and a signed-in fixture (after 5.2). 6.4 adds the declared expected-response helper (design D13) after 6.3, and 6.5 switches every spec except the signed-out ones to the fixture after 6.3.
4. 6.6 gives the native HMR probe a database and a signed-in user (after 5.2). It merges before 7.2 and before the flip.
5. 6.7 adds the component tests that replace the raw-record e2e cases. It is independent and merges before the flip.
6. 7.1 adds the sign-in pages (after 5.2 and 6.3). 7.2 adds the proxy after 6.5, 6.6 and 7.1. 7.3 adds the header after 5.3, 6.5, 6.6 and 7.1, because its session fetch on a signed-out page logs a 401 console error that the e2e and native HMR console assertions reject.
7. 6.8 flips the browser to the cloud store after 6.1–6.7, 7.1 and 7.2. 6.9 removes the leftovers after 6.8.
8. Group 8 follows the admin routes (5.6) and the header (7.3); 8.2 also follows the expected-response helper (6.4).
9. Group 9 follows the removal (6.9).

## 1. Database foundation

- [x] 1.1 Add the migration runner and the integration database lifecycle (design D1, D11).
  - Add `scripts/db-migrate.mjs` and the `pnpm db:migrate` script, `node --env-file-if-exists=.env scripts/db-migrate.mjs` (design D1: no dotenv dependency, exported variables win, values never printed):
    - it applies `db/migrations/NNNN_*.sql` in name order under `MIGRATION_DATABASE_URL`, one transaction per file;
    - it records applied files in `schema_migrations`, skips files already recorded, and on failure rolls back and stops with a non-zero exit.
  - Add the shared helper module `scripts/test-database.mjs` (design D11):
    - the reset helper builds its owner and app-role URLs from the host and credentials of `MIGRATION_DATABASE_URL` and `DATABASE_URL`, with the database name forced to `app_test` or `app_e2e`, and refuses any other name before connecting;
    - as the owner role it connects to the `postgres` maintenance database, creates the target if it is absent, drops and recreates its `public` schema, then migrates;
    - the scratch-database helper creates a uniquely named `app_scratch_<random>` database from the same owner credentials, runs a callback against it and drops it afterwards, dropping only databases it created.
  - Add a Vitest `globalSetup` to `vitest.integration.config.ts` that calls the reset helper for `app_test`. It loads `.env` as design D1 "Environment loading" states and throws before connecting when either URL is unset.
  - Move the default URL in `tests/integration/database.test.ts` to `app_test` (never `app_dev`).
  - Add `MIGRATION_DATABASE_URL` to `.env.example` and to the CI layer3 env (owner `app` on `app_test`). Replace the `.env.example` comment saying integration tests use the same address with one saying that integration and e2e derive `app_test` and `app_e2e` from these URLs.
  - Add a `pnpm db:migrate` row to the `AGENTS.md` daily-commands table, trimming existing prose so the file stays within the instruction-guard limits.
  - Verify (integration):
    - runner tests over fixture migration directories, each in a scratch database, cover cloud-map-storage "Fresh database", "Re-run is a no-op" and "Failing migration" (no partial statement remains, not recorded, later files not applied, non-zero exit);
    - the reset helper refuses `app_dev` and any other name besides `app_test` and `app_e2e`, and touches no database when it refuses;
    - the scratch helper drops its database after the callback, including when the callback throws.
  - Verify (local): with the URLs only in `.env` and none exported in the shell, `pnpm db:migrate` migrates the local database, and its output contains no variable value.
  - Verify (gate): `pnpm test:guardrails` passes, and the PR flags the `ci.yml` and `AGENTS.md` edits.
- [x] 1.2 Add migration `0001_accounts_and_maps.sql`, exactly per design D1.
  - Schema:
    - create the `mindsprout_app` role `NOLOGIN` if it is absent;
    - create `users`, `sessions` and `maps` with the `users_single_admin` partial unique index, the generated `title` and `updated_at` columns, and the `map->>'id' = id` check;
    - put `maps` under `ENABLE` + `FORCE` RLS with the fail-closed `maps_owner` policy;
    - grant `mindsprout_app` only the D1 privileges, including an explicit `grant usage on schema public to mindsprout_app` and no `create` on the schema.
  - Add the dev/CI bootstrap `db/dev/app-role.sql` and `pnpm db:setup` (migrate, then bootstrap; refuses when `NODE_ENV=production`), run with `node --env-file-if-exists=.env` like `db:migrate` and never printing variable values. Have the reset helper apply the bootstrap after migrating.
  - Point `.env.example` `DATABASE_URL` at `mindsprout_app` and remove the three Supabase variables. Do the same for CI layer3 `DATABASE_URL`, and run `pnpm db:setup` before the smoke step.
  - `AGENTS.md`:
    - extend the daily-commands row with `pnpm db:setup`;
    - add the Verification Matrix "DB migration" row promised there;
    - add `db/migrations/` to the account Critical Paths row.
  - Add the matching `constraints.yaml` `verification` surface entry for DB migrations, mirroring the new `AGENTS.md` row.
  - Update `docs/TECH.md` §3 so its `users`, `sessions` and `maps` lines describe the design D1 shape, including the `(owner_id, id)` primary key (design D12).
  - Verify (integration):
    - cloud-map-storage "Application role cannot bypass isolation" (`rolsuper` and `rolbypassrls` false; no table owned);
    - "Query without a user identity" (select returns no rows; insert refused);
    - the app role cannot update `users.is_admin` and cannot drop or alter any table;
    - on `app_test` as the reset helper has just rebuilt it (schema `public` dropped and recreated), the app role can select from `maps` (zero rows without an identity) and cannot create a table in `public`;
    - `/api/healthz` still answers 200 through the app role (`pnpm smoke` in CI).
  - Verify (local): after `cp .env.example .env` and `docker compose up -d`, `pnpm db:setup` succeeds with no variable exported in the shell and prints no variable value.
  - Verify (gate): `pnpm test:guardrails` and `pnpm docs:check` pass, and the PR flags the `constraints.yaml`, `ci.yml` and `AGENTS.md` edits.

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

- [x] 3.1 In `src/contexts/account/domain`, define `User`, `Session`, the `AccountError` codes (`invalid-input`, `username-taken`, `invalid-credentials`, `forbidden`, `not-found`) and the ports `UserRepository`, `SessionRepository`, `PasswordHasher`, `TokenSource` and `Clock` (design D2, D3).
  - In `account/application`, implement `register`, `signIn`, `signOut` and `resolveSession`:
    - the input bounds are username 1–64 and password 1–256 code units, compared exactly;
    - a session expires 30 days after creation by the `Clock`;
    - `signOut` is idempotent.
    - session issuance uses `createIfPasswordHashMatches` with the authenticated/registered hash, atomically serialized with password replacement; stale sign-in is `invalid-credentials`, while interrupted registration uses the existing internal-failure path without a new domain error code.
  - Verify (unit, with in-memory port doubles under `tests/support/`):
    - account-auth "Out-of-bounds input";
    - a wrong password and an unknown user yield the identical `invalid-credentials` and create no session;
    - registering a taken username yields `username-taken`;
    - `resolveSession` rejects a session whose expiry has passed by the clock;
    - `signOut` without a session succeeds.
    - deterministic reset-before-issuance interleavings reject stale sign-in and initial registration authentication; issuance-before-reset is invalidated, preserving ordinary positive paths;
    - all callers and doubles use the conditional issuance contract; the unconditional creation method is removed, not retained as an alias.
  - `pnpm boundaries` shows no framework or SQL in `domain/` or `application/`.
  - **#147 risk-pack dispositions** (selected packs map to durable evidence in design D2.1):

    | Risk pack                                      | Disposition and evidence                                                                                                                                                                 |
    | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | Public API / CLI / script entry                | Selected: exported use cases and shared ports are new; public-API lifecycle and unit evidence cover them, not HTTP/CLI behavior.                                                         |
    | Config / project setup                         | Not selected: no environment, build or service setup change is part of this slice.                                                                                                       |
    | File IO / path safety / overwrite              | Not selected: core code has no direct file/database IO; adapters are later slices.                                                                                                       |
    | Schema / columns / units / field names         | Selected: shared entity/port shapes, UTC timestamps and UTF-16/time units; type checks and boundary scenarios cover them.                                                                |
    | Auth / permissions / secrets                   | Selected: exact credential denials, session validity and secret-free results; positive/negative authentication and lifecycle scenarios cover them.                                       |
    | Concurrency / shared state / ordering          | Selected: repository-owned registration and credential-bound issuance serialize with reset; deterministic interleavings cover core semantics, while real DB orderings are proven in 4.2. |
    | Resource limits / large input / discovery      | Selected for bounded credential input: unit endpoints and astral-string scenarios prove limits; discovery and large datasets are non-goals.                                              |
    | Legacy compatibility / examples                | Selected: complete contracts must support 3.2/4.1/4.2 and preserve current consumers; type/boundary checks and all-method port smoke cover them.                                         |
    | Error handling / rollback / partial outputs    | Selected: invalid/denied inputs cause no unintended writes and unexpected port errors propagate; failure scenarios cover this without promising cross-port rollback.                     |
    | Release / packaging / dependency compatibility | Not selected: no dependency or packaging change; crypto/SQL implementations are non-goals.                                                                                               |
    | Documentation / migration notes                | Selected: D2 contracts and material documentation must match implemented interfaces; fixture review and docs gate cover the contract prose.                                              |

- [x] 3.2 Implement `listUsers(actor, { users })` and `resetPassword(actor, userId, { users, hasher, tokens })` (design D2/D2.2).
  - Both refuse a non-admin with `forbidden` before any repository, token or hashing operation; reset denial preserves credential/session state.
  - `resetPassword` draws one 16-character base64url temporary password, hashes exactly it and calls `replacePasswordAndEndSessions` once. A `false` result yields `not-found` with no preliminary lookup or state change.
  - Password replacement remains one atomic port operation and serializes with conditional session issuance; the use case does not introduce an application-level check-then-insert.
  - It returns only the temporary password, never stores it readable or logs it; unexpected token/hash/repository failures propagate unchanged.
  - Verify (unit): forbidden with no privileged port effects; not-found; ordered public users without hashes; other-user and self-reset revoke exactly target sessions, reject old credentials and accept returned temporary credentials while preserving peers; exact operation order and failures.
  - #148 risk-pack dispositions (full evidence map: design D2.2): selected public API (exported use cases), auth/secrets (actor-before-port), schema/units (public users/base64url password), concurrency (preserve conditional-issuance port; real DB #150), resource limits (single bounded reset; no enumeration/search endpoint), compatibility (existing core tests), error/partial effects (unknown/failure cases), docs (TECH/changeset). Config, file IO and packaging are not selected: no setup, IO or dependency changes.

Suggested fixture level: expanded - Critical Path src/contexts/account/: the only admin authorisation check and the uniform credential-failure semantics live here
Minimal mergeable slice: 3.1 - the self-service account use cases are complete and green alone; the admin use cases are additive.

## 4. Account infrastructure

- [x] 4.1 Implement `ScryptPasswordHasher` and `CryptoTokenSource` in `src/contexts/account/infrastructure/crypto.ts` (design D2/D2.3, D3).
  - Asynchronous scrypt uses N=2^15, r=8, p=1, fixed `maxmem = 64 * 1024 * 1024` (above Node's default-memory ceiling for this profile), a 16-byte random salt and a 32-byte key; stored format is `scrypt$N$r$p$salt$key` in canonical standard base64. Passwords use Node's UTF-8 encoding and verification compares equal-length decoded keys with `timingSafeEqual`.
  - Verification accepts only the exact profile and six canonical fields. Malformed credentials and verification derivation failures resolve false without throwing; hashing failures propagate. No stored input can select a larger work factor.
  - Session tokens encode 32 random bytes base64url; temporary passwords encode 12 random bytes base64url (16 characters), without truncation or deterministic fallback.
  - Verify (unit): "Password is never stored in plaintext" (salted, no password, `pw` succeeds, `px` fails); two salts differ; exact independently generated reference hash; UTF-8 whitespace/NUL/Unicode distinctions; malformed profile/encoding/size matrix; verification/hash error behavior; token byte widths and distinct draws.
  - #149 risk-pack dispositions (evidence D2.3): selected public API (adapter ports), auth/secrets (salt/timing/no leakage), schema/units (profile/canonical encoding/token widths), resource limits (fixed parameters/bounded parser), compatibility (core tests), error handling (verify/hash asymmetry), docs (TECH/changeset). Config/file IO/concurrency/release-packaging not selected: pure crypto adapters have no IO/configuration/state/dependency change; no concurrency claim beyond Node async behavior.
- [x] 4.2 Implement `PostgresUserRepository` and `PostgresSessionRepository` in `account/infrastructure/postgres.ts`, taking an injected `postgres.Sql`; plus sibling mocked unit tests and real-DB integration (design D1–D3/D2.4).
  - `register` runs in one transaction with `pg_advisory_xact_lock(608259634)` and `is_admin = not exists (…)`. Only `23505` on `users_username_key` maps to `username-taken`; other failures propagate. Public timestamps use `toISOString()`, list oldest-first.
  - Sessions store `sha256(token)`; lookup filters `expires_at` strictly after the supplied clock instant, returns no orphan/expired row and never slides/purges. Delete is idempotent.
  - `replacePasswordAndEndSessions` and `createIfPasswordHashMatches` lock the same user row `FOR UPDATE` before checking/updating, and complete changes before commit. Changed/missing hash returns false without insertion; absent replacement false/no effects. No unlocked check-then-insert or retry loop.
  - First-admin tests each use a migrated/bootstrapped scratch database through task 1.1, as the app role. Every other test creates fresh users in `app_test`; never truncates shared tables (design D11).
  - Verify (integration): first/second and racing registration; exact usernames; ordered public list/find; duplicate preserves credential; raw-token SHA-256 storage; strict expiry/orphan/unknown/delete; reset target-only; stale/missing false; and controlled real-connection orderings of reset versus conditional issuance. Other constraints/errors propagate and transaction failures roll back.
  - Verify (unit): transaction/query structure, exact duplicate discrimination, row mapping and all false/empty/error branches. `pnpm test:unit` ≥90% per-file and `pnpm test:integration` are both mandatory; no test self-skip.
  - #150 risk packs (D2.4): public port; schema/timestamps/hash; auth/secrets; concurrency/transactions; file IO/DB lifecycle; resource bounds (fixed SQL/no arbitrary loops); compatibility existing core; error rollback; docs. Config setup, large discovery/search and packaging not selected: no config/schema migration/search/dependency change; test scratch lifecycle unchanged.
- [x] 4.3 Add `src/contexts/account/acl/map.ts`, re-exporting map port types/errors, and implement `PostgresMapStore.forUser(userId): MapRepository` in `account/infrastructure/map-store.ts`, with mocked unit and real integration (design D4/D4.1).
  - Every call runs in its own transaction that sets `app.user_id` with `set_config(…, true)` before map SQL; GUC cannot leak across a reused pool connection.
  - `put` is a verbatim JSONB upsert on `(owner_id,id)`. `get` returns deep-equal MindMap/undefined and throws `UnsupportedSchemaVersionError(found,1)` only for newer versions. `list` includes newer-version summaries and skips null title/updatedAt. `delete` absent/other-owner id is no-op.
  - Run unchanged shared contract against fresh real app-role users, plus valid 500-node deep-equal. Two-user same-id list/get/put/delete preserves owner row. No identity sees/refuses writes. After commit, a raw max:1-pool query without new `set_config` sees no identity/maps; post-put/pre-commit fault leaves row absent and no identity.
  - Seed schema2 and raw JSON missing/JSON-null title or updatedAt as owner in scratch (never generated columns). `get` version error has found2/supported1; only null-summary rows skip, readable peer/schema2 remain. Destructive/version/isolation tests use scratch; shared app_test never deletes/truncates (D11).
  - Verify (unit): transaction/query ordering, GUC values, JSON/results/error branches, ≥90% per-file. Verify (integration): real RLS and contract, not mocks; executed wrong-owner/wrong-version/title-or-updatedAt-null counterexamples for behavioral evidence.
  - #151 risk packs (D4.1): public MapRepository/ACL; schema/JSON/timestamps/collation; auth/RLS; file IO/DB lifecycle; transaction/error rollback; compatibility shared suite; resource limits500 nodes; docs. Config setup, general concurrency race and packaging not selected: no config/new concurrent invariant/dependency change; pool identity isolation explicitly tested.

Suggested fixture level: expanded - Critical Path (`src/contexts/account/`: credentials, RLS persistence); real-database integration evidence is required.
Minimal mergeable slice: 4.1 - the hasher and token source are pure adapters with unit tests; 4.2 depends on 1.2, 3.1 and 4.1; 4.3 depends only on 1.2, because its tests insert users with raw SQL as the owner role, so it can merge in parallel with 4.1 and 4.2.

## 5. API routes

- [x] 5.1 Add the server-only composition `src/app/server/account-services.ts` and `GET /api/auth/session` (design D3, D5, D6).
  - The module holds one lazy `postgres` client per process (`max: 5`) from `loadEnv().DATABASE_URL`, wires the use cases, and fails loud when `DATABASE_URL` is missing.
  - It provides `requireUser(request)` and the cookie helpers (design D3).
  - Add `src/app/server/` to the `src/app/api/` row of the `AGENTS.md` Critical Paths table, because `requireUser` is the single session check for every map and admin route (design D6). Trim existing prose so the file stays within the instruction-guard limits, as 1.1 does.
  - `GET /api/auth/session` returns 200 `{username,isAdmin}` or 401.
  - Register this task's routes in `schemas/openapi.yaml`, review and update the snapshot hunk by hunk, add its section of `smoke/api.hurl`, and add its routes to `constraints.yaml` `key_api_routes`. Flag the Critical Path edits (`src/app/api/`, `src/app/server/` and `AGENTS.md`) in the PR.
  - Smoke: a request without a cookie answers 401.
  - Verify (unit, composition module mocked):
    - session 200 for a valid cookie, and 401 for no cookie, a forged cookie and an expired session;
    - `requireUser` returns the user or a 401 `Response`;
    - the composition module throws on first use when `DATABASE_URL` is missing;
    - no cookie appears in log calls.
  - Verify (contract): `pnpm test:contract` passes. Verify (smoke): `pnpm smoke` passes. Verify (gate): `pnpm test:guardrails` passes.
- [x] 5.2 Add `POST /api/auth/register` and `POST /api/auth/login` (design D5).
  - Both return exactly the design D5 statuses and bodies, and set the session cookie on success.
  - Register this task's routes in `schemas/openapi.yaml`, review and update the snapshot hunk by hunk, add its section of `smoke/api.hurl`, and add its routes to `constraints.yaml` `key_api_routes`. Flag the Critical Path edit in the PR.
  - Smoke: the cookie-jar flow registers a fresh user, reads `GET /api/auth/session` with the cookie, then signs in again.
  - Verify (unit, composition module mocked):
    - account-auth "Session cookie attributes" (on register and on login);
    - register 201 with the cookie, 409 `username-taken` and 400 `invalid-input`;
    - login 200 with the cookie, 401 `invalid-credentials` and 400 `invalid-input`;
    - no password, cookie or request body appears in log calls.
  - Verify (contract): `pnpm test:contract` passes. Verify (smoke): `pnpm smoke` passes. Verify (gate): `pnpm test:guardrails` passes.
- [x] 5.3 Add `POST /api/auth/logout` and the shared JSON-only guard (design D3, D5, D6).
  - The guard answers 415 `{ "error": "unsupported-media-type" }` before any side effect. This task applies it to logout and to the register and login handlers from 5.2.
  - Logout deletes the session, clears the cookie, and answers 204 also without a session.
  - Register this task's routes in `schemas/openapi.yaml`, review and update the snapshot hunk by hunk, add its section of `smoke/api.hurl`, and add its routes to `constraints.yaml` `key_api_routes`. Flag the Critical Path edit in the PR.
  - Smoke: logout, then `GET /api/auth/session` with the old cookie answers 401.
  - Verify (unit, composition module mocked):
    - logout 204 with a session (session deleted, cookie cleared with `Max-Age=0`) and without one;
    - account-auth "Cross-site form post", logout half: a form-encoded logout answers 415 and deletes nothing;
    - register and login answer 415 for a form body and call no use case.
  - Verify (contract): `pnpm test:contract` passes. Verify (smoke): `pnpm smoke` passes. Verify (gate): `pnpm test:guardrails` passes.
- [x] 5.4 Add the map read routes `GET /api/maps` and `GET /api/maps/{id}` (design D4, D5).
  - `GET /api/maps/{id}` answers 200 `{ schemaVersion: 1, map }`, 404 `not-found` when the store returns `undefined`, and 409 `{ "error": "unsupported-schema-version", "found": <n> }` when the store throws `UnsupportedSchemaVersionError`.
  - Register this task's routes in `schemas/openapi.yaml`, review and update the snapshot hunk by hunk, add its section of `smoke/api.hurl`, and mark `/api/maps` covered in `constraints.yaml` `key_api_routes`. Flag the Critical Path edit in the PR.
  - Smoke: a fresh user's list is `[]`, and getting an absent id answers 404.
  - Verify (unit, composition module mocked):
    - account-auth "API without a session", read half: 401 on both routes, including for a forged cookie;
    - 404 for an absent id;
    - cloud-map-storage "Newer-version map over the API", route half: with the store mocked to throw `UnsupportedSchemaVersionError(2, 1)`, the route answers 409 with body `{ "error": "unsupported-schema-version", "found": 2 }`.
  - Verify (contract): `pnpm test:contract` passes. Verify (smoke): `pnpm smoke` passes. Verify (gate): `pnpm test:guardrails` passes.
- [x] 5.5 Add the map write routes `PUT` and `DELETE /api/maps/{id}` (design D4, D5).
  - `PUT` passes the shared JSON guard (5.3), limits the body to 1 MiB, validates with `parseMindMap`, and enforces `schemaVersion === 1` and `map.id === {id}` before calling the store.
  - `DELETE` passes the shared JSON guard and answers 204 for an absent id.
  - Register this task's routes in `schemas/openapi.yaml`, review and update the snapshot hunk by hunk, add its section of `smoke/api.hurl`, and add its routes to `constraints.yaml` `key_api_routes`. Flag the Critical Path edit in the PR.
  - Smoke: cloud-map-storage "Round trip through the API".
  - Verify (unit, composition module mocked):
    - cloud-map-storage "Floating root without a position" and "Duplicate node ids" at the HTTP level: 400 `invalid-map`, and the store's `put` is not called;
    - a `schemaVersion: 2` body answers 400 `invalid-map` and the store's `put` is not called;
    - "Embedded id differs from the path" (400, nothing written) and "Oversized body" (413 `too-large`, by `Content-Length` and by bytes read);
    - account-auth "API without a session", write half: 401 on `PUT` and `DELETE`, including for a forged cookie;
    - account-auth "Cross-site form post", map half: 415 on a form-encoded `PUT`; also 415 on a form-encoded `DELETE`;
    - `DELETE` of an absent id answers 204.
  - Verify (smoke): cloud-map-storage "Round trip through the API". Verify (contract): `pnpm test:contract` passes. Verify (gate): `pnpm test:guardrails` passes.
- [x] 5.6 Add `GET /api/admin/users` and `POST /api/admin/users/{id}/password-reset` (design D5).
  - The reset passes the shared JSON guard (5.3). A non-uuid id answers 404 `not-found`, like an unknown one.
  - Register this task's routes in `schemas/openapi.yaml`, review and update the snapshot hunk by hunk, add its section of `smoke/api.hurl`, and add `/api/admin/*` to `constraints.yaml` `key_api_routes`. Flag the Critical Path edit in the PR.
  - Smoke: register two fresh users and assert 403 for the second (design D11).
  - Verify (unit, composition module mocked):
    - account-admin "Reset of an unknown account" (404, nothing changes), for an unknown uuid and for a non-uuid id;
    - 401 without a session, 403 for a non-admin, and 415 for a form-encoded reset;
    - 200 `{temporaryPassword}` for the admin, and the list ordered by `created_at` ascending.
  - Verify (contract and smoke): cloud-map-storage "Published contract matches", with every auth, map and admin route present. Prerequisite: 5.1–5.5 have merged, so this task merges last in group 5. Verify (gate): `pnpm test:guardrails` passes.

Suggested fixture level: expanded - Critical Path (`src/app/api/`: public API contract; `src/app/server/` from 5.1: the shared session check) plus `schemas/openapi.yaml`, `smoke/` and `constraints.yaml` updates.
Minimal mergeable slice: 5.1 - composition, session reading and `GET /api/auth/session` merge and smoke-test alone (after 3.1 and 4.2); 5.2 depends on 5.1; 5.3 depends on 5.2 (it applies the guard to register and login); 5.4 depends on 5.1 and 4.3; 5.5 depends on 5.3 (guard), 5.4 (same route file) and 2.1 (`parseMindMap`); 5.6 depends on 5.1, 5.3 and 3.2 for its code and merges last, because "Published contract matches" needs 5.2–5.5.

## 6. Browser storage cut-over

- [x] 6.1 Add `StorageUnauthorizedError` to `src/contexts/map/domain/errors.ts`. Implement `HttpMapRepository` in `src/contexts/map/infrastructure/persistence` (design D7):
  - `get` maps 404 to `undefined`, and a 409 `unsupported-schema-version` body to `UnsupportedSchemaVersionError(found, 1)`;
  - `put` uses keepalive only for bodies of at most 60,000 bytes and starts its request synchronously;
  - `delete` sends `Content-Type: application/json` with the body `{}`;
  - a 401 throws `StorageUnauthorizedError`; any other failure, including network errors, throws a plain `Error`.

  Add a fetch double under `tests/support/` that serves the D5 map contract from memory.
  - Verify (unit):
    - cloud-map-storage "Contract over HTTP and over the database", HTTP half: the contract suite passes unchanged against `HttpMapRepository` with the fetch double;
    - map-persistence "Flush outlives the page";
    - a 409 `{ "error": "unsupported-schema-version", "found": 2 }` makes `get` throw `UnsupportedSchemaVersionError(2, 1)`;
    - a malformed 200 envelope rejects with an `Error` naming the id;
    - `put` has issued its request before its returned promise settles.

- [x] 6.2 Handle the new storage outcomes in the editor and library (design D7).
  - Autosave classifies `StorageUnauthorizedError` and sets `SESSION_EXPIRED` (`登录已过期，请在新标签页重新登录后继续编辑`); the map stays pending.
  - `EditorView` shows the `重新登录` link to `/login?next=%2F` (new tab, never the editor) while that notice is displayed.
  - The library list and the editor `get` redirect to `/login?next=<path>` on a load-time `StorageUnauthorizedError`.
  - Use the actual notice/store seam in `editor-store.ts` and guarded library load seam in `MapLibrary.tsx`; preserve decision0011 explicit notice dismissal and decision0016 map identity.
  - Verify (unit/component, fetch double):
    - account-auth "Edit after the session ended" and "Pending edits saved after signing in again" (401 then 204: the second save contains both edits);
    - account-auth "Re-login does not open a second editor", link half: the link's `href` is `/login?next=%2F` and its `target` is `_blank`;
    - "Expired session on page load";
    - map-persistence "Write failure is visible" (500 and network error show "保存失败", the next edit saves both).
    - repeated failures and older204 after newer401 retain the current pending map; successful current saves stop duplicate flushes without dismissing notices;
    - current library/editor401 redirects to the encoded pathname; non401, discarded library401 and stale editor401 do not redirect.
  - Verify existing library/editor UI smoke with Playwright screenshots and zero unexpected console errors; no provider or e2e implementation changes.
- [x] 6.3 Prepare e2e for the database (design D11).
  - [x] 6.3a Isolate the e2e database, server and build output (#160; D11.2). Complete the lifecycle/environment evidence below without registration or signed-in fixtures.
  - [x] 6.3b Register first-account `e2e-admin` in globalSetup and add isolated regular/admin session fixtures (#175; D11.5). Two focused tests and full e2e 127/127 pass.
  - Add a Postgres service to CI layer7, plus `MIGRATION_DATABASE_URL` and `DATABASE_URL`. CI layer7 keeps running `pnpm e2e`.
  - Add `scripts/e2e-db.mjs`. It calls the task 1.1 reset helper for `app_e2e`, which creates the database if absent, resets it, migrates and applies the bootstrap. The `e2e` script becomes `node --env-file-if-exists=.env scripts/e2e-db.mjs && playwright test`, and `verify-ui` gets the same prefix, so the database exists before Playwright starts its `webServer`.
  - `next.config.ts` reads `distDir` from `NEXT_DIST_DIR`, defaulting to `.next`. Add `.next-e2e/` to `.gitignore` and to the knip, ESLint and Prettier ignores.
  - `playwright.config.ts` starts its own `next dev --port 3100` with `NEXT_DIST_DIR=.next-e2e`, `DATABASE_URL` derived for `app_e2e`, `reuseExistingServer: false` and a matching `baseURL`. It loads `.env` as design D1 "Environment loading" states and throws before starting the server when `DATABASE_URL` or `MIGRATION_DATABASE_URL` is unset.
  - Its `globalSetup` only registers `e2e-admin` over HTTP, as the first account on the fresh database.
  - `e2e/support/session.ts` exports a `test` fixture whose `page` is signed in as a freshly registered user, and an `adminPage` signed in as `e2e-admin`.
  - Seeding keeps its IndexedDB internals.
  - Verify (e2e):
    - the full existing suite passes unchanged;
    - a new fixture test proves the fixture page carries a valid session (`GET /api/auth/session` returns 200 with its username);
    - with `pnpm dev:bg` serving `:3000`, `pnpm e2e` still starts its own server and passes;
    - `pnpm e2e` passes on a database server where `app_e2e` does not yet exist.
  - Verify (local): with the URLs only in `.env` and none exported, `scripts/e2e-db.mjs` prepares `app_e2e`, the e2e server connects to `app_e2e` (not `app_dev`), and no variable value is printed; with `DATABASE_URL` unset everywhere, `playwright test` fails before starting a server.
  - Verify isolated public-fixture subprocesses for file-only URLs, exported-wins precedence and each missing key. Absolute entrypoint/config paths and scrubbed inherited database variables must avoid the checkout `.env`; a launch sentinel proves no webServer command ran for missing keys.
  - Induce an e2e preparation CLI reset/driver failure: nonzero exit and fixed diagnostics, with no URL/password/cause markers in captured output.
  - Verify (gate): `pnpm test:guardrails` passes and the PR flags the workflow edit.
  - Verify `pnpm dead-code` without exported database keys; its static-only fixture URLs must preserve Playwright plugin discovery and fail-fast runtime validation.
  - Verify native JSON stdout and file reports contain neither source nor derived URLs, usernames, passwords or unique secret markers for both package entrypoints. The real launched child must still receive both derived app_e2e URLs; missing keys prevent launch, child failures remain nonzero and Playwright teardown leaves no owned server.
- [x] 6.4 Add the declared expected-response helper for e2e (design D13). Depends on 6.3. (#161; 20 focused and 115 full browser tests, full Semgrep, and static gates pass.)
  - Add `e2e/support/expected-responses.ts`. A test declares each expected non-2xx response as a URL pattern and a status; the helper records page responses through `page.on('response')` and exports the console-noise collector.
  - The collector drops a `Failed to load resource` console message only when its URL and status match a declaration that was observed as a response with that URL and status. It reports every other console error or warning, every page error, every failed load without a matching declaration, and every declaration that was never observed.
  - A spec adopts the collector in the task that first declares a response in it (6.8, 8.2, 9.1). Specs without declarations keep their current collectors.
  - Add the decision record `decisions/implemented/testing/0024-declared-expected-http-errors-in-e2e.md` (procedure: `.claude/skills/decision-record-lifecycle/SKILL.md`).
  - Verify (e2e): the self-test `e2e/expected-responses.spec.ts`, the helper's first consumer, opens `/api/healthz` signed out and has the page `fetch('/api/auth/session')`, which answers 401:
    - declared as 401 and observed: the collector reports nothing;
    - undeclared: the collector reports the `Failed to load resource` message;
    - declared as 404: the collector reports the message and the unused declaration;
    - declared but never requested: the collector reports the unused declaration;
    - a `console.error` from the page next to a declared, observed 401 is still reported.
    - Register the exact response and resource-error console waiters before fetch; await both with no fixed sleep and reconcile either event order.
    - Truncated path mismatch reports resource error and unused declaration; relative/absolute equivalent paths and documented query/fragment cases report none.
    - Page warning and uncaught pageerror beside the matched 401 remain reported.
  - Verify (gate): `pnpm decisions:check` and `pnpm dead-code` pass.
- [x] 6.5 Switch every e2e spec to the signed-in `test` fixture from `e2e/support/session.ts`, except the specs that test signed-out behaviour. This is a mechanical import change with no assertion edits. (#162;14 imports, full e2e127/127 and focused exclusions/session31/31 pass.)
  - Excluded by name: `e2e/expected-responses.spec.ts` (6.4), and any other spec that tests signed-out behaviour, such as the 7.1 register and sign-in walks if they have landed. They keep the base Playwright `test`, signed out by design.
  - Verify (e2e): the full suite passes with zero skips and zero console errors, and the excluded specs still run signed out.
- [x] 6.6 Give the native HMR probe a database and a signed-in user (design D11). Depends on 5.2; merges before 7.2 and 6.8.
  - [x] 6.6a Move source-seam anchors off cut-over lines and assert exact `保存失败` absence (#174; D11.4). 55 support tests and both local native modes pass with unchanged gates.
  - [x] 6.6b Complete the database, sign-in and documentation bullets (#163; D11.3), including the sibling Linux candidate workflow that invokes the same signed-in probe. 51 support tests, both local modes, installed CI 43744364665 and candidate CI 43744364615 pass. #174 owns the separate anchor/assertion bullets.
  - CI `native-installed-runtime` runs `pnpm db:setup` against a reachable Postgres 16 on both matrix legs, with `MIGRATION_DATABASE_URL` and `DATABASE_URL` set. The Linux leg uses a service container. GitHub runs service containers only on Linux runners, so the `macos-26` leg needs another mechanism; the implementer chooses it, for example starting a Homebrew Postgres 16 in a step.
  - `scripts/native-hmr.mjs` registers and signs in a fresh random user over the API, in the probe's browser context, before `publicMap` runs. It signs in before it opens any page that calls an authenticated API, so it receives no expected non-2xx response, needs no design D13 declaration, and keeps its console check unchanged.
  - In `scripts/native-hmr.mjs`, `visitEditor`'s `Map must be persisted` assertion stops checking that `未保存到浏览器` is absent, because 6.9 deletes that text. It asserts instead that the autosave failure notice `保存失败` is absent, a surface that exists before the flip and after 6.9.
  - The source-seam anchors in `sourceStimulus` (`scripts/native-hmr-support.mjs`) move off `<EditorView storageUnavailable={storageUnavailable} />` in `MapEditor.tsx` and the `RepositoryContext` return line in `MapRepositoryProvider.tsx`. The new anchors are lines that 6.8 and 6.9 do not touch; the implementer chooses them.
  - Update `docs/engineering/native-hmr.md` with the database prerequisite and the sign-in step.
  - Verify: development-navigation "First editor navigation after source invalidation" and "Retained session restores cached resource producers" still hold with the signed-in probe. `grep -n 未保存到浏览器 scripts/native-hmr.mjs` finds nothing. `pnpm native:browser:test` passes; `pnpm native:browser source-change` and `restored-lifecycle` pass locally against a `pnpm db:setup` database; the CI `native-installed-runtime` job passes on both legs. Verify (gate): `pnpm test:guardrails` passes, `pnpm docs:check` passes, and the PR flags the workflow edit (Critical Path `.github/workflows/`).
- [x] 6.6.1 Add native cold-navigation gate and Document response diagnostics for #190 (design D11.1).
  - Preserve every 5000ms deadline, browser-noise assertion and no-warmup/retry/skip rule.
  - Label the initial public-map root-document commit error without changing navigation behavior.
  - Record passive Document response/completion metadata with bounded request tracking and paired fake-CDP tests.
  - Verify (unit): deterministic fake root timeout and Document response/finish/failure cases; `pnpm native:browser:test` passes.
  - Verify (runtime): both local native browser modes pass with unchanged gates; `pnpm test:guardrails` and `pnpm docs:check` pass. Record unknown root-cause boundary rather than inferring repair from a later green run.
- [x] 6.7 Add the component tests that replace the raw-record e2e cases (design D10 step 2). Every test runs over a repository double that returns the given value, and stays green alongside the e2e cases it replaces until the flip deletes them.
  - The cases and their new seams:
    - `e2e/map-editor.spec.ts` "corrupt record shows the error state and leaves the record untouched" → map-library "Corrupt record";
    - `e2e/map-editor.spec.ts` "mismatched map identity shows the error state and preserves source and peer records" → map-library "Mismatched stored map identity";
    - `e2e/map-editor.spec.ts` "matching map identity autosaves a node title under its own key and preserves its peer" → map-library "Matching identity preserves normal persistence";
    - `e2e/map-editor.spec.ts` "future version shows its message and leaves the record untouched" → map-persistence "Future version";
    - `e2e/map-library.spec.ts` "Future-version rename is refused and explicit deletion removes the raw record" → map-library "Unsupported version in the library";
    - `e2e/map-library.spec.ts` "Rename refuses a mismatched embedded ID without overwriting its peer" (record under key `selected`) → map-library "Rename target identity is invalid";
    - `e2e/map-library.spec.ts` `Odd-version "1"` and `Odd-version 0` (with the hidden `{ title: 42 }` record) → no component test. These rows cannot exist under `schema_version integer` plus server validation; the task 4.3 integration test that `list` skips a row without a title replaces them.
  - Verify (unit/component): map-library "Corrupt record", "Mismatched stored map identity", "Matching identity preserves normal persistence", "Unsupported version in the library" and "Rename target identity is invalid", and map-persistence "Future version". Verify (e2e): the full suite still passes, with the replaced cases still present.
- [x] 6.8 Flip the browser to the cloud store (design D10 step 3). Depends on 6.1–6.7, 7.1 and 7.2. (#168; full unit1685/1685 including commit-aware ordering, bound and credential-only legacy account regressions, full e2e122/122 with bound+legacy account-switch paths, same-account recovery and both declared404s, integration95/95, contract, native55/55 plus both actual native modes, frozen/native-lockfile/dead-code/license/docs/decision gates pass; decision0028.)
  - `MapRepositoryProvider` constructs one `HttpMapRepository` per document session.
  - In the same PR, delete `indexed-db-map-repository.ts` and its test, because nothing uses them any more, and rewrite the provider tests for the HTTP adapter.
  - Remove the `idb` and `fake-indexeddb` dependencies with the lockfile change. They are what `pnpm dead-code` would report once the adapter is gone.
  - In `e2e/support/seed.ts`, switch `seedRecords` to API `PUT` and reimplement `readRecord` over API `GET /api/maps/{id}` (404 → `undefined`). Both keep their call signatures and send their requests through `page.request`, which shares the context's cookies and logs nothing to the page console.
  - Assertions are unchanged except that tests hitting an expected 404 declare it through the design D13 helper (6.4) and adopt its collector:
    - `e2e/map-editor.spec.ts` `stale link shows not-found with a link back to the library` declares `GET /api/maps/does-not-exist` 404;
    - `e2e/map-library.spec.ts` `Delete with confirmation` declares `GET /api/maps/A` 404 for its open after the delete.
  - Delete `e2e/storage-fallback.spec.ts` and the e2e cases listed in 6.7.
  - Remove the "browser-only storage" README limitation.
  - Verify (e2e): the full suite passes against the cloud store with assertions unchanged apart from those two declarations, including map-persistence "Reload after edits" and "Edits older than the save window survive reload", and map-library "Stale link". Both declared 404s are observed, and no other console error appears. Verify (gate): `pnpm dead-code` and `pnpm licenses:check` pass, and the lockfile guard passes.
- [x] 6.9 Remove the browser-storage leftovers (design D10 step 4). (#169; full unit77 files/1668 tests including the moved13 contract cases, full e2e122/122, native support55/55, dead-code/static gates and the exact acceptance grep pass.)
  - Delete `StorageUnavailableError`, the storage-unavailable banner, every `storageUnavailable` flag and the autosave `onUnavailable` path.
  - Move `InMemoryMapRepository` into `tests/support/` as the contract suite's in-memory double, keeping the contract suite running against it. Add `tests/support/**/*.test.ts` to the existing node project in `vitest.config.ts`; do not create another test tier.
  - Verify: `pnpm test:unit`, `pnpm dead-code` and `pnpm e2e` pass. The unit report must name `tests/support/in-memory-map-repository.test.ts` and execute its contract cases; a green run that omits the moved file is not evidence. `grep -rE "StorageUnavailable|storageUnavailable|未保存到浏览器|indexedDB" src e2e scripts` finds nothing (the backstop for 6.6's `scripts/native-hmr.mjs` change).

Suggested fixture level: expanded - cross-module cut-over of the persisted-state boundary with e2e infrastructure and CI workflow edits (layer7 and the required native HMR job); a slip loses user edits.
Minimal mergeable slice: 6.1 - the HTTP adapter is fully contract-tested and unused by the UI until the flip; 6.2 depends on 6.1; 6.3 depends on 5.2, and 6.4 and 6.5 each on 6.3; 6.6 depends on 5.2; 6.7 depends on nothing in this change; the 6.8 flip depends on 6.1–6.7, 7.1 and 7.2; the 6.9 removal depends on 6.8.

## 7. Sign-in pages and routing

- [x] 7.1 Add `/login` and `/register` pages with client forms in `src/components/account/` (design D8).
  - The forms post JSON to the auth routes and show `用户名或密码错误`, `用户名已被占用` and `请输入用户名和密码`.
  - On success they navigate to `next`, sanitised by a shared pure `safeNextPath` helper in `src/shared/`.
  - Add `/login` to `constraints.yaml` `key_ui_paths` and to the `e2e/smoke.spec.ts` walk.
  - Verify (unit/component): account-auth "Taken username" and "Wrong password or unknown user" (the texts), and "Foreign redirect target is ignored" (`safeNextPath`).
  - Verify (e2e), proving only these THEN parts:
    - "Register and land signed in": the visitor lands on `/`, and `GET /api/auth/session` answers 200 with `alice`. The header THEN is proved in 7.3;
    - "Sign in": she lands on `/`, and `GET /api/auth/session` answers 200 with her username. "Her maps are listed" is proved in 9.1, after the flip.
- [x] 7.2 Add `src/proxy.ts` (design D8). Depends on 6.5 (every spec except the signed-out ones signed in), 6.6 (the native HMR probe signs in) and 7.1. (#166;35 proxy tests, full unit1679/1679, build, focused10/10 and full e2e128/128, guardrails85/85 pass.)
  - The matcher excludes `/_next/static`, `/_next/image`, `/icon.svg`, `/api/`, `/login` and `/register`.
  - When the session cookie is missing it redirects 307 to `/login?next=<path+query>`. It checks only that the cookie exists.
  - Add `src/proxy.ts` to the `AGENTS.md` Critical Paths table, trimming existing prose so the file stays within the instruction-guard limits, as 1.1 does.
  - Verify (unit): account-auth "Public surfaces need no session" (proxy and matcher).
  - Verify (e2e): account-auth "Signed-out visit returns after sign-in". The walk owns map `abc`, so it never meets a 404 before or after the 6.8 flip:
    - it registers its own user through `/register`, keeping the password, and seeds map `abc` for that user through `seedRecords` (`e2e/support/seed.ts`) while signed in;
    - it clears the session cookie and opens `/maps/abc`, and expects the redirect to `/login?next=%2Fmaps%2Fabc`;
    - it signs in and lands on the editor of `abc`, with no 404 response at any point and zero console errors, so it needs no design D13 declaration.
  - Verify (gate): `pnpm test:guardrails` passes, and the PR flags the `src/proxy.ts` and `AGENTS.md` edits.
- [x] 7.3 Add the header session menu in `src/components/account/` and mount it on `/` and `/maps/[id]` (design D8). Depends on 5.3, 6.5, 6.6 and 7.1: its `GET /api/auth/session` on a signed-out page logs a 401 console error, which the e2e and native HMR console assertions reject. Task 8.1 mounts it on `/admin`. (#167; full unit1690/1690, native55/55, focused11/11 and full e2e129/129 pass.)
  - It shows the username, a `管理后台` link for the admin only, and `退出登录`, which posts `{}` to logout.
  - Verify (unit/component): account-admin "Admin link visibility".
  - Verify (e2e): account-auth "Sign out", and the header THEN of "Register and land signed in" (after registering, the header shows `alice`).

Suggested fixture level: expanded - `src/proxy.ts` gates every page and becomes a Critical Path; the redirect target is an open-redirect surface.
Minimal mergeable slice: 7.1 - the public sign-in and registration pages work alone (after 5.2 and 6.3); the proxy (7.2) needs 7.1, 6.5 and 6.6; the header (7.3) needs 7.1, 5.3, 6.5 and 6.6 and is independent of the proxy.

## 8. Admin page

- [x] 8.1 Add `/admin`, listing users via `GET /api/admin/users` (username, creation time, 管理员 badge, oldest first), with "无权访问" on 403 (design D9). Depends on 5.6 and 7.3. (#170; component15/15, full unit78 files/1683 tests, real build, guardrails85/85, full e2e124/124 and both admin browser paths pass; decision0025 covers the third document-navigation call.)
  - Mount the header session menu from 7.3 on `/admin`.
  - On a 401 the page calls `window.location.assign('/login?next=%2Fadmin')`.
  - Add `/admin` to `constraints.yaml` `key_ui_paths` and to the `e2e/smoke.spec.ts` walk. The walk opens `/admin` with `adminPage`, because the default `page` is not the admin and would receive a 403.
  - Verify (unit/component): account-admin "Regular user is refused" (page); a 401 on load calls `window.location.assign('/login?next=%2Fadmin')` and renders no user data. Verify (e2e): "Admin sees all accounts" (`e2e-admin` plus two registered users, in order).
- [x] 8.2 Add the per-row `重置密码` action: a confirmation ("重置后该用户的所有登录将失效"), a call to the reset API with the JSON body `{}`, and a one-time dialog with the temporary password that is discarded on close (design D9). Depends on 8.1 and 6.4. (#171; component27/27 with 100% coverage, full unit78 files/1695 tests, build, full e2e125/125 and two-user-context reset acceptance pass.)
  - A 401 from the reset calls `window.location.assign('/login?next=%2Fadmin')`.
  - Verify (unit/component): account-admin "Cancel the reset" and "Temporary password is shown once"; a 401 from the reset calls `window.location.assign('/login?next=%2Fadmin')`. Verify (e2e): "Reset signs the user out and issues a temporary password" (two contexts as the user, one as the admin). The walk declares through the design D13 helper every expected non-2xx its pages receive: the 401s on both of the user's contexts after the reset, and the `POST /api/auth/login` 401 when the old password is tried through the form. Each declaration is observed, and no other console error appears.

Suggested fixture level: compact - UI over an already-tested admin API; no persistence or entrypoint of its own.
Minimal mergeable slice: 8.1 - the read-only list merges alone once 5.6 and 7.3 have merged; the reset action (8.2) is additive on 8.1 and also needs the 6.4 helper for its declared 401s.

## 9. M2 acceptance and documentation closure

- [x] 9.1 Add the M2 acceptance walk `e2e/m2-acceptance.spec.ts` with two browser contexts. Depends on 6.9 (and so on the 6.4 helper). (#172; focused1/1 and full e2e125/125 with zero skipped/flaky/unexpected, six inspected screenshots and three observed D13 declarations; typecheck/lint/format pass.)
  - Verify (e2e):
    - cloud-map-storage "Open on a second device";
    - account-auth "Sign in", the "her maps are listed" THEN: after signing in on `/login`, the library lists the map she created in the other context;
    - account-auth "Re-login does not open a second editor": in one context, sign out in a second tab and rename a node in the editor tab; follow 重新登录, sign in on the new tab, which shows `/`; the editor tab's next edit saves both changes;
    - map-library "Only the user's own maps" and "Another user's map";
    - account-admin "Admin opens another user's map" (`e2e-admin` gets the not-found state for a user's map URL);
    - screenshots in `.run/ui-evidence/`, and zero console errors apart from the responses declared through the design D13 helper: the `PUT /api/maps/{id}` 401 of the re-login walk and the `GET /api/maps/{id}` 404s of "Another user's map" and "Admin opens another user's map". Each declaration is observed.
- [ ] 9.2 Close the documentation.
  - Update README `## Known Limitations` so it contains the seven items of map-library "Published canvas limitations" and keeps every other existing entry that is still true, including the `开发热更新` entry that links to `docs/engineering/native-hmr.md#known-limitations`.
  - Add `docs/engineering/database.md` covering roles and URLs, `db:migrate` and `db:setup`, backup before migrating, the deployment procedure (create the `mindsprout_app` login with a strong password, migrate, start, and register the owner first) and the smoke-on-fresh-dev-database caveat (design D11, D12).
  - Update TECH §7 to the implemented layout, including the account context, `db/` and the new routes.
  - Update the `constraints.yaml` metrics downgrade text from "deferred to M2" to "deferred until a deployment target exists".
  - Verify (gate): map-library "M1 documentation closure", "M2 documentation closure" and "Missing limitations are rejected"; `pnpm docs:check` and `pnpm test:guardrails` pass.

Suggested fixture level: compact - an acceptance test and documentation over finished behaviour.
Minimal mergeable slice: 9.1 - the acceptance walk merges alone after 6.9; the documentation closure (9.2) is an independent PR, also after 6.9.
