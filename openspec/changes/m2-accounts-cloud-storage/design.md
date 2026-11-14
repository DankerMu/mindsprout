# Design

## Context

See proposal.md (Why) and decision 0023 for the chosen direction. Facts that shape the approach:

- **Repository port.** `MapRepository { list, get, put, delete }` and its errors live in `src/contexts/map/domain/`. `put` stores verbatim, `list` orders by `updatedAt` desc then id asc, and `UnsupportedSchemaVersionError` comes only from `get`. A reusable contract suite exists: `tests/support/map-repository-contract.ts`, `describeMapRepositoryContract`, 13 cases. The repository is chosen once per document session in `src/app/providers/MapRepositoryProvider.tsx` (decision 0011).
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
  - CI layer7 (e2e) and the required `native-installed-runtime` job have no database today. The native HMR probe (`scripts/native-hmr.mjs`) starts `pnpm dev` signed out, opens `/` and clicks 新建导图, and edits source-seam anchors in `MapEditor.tsx` and `MapRepositoryProvider.tsx`.
  - Next 16 `next dev` holds a lock at `<distDir>/lock` (`version-16.md`), so a second dev server on the same `distDir` cannot start.
  - Playwright runs `webServer` before `globalSetup`.
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
- Migration `0001` creates `mindsprout_app` as `NOLOGIN` if absent and rejects an existing role with `SUPERUSER` or `BYPASSRLS` rather than demoting it; it grants schema `public` usage and only the table privileges below.
- The dev/CI bootstrap `db/dev/app-role.sql` does `ALTER ROLE mindsprout_app LOGIN PASSWORD 'app'`. This is a fixed local credential, like `app/app` today.
  - `pnpm db:setup` migrates then applies the bootstrap and refuses production before client construction. Bootstrap failure leaves already committed migrations intact.
  - CI applies it after migrating.
  - Fresh-clone setup waits for Compose's database health check before `db:setup`; the complete command lives in `AGENTS.md`.
- **Environment loading.** The Node scripts that need the database URLs (`scripts/db-migrate.mjs`, the `db:setup` script and `scripts/e2e-db.mjs`) run as `node --env-file-if-exists=.env …`. The flag is built into Node since 22.9, below the `engines` floor `>=22.11.0`, so there is no dotenv dependency. Variables already exported, as in CI, win over the file, and a missing `.env` is not an error. The scripts never print variable values. `playwright.config.ts` and the Vitest integration `globalSetup` load `.env` the same way through Node's built-in `process.loadEnvFile` when the file exists, taking only keys not already set, and throw before connecting or starting any server when `DATABASE_URL` or `MIGRATION_DATABASE_URL` is unset. The e2e `webServer` always receives the derived `app_e2e` URL explicitly, so its `next dev` never falls back to the `app_dev` URL in `.env`.
- Production sets the role password by hand; see `docs/engineering/database.md`.
- Alternative rejected: one connection that runs `SET LOCAL ROLE` per transaction. Forgetting the role switch silently runs as a superuser or owner. A separate role that has no power cannot be misused that way.

**Schema** (`db/migrations/0001_accounts_and_maps.sql`):

| Table      | Columns                                                                                                                                                                                                                                                                                                                      | Notes                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `users`    | `id uuid pk default gen_random_uuid()`, `username text not null unique`, `password_hash text not null`, `is_admin boolean not null default false`, `created_at timestamptz not null default now()`                                                                                                                           | Partial unique index `users_single_admin on users ((true)) where is_admin` — at most one admin |
| `sessions` | `token_hash text pk`, `user_id uuid not null references users on delete cascade`, `expires_at timestamptz not null`, `created_at timestamptz not null default now()`                                                                                                                                                         | Index on `user_id` (reset deletes by user)                                                     |
| `maps`     | `id text not null`, `owner_id uuid not null references users on delete cascade`, `schema_version integer not null`, `map jsonb not null`, `title text generated always as (map->>'title') stored`, `updated_at text generated always as (map->>'updatedAt') stored`, `check (map->>'id' = id)`, `primary key (owner_id, id)` | `ENABLE` + `FORCE ROW LEVEL SECURITY`; index `(owner_id, updated_at desc, id collate "C")`     |

- Map ids are scoped per owner: the primary key is `(owner_id, id)`. Two users may hold the same id, and neither can learn that the other does. The contract suite and the e2e specs reuse fixed ids (`'a'`, `'selection'`) for every fresh user.
- The whole `MindMap` is kept as one `jsonb` value. `title` and `updatedAt` are generated columns, so there is one source of truth and `get` returns exactly what `put` stored.
- `updatedAt` is always `toISOString()` output (fixed format), so sorting it as text sorts it by time. The `"C"` collation gives the contract's code-unit order for ties.
- **RLS policy.** `maps_owner` applies to all commands: `using (owner_id = nullif(current_setting('app.user_id', true), '')::uuid)`, with the same `with check`.
  - When the setting is missing the comparison yields null, so the query sees no rows.
- **Grants to `mindsprout_app`.**
  - Schema `public`: `usage` only, granted explicitly by migration `0001`. A `public` schema recreated by the reset helper (D11) has lost the template's default `usage` for `PUBLIC`, so the app role would otherwise be refused on every table. The app role gets no `create` on the schema.
  - `maps`: select, insert, update, delete. RLS governs.
  - `users`: select, insert, and update of `password_hash`.
  - `sessions`: select, insert, delete.
  - `users` and `sessions` have no RLS. They are the authentication tables, read before an identity exists, and only `account/infrastructure` queries them.

**Migrations.**

- `scripts/db-migrate.mjs` (`pnpm db:migrate`, run with `--env-file-if-exists=.env`) applies `db/migrations/NNNN_*.sql` in name order. Each file runs in its own transaction under the owner role.
- The exported seam is `migrateDatabase({ migrationsDir, databaseUrl })`. A missing or empty directory succeeds after ensuring `schema_migrations`; discovery accepts only numbered SQL files.
- Applied files are recorded in `schema_migrations(name text pk, applied_at timestamptz)` in the same transaction as their statements. A recorded file is skipped; a failing file and its record roll back, earlier commits survive, and the command exits non-zero.
- There is no down-migration. Rollback means restoring a backup (`docs/engineering/database.md`).

### D2. Account model and use cases

- **Ports** in `account/domain/`: `UserRepository`, `SessionRepository`, `PasswordHasher`, `TokenSource`, `Clock`.
  - Entities: `User { id, username, isAdmin, createdAt }` and `Session { userId, expiresAt }`.
  - `User.createdAt` and `Session.expiresAt` are UTC ISO timestamp strings, matching the existing domain timestamp convention. Credentials are not fields of `User`.
  - `UserRepository.register(username: string, passwordHash: string): Promise<User>` atomically creates the account, owns id/creation time/first-admin assignment, and throws `AccountError('username-taken')` on an exact duplicate.
  - `UserRepository.findByUsername(username: string): Promise<{ user: User; passwordHash: string } | undefined>` returns credentials only to the authentication use case; `list(): Promise<User[]>` returns users oldest-created first.
  - `UserRepository.replacePasswordAndEndSessions(userId: string, newHash: string): Promise<boolean>` atomically replaces the hash and ends only that user's sessions; `false` means no such user and no change, allowing the admin use case to report `not-found`.
  - `SessionRepository.create(token: string, session: Session): Promise<void>`, `resolve(token: string, now: Date): Promise<User | undefined>`, and `delete(token: string): Promise<void>` own session persistence, user joining and idempotent deletion. Resolution returns a user only when `expiresAt > now`; an unknown token or missing user returns `undefined`, and expired rows are retained.
  - `PasswordHasher.hash(password: string): Promise<string>` and `verify(password: string, stored: string): Promise<boolean>` own hashing/verification; malformed stored hashes verify false.
  - `TokenSource.sessionToken(): string` draws 32 random bytes encoded base64url; `temporaryPassword(): string` draws 16 base64url characters. Deterministic test sources implement both methods.
  - `Clock.now(): Date` supplies the current instant. The application derives non-sliding expiry from one clock reading plus exactly 30 days.
  - Raw-token hashing (`sha256` hex) belongs to the production session adapter, never domain/application. In-memory test ports model the observable contract, not cryptographic or SQL guarantees.
- **Use cases** in `account/application/`: `register`, `signIn`, `signOut`, `resolveSession`, `listUsers`, `resetPassword`.
  - Each use case takes its ports as arguments and contains no framework or SQL.
  - `register({ username, password }, { users, sessions, hasher, tokens, clock })` and `signIn` with the same arguments return `Promise<{ user: User; token: string }>`.
  - `resolveSession(token: string | undefined, { sessions, clock })` returns `Promise<User | undefined>`; `signOut(token: string | undefined, { sessions })` returns `Promise<void>`. Missing tokens resolve to absence and sign-out is a no-op.
  - Credential denials are `invalid-credentials`; invalid bounds remain `invalid-input`. Unexpected port failures propagate, never become successful authentication or a credential-denial fallback. Account creation and session creation are separate port operations; no cross-port rollback is promised.
- **Input bounds** (owner: no policy, technical bounds only). The same bounds apply to registration, sign-in and admin input.
  - `username` is 1–64 UTF-16 code units, compared and stored exactly: no trimming, case folding or normalisation.
  - `password` is 1–256 code units. The upper bound keeps scrypt cost bounded.
  - Out-of-bounds input is rejected with `invalid-input`.
- **Password hashing.** `node:crypto` `scrypt` with N=2^15, r=8, p=1, a 16-byte random salt and a 32-byte key. The result is stored as `scrypt$<N>$<r>$<p>$<saltB64>$<keyB64>`, and verification uses `timingSafeEqual`.
  - Registration already reveals whether a username exists, so sign-in does not equalise timing for unknown users.
  - Unknown-user and wrong-password sign-in denials return the same `invalid-credentials`.
- **First admin.** `UserRepository.register` runs in one transaction. It takes `pg_advisory_xact_lock(<constant>)` and inserts with `is_admin = not exists (select 1 from users)`. The partial unique index backs this up if the lock is ever bypassed.
- **Admin actors and temporary passwords.** `listUsers(actor: User)` and `resetPassword(actor: User, userId: string)` reject non-admin actors. Reset draws a 16-character base64url temporary password from `TokenSource`, hashes it and uses the single atomic repository replacement operation to end that user's sessions.
  - It returns the temporary password once; it is never stored or logged.
  - An admin may reset their own password, which signs them out.

### D2.1 Account core slice fixture

- **Change surface:** account domain types/errors/ports, `register`, `signIn`, `signOut`, `resolveSession`, sibling unit tests, and functional in-memory doubles under `tests/support/`.
- **Must preserve:** D1/D11 persistence safety and existing map behavior; public `User` never includes a password/hash; input strings are not trimmed, case-folded or normalised.
- **Must add/change:** the complete D2 port contracts, including list/replacement and both token draws needed by the next slices, without implementing admin use cases or real adapters.
- **Governing invariant:** only successful registration or an exact-credential check creates an authentication session; validity is strictly bounded by the injected clock, and denial or invalid input never creates an account/session as an unintended side effect.
- **Sibling surfaces:** register/sign-in shared input validation and session creation; repository-owned duplicate/admin decisions; session resolution/deletion; future admin use cases, crypto adapters, Postgres adapters and route composition.
- **Seams under test:** exported use cases over fresh, stateful port doubles and a controllable clock; a throwaway public-API lifecycle smoke runs the actual application functions.
- **Required evidence — bounds:** usernames of 0/1/64/65 UTF-16 units and passwords of 0/1/256/257 units distinguish allowed endpoints from refusal. Invalid registration creates no account/session; invalid sign-in creates no session. Include astral characters so code-point counting cannot pass.
- **Required evidence — exact input:** `alice`, `Alice`, and whitespace-distinct names remain separate; leading/trailing spaces and canonically equivalent Unicode spellings are not normalised. The exact password reaches the hashing/verification contract without trimming.
- **Required evidence — registration:** a successful call returns the repository-assigned user and issued token; the stored session has that user id and expiry exactly clock time +30 days. A duplicate returns `username-taken`, preserves the existing account and creates no new session; the application never chooses `isAdmin`.
- **Required evidence — sign-in:** correct credentials issue a fresh token/session; unknown user and wrong password produce the same safe `invalid-credentials` result and no new session. Returned users and errors contain no raw password or credential hash.
- **Required evidence — resolution:** unknown/missing token returns nothing; one millisecond before expiry resolves the user, equality and afterward do not. Repeated resolution does not slide expiry or purge expired sessions.
- **Required evidence — sign-out:** missing, unknown and repeated tokens succeed; signing out one valid token makes it unresolvable while other sessions remain valid.
- **Required evidence — complete doubles:** every D2 method has a functional implementation. A lifecycle smoke verifies ordered users, replacement of a target hash and removal of only its sessions, unknown-target false/no change, and both deterministic token draws; this is not claimed as Postgres atomicity proof.
- **Required evidence — failures/ownership:** deterministic port failures do not produce a success result or silently translate to credential errors; malformed input is rejected before side effects. Boundary/type checks show no framework, SQL or crypto dependency in domain/application.
- **Required evidence — gates:** the scoped account command `pnpm test:unit src/contexts/account --coverage.include='src/contexts/account/**/*.ts'` supports red/green development; final acceptance runs unfiltered `pnpm test:unit` at ≥90% per-file coverage, preserving all existing consumer tests. `pnpm boundaries` and `pnpm test:guardrails` also pass. Runtime smoke and exact commands are recorded separately from unit totals.
- **Non-goals:** admin use cases, crypto implementations, SQL/session-hash storage, cookies/routes/UI, session purging, registration rollback across ports, timing equalisation, retries or throttling.
- **Review focus:** complete reusable port contracts; exact UTF-16 boundaries; no secret-bearing public result; clock/expiry equality; no application-level duplicate/admin race; no mock-echo or source-text evidence.

### D3. Sessions and cookies

- **Token.** 32 random bytes, base64url, set in cookie `mindsprout_session`.
  - Cookie attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, plus `Secure` when `NODE_ENV=production`.
  - The database stores `sha256(token)` hex as `token_hash`, so a database read does not yield usable cookies.
  - `expires_at` is creation time plus 30 days. Sessions are not sliding.
- **`resolveSession`.**
  - It looks up `token_hash`, filters `expires_at` strictly after the supplied `Clock` instant, and joins the user. Equality is expired; the adapter binds the supplied instant instead of choosing an independent clock.
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
  - `put` is an upsert on the caller's own key: `insert … on conflict (owner_id, id) do update`. An id that another user also holds is a different row, so `put` creates or replaces the caller's own map and never touches theirs.
  - `delete` of an absent id, or of an id only another user holds, succeeds and affects no row.
  - `get` implements the port exactly: it returns `MindMap | undefined`, and throws `UnsupportedSchemaVersionError(found, 1)` for a row with `schema_version > 1`.
  - `list` returns summaries from the generated `title` and `updated_at` columns, newer-version rows included. A row where either column is null is skipped, as M1's list skips unreadable records.
- **Body limit.** 1 MiB, checked against `Content-Length` and the bytes actually read; anything larger gets 413. A generated 500-node map is about 60 KB.

### D5. HTTP API contract

Every body is JSON. Every error body is `{ "error": "<code>" }`, except the 409 `unsupported-schema-version` body, which also carries `found`. Every map and admin route answers 401 `unauthenticated` without a valid session. Every 415 body is `{ "error": "unsupported-media-type" }`.

| Route                                            | Success                                                                 | Errors                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register` `{username,password}`  | 201 `{username,isAdmin}` + session cookie                               | 400 `invalid-input`, 409 `username-taken`, 415                                                                             |
| `POST /api/auth/login` `{username,password}`     | 200 `{username,isAdmin}` + session cookie                               | 400 `invalid-input`, 401 `invalid-credentials`, 415                                                                        |
| `POST /api/auth/logout` `{}`                     | 204, cookie cleared (also without a session)                            | 415                                                                                                                        |
| `GET /api/auth/session`                          | 200 `{username,isAdmin}`                                                | 401                                                                                                                        |
| `GET /api/maps`                                  | 200 `MapSummary[]` (contract order)                                     | 401                                                                                                                        |
| `GET /api/maps/{id}`                             | 200 `{schemaVersion,map}`                                               | 401, 404 `not-found` (absent, or held only by another user), 409 `{ "error": "unsupported-schema-version", "found": <n> }` |
| `PUT /api/maps/{id}` `{schemaVersion,map}`       | 204 (creates or replaces the caller's own map)                          | 400 `invalid-map` (parse failure, `schemaVersion !== 1`, `map.id !== {id}`), 401, 413 `too-large`, 415                     |
| `DELETE /api/maps/{id}` `{}`                     | 204 (absent id, or one held only by another user: 204, nothing deleted) | 401, 415                                                                                                                   |
| `GET /api/admin/users`                           | 200 `[{id,username,isAdmin,createdAt}]` by `created_at` asc             | 401, 403 `forbidden`                                                                                                       |
| `POST /api/admin/users/{id}/password-reset` `{}` | 200 `{temporaryPassword}`                                               | 401, 403, 404 `not-found` (unknown or non-uuid id), 415                                                                    |

- `GET /api/maps/{id}` answers 409 when the store throws `UnsupportedSchemaVersionError`; the body's `found` is the stored version.
- A bodiless non-GET call (logout, `DELETE`, password reset) sends `Content-Type: application/json` with the body `{}`, so the JSON-only rule needs no exception.
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
- **Critical Path.** Because `requireUser` is the single session check for every map and admin route, `src/app/server/` is a Critical Path from task 5.1 on. That task adds it to the `src/app/api/` row of the `AGENTS.md` Critical Paths table.
- **Shared JSON guard.** One helper, used by every non-GET handler, answers 415 before any side effect when the request is not `Content-Type: application/json` (D3).

### D7. Browser adapter and error surfacing

- **`HttpMapRepository`** in `map/infrastructure/persistence/` implements the port over same-origin `fetch`.
  - `list` → `GET /api/maps`.
  - `get` → `GET /api/maps/{id}`. A 404 returns `undefined`. A 409 `unsupported-schema-version` body throws `UnsupportedSchemaVersionError(found, 1)` with the body's `found`. A malformed 200 envelope throws a plain `Error` naming the id.
  - `put` → `PUT` with `keepalive: true` when the serialised body is at most 60,000 bytes (browser keepalive quota is 64 KiB), otherwise a normal fetch. `put` begins its request synchronously, so the `EditorSession` flush ordering still holds.
  - `delete` → `DELETE` with the JSON body `{}` (D5).
  - A 401 on any call throws the new `StorageUnauthorizedError` (`map/domain/errors.ts`). Any other non-2xx, or a network failure, throws a plain `Error`. Network errors are not "unavailable" (decision 0011).
- **Autosave** gains a third outcome. `StorageUnauthorizedError` sets the notice `SESSION_EXPIRED = '登录已过期，请在新标签页重新登录后继续编辑'` and leaves the map pending, exactly as a failed write does today.
  - The session cookie is shared across tabs, so the next edit or flush after re-signing in saves it.
  - `EditorView` shows a `重新登录` link to `/login?next=%2F` with `target="_blank"` while that notice is displayed. The new tab lands on the library, never on the editor, so a second editor of the same map is never opened and cannot overwrite the first tab's pending edits.
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
- **Header session menu** (`src/components/account/`) on `/`, `/maps/[id]` and `/admin`. It fetches `GET /api/auth/session` once per page and shows the username, a `管理后台` link for the admin and `退出登录`, which posts `{}` to logout and then navigates to `/login`. The header task mounts it on `/` and `/maps/[id]`; the admin page task mounts it on `/admin`.

### D9. Admin page

- `/admin` fetches `GET /api/admin/users`. On 403 it shows `无权访问` with a link to `/`. On 401 it calls `window.location.assign('/login?next=%2Fadmin')`, like every other page's load-time 401 (D7).
- Each row shows username, created time and an `管理员` badge, plus a `重置密码` button.
- The button asks for confirmation: `重置后该用户的所有登录将失效`. The result is shown once, in a dialog that lets the admin copy the temporary password and states that it will not be shown again.
- The reset posts `{}` (D5). A 401 from the reset does the same `window.location.assign('/login?next=%2Fadmin')`.
- Closing the dialog discards the password from component state.

### D10. Cut-over order (written exception to "no parallel implementations")

`AGENTS.md` forbids parallel implementations without a written cutover exception. This is that exception. The 400-line PR limit makes an atomic swap impossible, so:

1. **Server side first.** Database, account and API (task groups 1–5) land while the browser still uses IndexedDB. Nothing in the UI calls them yet. They are reachable only by tests and smoke, and each is referenced by its route, so knip stays green.
2. **Preparation** while the browser still uses IndexedDB:
   - the HTTP adapter and its error outcomes (tasks 6.1 and 6.2), unused by the UI until the flip;
   - e2e infrastructure (tasks 6.3–6.5): the Postgres service, the e2e database lifecycle, a signed-in fixture and the declared expected-response helper (D13). Seeding keeps its IndexedDB internals, and every spec except those that test signed-out behaviour switches to the fixture without changing assertions;
   - the native HMR probe (task 6.6) gets a database, signs in, and moves its source-seam anchors off lines the cut-over edits;
   - component tests (task 6.7) for every raw-record e2e case, green alongside those e2e cases;
   - the sign-in pages and the proxy (tasks 7.1 and 7.2).
3. **The flip** (task 6.8) swaps the provider to `HttpMapRepository`.
   - It deletes the IndexedDB adapter and its tests, because nothing uses the adapter any more (canonicality). knip treats test files as entries, so the adapter itself would not be reported. What would fail `pnpm dead-code` is `idb` and `fake-indexeddb` left unused, so the flip removes both dependencies and their lockfile entries in the same PR.
   - It switches `seedRecords` to API `PUT` and `readRecord` to API `GET` (404 → `undefined`), with unchanged call signatures, so spec bodies and assertions stay unchanged. The only exception is the tests that now receive an expected API 404, which declare it through the D13 helper.
   - It deletes the raw-record e2e cases that task 6.7 replaced, and `e2e/storage-fallback.spec.ts`.
4. **The contract step** (task 6.9) removes what the flip left referenced but dead: `StorageUnavailableError`, the banner, the `storageUnavailable` flags and `onUnavailable`. It also moves `InMemoryMapRepository` to `tests/support/` as the contract suite's in-memory double.

The only transitional state is between steps 3 and 4: a never-thrown error branch and a banner that never renders. Both are inside this change, and the step 4 issue depends on step 3.

### D11. Test database lifecycle

A reset never targets the developer's `app_dev`.

- **Target derivation.** One shared helper module, `scripts/test-database.mjs`, holds both helpers.
  - The reset helper takes a database name. It builds its owner and app-role URLs from the host and credentials of `MIGRATION_DATABASE_URL` and `DATABASE_URL`, with the database name forced to that name. It refuses, before connecting, any name other than `app_test` or `app_e2e`. A `DATABASE_URL` that still names `app_dev` therefore cannot redirect a reset.
  - Reset shares `db:setup`'s production preflight before client construction or destructive SQL.
  - Target binding includes the driver's effective startup parameters: derived URLs discard decoded/repeated `database` query overrides and preserve other connection options.
  - `withScratchDatabase(callback)` passes `{ databaseName, databaseUrl, migrationDatabaseUrl }` for a unique `app_scratch_<random>` database. Creation and cleanup use the same invocation-private name, independent of callback mutation. Cleanup also runs after callback failure and drops only the database that invocation created.
- **Integration** (`pnpm test:integration`).
  - The target database is `app_test`.
  - A Vitest `globalSetup` calls the reset helper for `app_test`. As the owner role, the helper connects to the maintenance database `postgres` and creates `app_test` if it is absent. It then drops and recreates the `public` schema, runs the migrations and applies the dev role bootstrap.
  - Test files run in parallel against `app_test`, so no test truncates or deletes from a shared table. Each test only creates fresh users. The map store tests insert them with raw SQL as the owner role, so they do not depend on `PostgresUserRepository`. The account repository tests create them through `UserRepository`. The map contract suite therefore runs against `PostgresMapStore.forUser(<new user>)` and always starts empty.
  - The first-admin tests ("First registrant is admin", "Racing first registrations") need an empty `users` table. Each creates its own scratch database through the scratch helper, migrates it, applies the bootstrap and runs as the app role there.
  - The runner tests (cloud-map-storage "Fresh database", "Re-run is a no-op", "Failing migration") also use scratch databases.
  - Role-flag and fail-closed tests live here.
  - CI sets `DATABASE_URL` and `MIGRATION_DATABASE_URL` for `app_test`.
- **e2e** (`pnpm e2e`).
  - The `e2e` script, and `verify-ui`, first run `node --env-file-if-exists=.env scripts/e2e-db.mjs`, then `playwright test`. Playwright starts its `webServer` before `globalSetup`, and the readiness probe `/api/healthz` answers 503 without a database. The database must therefore exist before Playwright starts.
  - `scripts/e2e-db.mjs` calls the reset helper for `app_e2e` (create if absent, reset, migrate, bootstrap).
  - Playwright then starts its own `next dev --port 3100`, with `DATABASE_URL` pointed at `app_e2e` (derived the same way) and `NEXT_DIST_DIR=.next-e2e`. `next.config.ts` reads `distDir` from `NEXT_DIST_DIR`, defaulting to `.next`, so the e2e server holds its own dev lock and can run beside a developer's `:3000` server. `.next-e2e/` is gitignored and ignored by knip, ESLint and Prettier.
  - `reuseExistingServer` is false, so a developer's `:3000` dev database is never touched.
  - Its `globalSetup` only registers `e2e-admin` (password from a test constant) over HTTP. It runs first on the freshly reset database, so that account is the admin.
  - Every other signed-in test registers a unique user (`u-<random>`), through the fixture unless the test drives registration itself. Specs that test signed-out behaviour use no fixture.
  - Screenshot evidence still lands in `.run/ui-evidence/`.
  - CI layer7 keeps running `pnpm e2e`. Only its environment changes.
- **Native HMR probe** (`pnpm native:browser`, CI `native-installed-runtime`). It runs `pnpm dev` on `:3000` against a database prepared by `pnpm db:setup`: a job-local one in CI, the developer's dev database locally. It registers a fresh random user over the API before visiting `/`. Because it signs in before it opens any page that calls an authenticated API, it receives no expected non-2xx response and needs no D13 declaration.
- **Smoke** (`pnpm smoke`) runs against the `:3000` server and whatever database it has.
  - It registers two random users, so it never needs to know who the admin is. The 403 assertion uses the second user, who is never the first registrant.
  - On a brand-new dev database, the first smoke user becomes the admin. `docs/engineering/database.md` therefore tells developers to register their own account before running smoke.

### D12. Copy and documentation

- **README `## Known Limitations`** (spec map-library) keeps every existing entry that is still true, such as `开发热更新`, and includes at least:
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
- TECH §3 `users`, `sessions` and `maps` are updated to the D1 shape in the PR that lands migration 0001 (task 1.2), since docs change with code.
- TECH §7 is updated to the implemented layout when the change closes.

### D13. Expected HTTP errors in browser tests

Status codes stay as D5 defines them. Several e2e walks therefore receive an expected non-2xx inside the page:

- the not-found state's `GET /api/maps/{id}` 404 (map-editor `stale link shows not-found with a link back to the library`, map-library `Delete with confirmation`, and the other-user cases of task 9.1);
- the `PUT /api/maps/{id}` 401 after signing out in another tab (task 9.1);
- the 401s a user's pages receive after an admin reset (task 8.2).

Chromium logs each as the console error `Failed to load resource: the server responded with a status of <code> (…)`, which the console-noise collectors reject.

- **Declared responses.** The shared helper `e2e/support/expected-responses.ts` lets a test declare each expected non-2xx response as a URL pattern and a status.
  - It records the page's responses through `page.on('response')`.
  - Its collector drops a `Failed to load resource` message only when the message's URL and status match a declaration that was observed as a response with that URL and status.
  - Every other console error or warning, every page error, and every failed load without a matching declaration still fails the test. A declaration that was never observed also fails it, so declarations cannot silently widen.
- There is no global console filter. A spec without declarations still rejects every console error, so the e2e evidence stays "zero unexpected console errors".
- The native HMR probe signs in before it opens any page that calls an authenticated API (D11), so it sees no expected errors.
- The signed-out-visit walk of task 7.2 opens a map its user owns (seeded before signing out), so after the flip it receives no 404 and needs no declaration; the proxy's 307 is not a failed load.
- The helper, its self-test and the testing decision record `decisions/implemented/testing/0024-declared-expected-http-errors-in-e2e.md` ship in task 6.4, before the flip (task 6.8) that first needs them.
- Alternative rejected: a global filter for `Failed to load resource`. It would also hide unexpected failed requests, which are exactly what the console assertions exist to catch.

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
  - user B cannot read or delete user A's map, and B's `put` of the same id creates B's own map without touching A's;
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
- **[AGENTS.md additions exceed instruction limits]** → Tasks adding commands or critical paths trim prose without dropping rules. Record file bytes, maximum line bytes and line count before/after; limits are 32,768 bytes, 307 bytes per line and 320 lines. `pnpm test:guardrails` does not measure these limits.

## Migration Plan

- **Development:** `cp .env.example .env`, `docker compose up -d`, then `pnpm db:setup`. No variable needs exporting: the scripts read `.env` themselves (D1). An existing dev volume needs no reset: migration 0001 creates the role and `db:setup` sets its login.
- **Existing browser-local maps are abandoned** (owner decision). There is no import path; the pre-release data is the owner's test maps only.
- **Deployment** (owner, outside this change): follow `docs/engineering/database.md`.
- **Rollback:** revert the PRs. The schema is additive. Dropping the three tables and the role restores the pre-M2 database. Browser IndexedDB data from M1 is left untouched in users' browsers, since nothing deletes it.

## Open Questions

None. Every question raised in Stage 1 was decided by the owner (decision 0023).

## Not yet specified

- **Expired-session housekeeping.** Whether and when expired `sessions` rows are purged (on sign-in, scheduled, or never at v1 scale). No requirement can be stated until there is a deployment and a row count to look at.
- **Connection pooling for the eventual hosting target.** Serverless function concurrency versus `max: 5`, and whether a pooler is needed, depends on a hosting choice that has not been made.
