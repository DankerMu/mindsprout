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
  - Map ids are scoped per user. Another user's map is invisible: reading it answers 404 exactly like a missing map, and saving the same id creates the caller's own map without touching theirs.
  - Reading a map stored by a newer version answers 409 `unsupported-schema-version`, so the editor reports the version instead of failing to open.
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
  - The CI e2e job and the required native HMR job gain a Postgres database; the native HMR probe signs in before opening the library.
  - Playwright runs against its own reset database, prepared before its server starts, with a seeded admin and its own Next build directory.
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

## Issue #148 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree)
Blast radius: an actor check after a port operation can expose account data or alter credentials without authorization; non-atomic reset handling can leave target sessions alive or expose plaintext temporary credentials.
Selected risk packs: Public API/CLI/script entry; Auth/permissions/secrets; Schema/columns/units/field names; Concurrency/shared state/ordering; Resource limits/large input/discovery; Legacy compatibility/examples; Error handling/rollback/partial outputs; Documentation/migration notes. Config/setup, File IO/path safety and Release/packaging are not selected: this pure-application slice changes no setup, IO or dependency surface.
Evidence floor: account-focused semantic red/green then unfiltered `pnpm test:unit` at ≥90% per-file coverage, `pnpm boundaries`, `pnpm test:guardrails`, style/type/docs checks and actual-export admin lifecycle smoke; D2.2 specifies authorization order, target revocation, public-list shape and failure effects. Durable reset/issuance race contracts stay in 3.1; real DB ordering remains in 4.2.

## Issue #149 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree for credentials; real-DB evidence belongs to 4.2)
Blast radius: incorrect parameters/encoding can silently weaken password hashing or reject valid credentials; permissive parsing can amplify CPU/memory use or compare wrong bytes; weak/truncated randomness can expose account sessions and temporary passwords.
Selected risk packs: Public API/CLI/script entry; Auth/permissions/secrets; Schema/columns/units/field names; Resource limits/large input/discovery; Legacy compatibility/examples; Error handling/rollback/partial outputs; Documentation/migration notes. Config/setup, File IO/path safety, Concurrency/shared state and Release/packaging are not selected: these pure adapters introduce no setup, IO, shared state or dependency surface.
Evidence floor: genuine adapter red/green then unfiltered `pnpm test:unit` at ≥90% per-file coverage, `pnpm boundaries`, `pnpm test:guardrails`, style/type/docs/dead-code checks and actual-Node-crypto smoke. D2.3 requires an independent reference, malformed-input matrix, verify/hash failure behavior and exact token widths.

## Issue #150 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: Critical Path credential persistence and mandatory real-DB proof)
Blast radius: a weak lock permits old-password session issuance after reset; an imprecise uniqueness/error mapping can corrupt identities; raw-token storage or wrong clock conversion can expose/revoke the wrong session.
Selected risk packs: Public port; Schema/timestamps/hash; Auth/secrets; Concurrency/transactions; File IO/DB lifecycle; Resource bounds; Compatibility; Error rollback; Documentation. Config/setup, large discovery/search and packaging are not selected: no migration, new config/search or dependency change.
Evidence floor: sibling mocked unit coverage plus real-DB integration through the app role, controlled independent-connection orderings for conditional issuance/reset, and exact token/identity/expiry outcomes. Full unit ≥90% per-file, integration, boundaries, guardrails and independent real-DB lifecycle/race smoke required. D2.4 is additive; D2.1–D2.3 stay intact.

## Issue #151 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: Critical Path RLS persistence, real-DB evidence)
Blast radius: an identity leak can expose/overwrite another user's maps; a wrong upsert/version/null query can destroy or hide valid data and break existing MapRepository consumers.
Selected risk packs: Public MapRepository/ACL; Schema/JSON/timestamps/collation; Auth/RLS; File IO/DB lifecycle; Transaction/error rollback; Compatibility; Resource limits; Documentation. Config setup, general concurrency race and packaging not selected: no new config/concurrent invariant/dependency; transaction-local pool identity explicitly tested.
Evidence floor: unchanged shared contract plus real app-role RLS/scratch integration, mocked per-file coverage, executed wrong-owner/version/null/rollback counterexamples and restored full unit/integration/boundary/guardrail checks. D4.1 is additive; D2.1–D2.4 remain intact.

## Issue #146 Fixture Triage

Issue type: feature
Fixture level: compact
Upstream suggested level: compact (agree: one pure domain function, no persistence/entrypoint; design.md already exists for the shared change, no extra artifact)
Blast radius: an invalid forest accepted by the shared parser corrupts persistence; over-rejection breaks valid M1 maps and floating-root semantics.
Selected risk packs: Schema/shape/forest invariants; Public parser API; Error handling; Resource limits (500 nodes); Legacy compatibility. Auth/IO/config/concurrency/packaging/docs not selected: pure parser has no such surface and existing TECH needs no new concept.
Evidence floor: strict input/output/rejection matrix and 500-node deep-equal, full unit ≥90% per-file, boundaries and actual parser smoke. D4 compact fixture is additive; all D2.x/D4.1 stay intact.

## Issue #152 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: public HTTP/auth boundary, shared composition and constraints/AGENTS gate edits)
Blast radius: incorrect cookie parsing or fail-open session handling exposes every later map/admin route; missing env fails startup/request incorrectly; pool duplication exhausts Postgres; logging leaks bearer tokens.
Selected risk packs: Auth/session/token; Security/public HTTP; Error/logging; Configuration/pool lifecycle; API contract/schema; Gate integrity. Concurrency/performance limited to one lazy pool and malformed request handling; no business logic/AI/IO file/parser/map in this slice.
Evidence floor: unit valid/blank/forged/expired/unknown session, 401+200 bodies, requireUser, cookie attributes/clearing, lazy singleton max5 missing-env failure, internal error logging without secrets; OpenAPI snapshot, actual no-cookie hurl against live real-DB server, full unit≥90% per-file, boundaries/guardrails/style/type/docs. Expanded review and real smoke mandatory. D3/D5/D6 additive, all prior fixtures intact.

## Issue #153 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: two public credential endpoints, shared composition, secret handling, contracts/gates)
Blast radius: malformed runtime JSON can cause 500/side effects; wrong AccountError mapping leaks account state or creates sessions incorrectly; cookie/log mistakes expose bearer/password credentials.
Selected risk packs: Auth/credentials/tokens; Public HTTP/runtime input; Error/log secrecy; API contract; Session/cookie; Configuration/gate registration; Compatibility reset-race outcomes. No maps/JSON415/UI yet.
Evidence floor: behavior red/green, actual runtime JSON matrix before side effects, exact register/login status/body/cookie, 400/401/409/500 mapping, logs no secrets, real cookie-jar register→session→login plus malformed-body smoke, full unit≥90% per-file/contract/boundaries/guardrails. Preserve D2/D3/D5/D6/D11 and previous fixtures.

## Issue #154 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: public CSRF/media boundary and session deletion on Critical Path)
Blast radius: late media validation permits cross-site side effects; wrong logout token/clear ordering deletes the wrong session or leaves a usable bearer token; no-session configuration failure breaks idempotency.
Selected risk packs: Auth/session deletion; CSRF/public HTTP; Error/logging; Cookie scope; API contract/smoke/gates. No maps/admin/UI yet.
Evidence floor: behavior red/green, guard before read/use-case, form/missing/wrong media415 no side effects, valid JSON parameters, logout204 with/without/forged session, exact clear cookie dev/prod, DB failure500 no clear, live form415→session200→logout204→replayed old token401, full unit/integration/contract/gates. Preserve all D2/D3/D5/D6/D11 fixtures.

## Issue #190 Fixture Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent (expanded: required native CI/gate observability and timing boundaries; no product behavior)
Blast radius: mislabeled gates send debugging to the wrong layer; missing Document response metadata prevents server/browser attribution; any timeout/retry/warmup change could hide a real native regression.
Selected risk packs: Gate integrity; Timing/concurrency observability; Browser/network evidence; Compatibility existing five-second contracts; Resource bounds/no extra requests. No auth/map/storage behavior.
Evidence floor: deterministic red fake timeout and CDP Document events, explicit root-commit gate and response/completion metadata, unchanged 5000ms/noise/readiness, actual local native both modes, native:browser:test/guardrails/docs. Root cause may remain unknown per issue, never inferred from a later pass. Preserve all existing fixtures/D11.

## Issue #155 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: public map/RLS boundary and shared composition on Critical Path)
Blast radius: authenticating after store access or using a global store leaks map content; wrong version/absence mapping breaks forward compatibility and browser reads; second pool exhausts DB.
Selected risk packs: Auth/RLS tenant isolation; Public map API; Schema/version forward compatibility; Error/log secrecy; Composition/pool lifecycle; Contract ordering; Gates. No write/body/parser/browser yet.
Evidence floor: behavior red/green, requireUser before params/store, per-user store same pool, list contract order and newer-version tolerance via store, get200/404/409 found/500, real fresh-user empty list and absent404, full unit/integration/contract/gates. Preserve D4/D4.1/D5/D6 and all prior fixtures.

## Issue #156 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: public map writes, untrusted body streaming and RLS mutation on Critical Path)
Blast radius: checking session/media/size too late can access another user's data or consume unbounded bodies; trusting Content-Length or writing before full validation corrupts maps; wrong DELETE absence behavior leaks existence.
Selected risk packs: Auth/RLS mutation; Public API and refusal ordering; Streaming/body resource bounds; Parser/schema invariants; Error/log secrecy; Contract/smoke/gates. No browser/admin/store-schema change.
Evidence floor: behavior red/green for session→media→declared/actual size→parse→envelope→store, every refusal has no write, PUT success and DELETE absent/foreign 204, exact 1MiB boundary, full unit/integration/contract/gates and live roundtrip. Preserve D4/D5.3/D5.4/D6 and all prior fixtures.

## Issue #157 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: public admin authorization/password reset and composition on Critical Path)
Blast radius: missing actor checks expose every account or permit credential replacement; malformed ids reaching reset waste token/hash work; logging a temporary password compromises the target; a second pool or wrong error mapping breaks production composition.
Selected risk packs: Admin authorization; Credential/session revocation; Public API and UUID refusal ordering; Secret/log handling; Composition/pool lifecycle; Contract/smoke/gates. No admin UI or map changes.
Evidence floor: behavior red/green for401/403/404/415 and no admin use-case on refusal, non-UUID404 before target work, ordered public list and one-time200 temporaryPassword without logs/cookies, same-pool composition, complete contract and two-random-user403 smoke, full unit/integration/contract/gates. Preserve D2.2/D3/D5/D6 and all prior fixtures.

## Issue #158 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: persisted-state transport boundary and flush ordering; unused by UI until6.8)
Blast radius: deferred put loses the final edit during page unload; wrong keepalive threshold triggers browser rejection; misclassified401/network/malformed data causes wrong redirects or silent fallback; contract drift loses/corrupts maps.
Selected risk packs: Repository contract compatibility; Flush timing/keepalive resource limit; Error taxonomy; Envelope validation; Same-origin request safety. No UI/provider flip or API change.
Evidence floor: unchanged shared contract suite over HTTP+memory double, synchronous deferred-put proof, UTF-8 60000/60001 boundary, request shapes,404/409/malformed200, every-method401 and plain-Error failure matrix, full unit≥90 and boundaries. Preserve D5/D7/decision0011 and all prior fixtures.

## Issue #159 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: autosave/pending-edit state and load redirect across application+UI; runtime consumer waits for6.8)
Blast radius: clearing or replacing pending state loses pre/post-expiry edits; wrong error classification sends ordinary failures to login; an in-place editor navigation or stale-map401 loses the current editing context.
Selected risk packs: Pending-edit state machine; Save failure recovery; Load-time auth redirect; Editor identity compatibility; Accessible link/UI evidence. No provider flip/login implementation.
Evidence floor: fetch-double component tests prove401→pending canvas+notice/link→combined second save, repeated failure and stale204 preserve retries, successful saves leave notices until explicit dismissal,500/network recovery, exact new-tab link, current-path redirects and discarded/stale401 suppression; scoped unit coverage and existing library/editor Playwright smoke. Preserve D7/decisions0011/0016 and all prior fixtures.

## Issue #160 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: destructive test-database lifecycle, environment loading and CI/gate configuration)
Blast radius: a target or environment mismatch can reset developer data or verify the wrong server; shared output locks block coexistence; raw errors can expose credentials.
Selected risk packs: Database isolation; Environment precedence/secrecy; Shared URL derivation; Server/output ownership; CI gate integrity; Runtime evidence.
Evidence floor: target/config subprocess red→green; isolated file-only/exported-wins/each-missing-key cases with a no-server-launch sentinel; failing e2e CLI output redaction; disposable Postgres absent-target and app_dev sentinel proof; unchanged full e2e alongside dev3000; guardrails/integration/default build/static checks. Preserve D1/D11 and decisions0020/0023; only6.3a completes, not6.3b/#175.

## Issue #161 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: shared public browser-console/error filtering contract; narrow e2e-only scope and no persistence/CI change)
Blast radius: matching loosely, trusting a declaration without its observed response, or suppressing unrelated console/page errors can hide a real browser failure; an unused declaration must not silently widen acceptance.
Selected risk packs: Shared test API; URL/status error correlation; Negative error evidence; Runtime browser/response ordering. No auth/API/persistence/config/dependency change.
Evidence floor: real Chromium self-test against signed-out `/api/healthz` and `/api/auth/session` 401 covers matched, undeclared, wrong-status, truncated-path and query/fragment cases, unused declaration, unrelated console.error/warn/pageerror. Register response+console waiters before fetch and reconcile either event order with no fixed sleep. Full e2e and `pnpm decisions:check`/`pnpm dead-code` must pass. Preserve D13, existing collectors, D11.2 private credential transport and decision0020; decision0024 ships in this PR. Only6.4, no existing-spec adoption.

## Issue #163 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: required CI/gate integrity, job-local databases and authenticated shared native probe)
Blast radius: an unavailable or wrongly owned database blocks both required native legs; signing in on the wrong browser context leaves authenticated coverage unproven; changing check names, native timing/noise gates or cleanup can hide regressions.
Selected risk packs: CI/gate integrity; Database/job lifecycle; Auth/session cookie transport; Browser event ordering; Secret/evidence hygiene; Legacy native behavior/artifact compatibility; Documentation. No application/API/e2e seeding/dependency change and no #174 anchor/assertion work.
Evidence floor: sign-in helper red/green covers register→session order, exact context request/cookie proof and failure redaction; `pnpm native:browser:test`, local `source-change` and `restored-lifecycle` against a real `pnpm db:setup` database, both installed-native CI legs with unchanged check names plus the sibling Linux candidate workflow, `pnpm test:guardrails`, docs/decisions/static gates. Preserve D1/D11/D13, decisions 0020/0021/0023/0026, all existing native timeouts/noise/cleanup/artifact contracts; decision 0027 ships with this slice.

## Issue #164 Fixture Triage

Issue type: test
Fixture level: expanded
Upstream suggested level: expanded (agree for persisted-state/identity risk; PR itself is test-only and not a Critical Path)
Blast radius: deleting raw-record e2e later without equivalent component evidence can hide corrupt-record error selection, wrong-identity writes, lost autosaves or future-version mutation.
Selected risk packs: Repository identity/no-write guards; Error-state selection; Autosave/peer preservation; Test evidence and e2e coexistence. No production/e2e/dependency/CI/auth change.
Evidence floor: six existing-behavior characterization scenarios over `ControlledLibrary`, with exact no-put/no-delete/source-peer assertions through `pagehide` and unmount where relevant; focused jsdom, unfiltered `pnpm test:unit` at per-file coverage gates, and full `pnpm e2e` with raw-record cases unchanged and zero skips/console errors. Green-on-main is valid; no artificial RED or production fix. Odd versions stay excluded. Decision 0016 and existing map-library/map-persistence requirements govern; no new decision record.

## Issue #165 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: public auth entrypoints, redirect-target safety and `constraints.yaml` gate integrity; proxy itself is out of scope)
Blast radius: malformed credential transport or error mapping blocks account access; an unsafe `next` enables open redirect/XSS navigation; a false smoke/key-path entry can hide a broken login page.
Selected risk packs: Credential/session transport; Open-redirect/path safety; Error-state selection; Browser/e2e evidence; Gate integrity. No API/schema/proxy/header/dependency change.
Evidence floor: failing-first component/helper/e2e tests, then full unit coverage and build; real register→session and isolated-register→login→session Playwright walks; `/login` smoke with zero console errors/screenshot; `pnpm test:guardrails`, duplicate/dead-code and static gates. D8, account-auth requirements and decision 0023 govern; no new decision record.

## Issue #174 Fixture Triage

Issue type: test
Fixture level: expanded
Upstream suggested level: expanded (agree: required native probe seam and two runtime modes, although this PR edits scripts only and no Critical Path)
Blast radius: stale source anchors or a disappearing persistence assertion can make the required native HMR gate fail during the later cloud cut-over, or hide a real autosave failure.
Selected risk packs: Native HMR source-seam integrity; Browser/cache state compatibility; Persistence-notice evidence; Runtime and CI proof. No application/UI behavior, workflow, database-lifecycle, sign-in or documentation change.
Evidence floor: failing-first sourceStimulus tests, `pnpm native:browser:test`, no `未保存到浏览器` in `scripts/native-hmr.mjs`, local `source-change` and `restored-lifecycle` against an owned `pnpm db:setup` database with unchanged deadlines/noise/no-retry rules, then both installed-native CI legs and the `Linux x64 GNU native repair` candidate qualification required by decision 0027. Static/guardrail/docs checks. Existing development-navigation requirements and decisions 0021/0027 govern; no new decision record or changeset.

## Issue #175 Fixture Triage

Issue type: test
Fixture level: expanded
Upstream suggested level: expanded (agree: shared authenticated fixture, first-admin lifecycle and browser-context state; no src or Critical Path edit)
Blast radius: wrong setup order loses the only admin; registering in the wrong context produces false signed-in coverage or leaks cookies across users; adopting the fixture accidentally would invalidate signed-out auth/error specs.
Selected risk packs: First-account/admin lifecycle; Session cookie/context isolation; Signed-out compatibility; Secret/evidence hygiene; Full-suite proof. No production/API/e2e seeding/dependency/workflow change and no fixture adoption beyond its self-test.
Evidence floor: failing-first fixture self-test spec, then two focused tests proving fresh `u-<random>` session and `e2e-admin` session/admin flag in separate contexts, including regular-session preservation after admin authentication; full existing suite unchanged plus those two tests with zero skips/console regressions. Verify globalSetup registers only `e2e-admin` first on fresh `app_e2e`, context/request disposal and static/dead-code gates. D11, account-auth and decisions 0020/0023/0026 govern; no new decision record or changeset.

## Issue #162 Fixture Triage

Issue type: test
Fixture level: expanded
Upstream suggested level: expanded (agree: shared authenticated fixture adoption across the full browser suite, despite an imports-only diff)
Blast radius: adopting the wrong runtime test removes signed-in coverage before the proxy lands or silently invalidates signed-out authentication/error specs; assertion edits could hide regressions during the mechanical cut-over.
Selected risk packs: Authenticated browser coverage; Signed-out exclusions; Fixture/context lifecycle; Full-suite evidence; Import-only diff integrity. No production, seeding, API, dependency, workflow or persistence behavior change.
Evidence floor: enumerate every spec and change only runtime `test` imports in the14 non-excluded files; keep `account-auth.spec.ts` and `expected-responses.spec.ts` on base Playwright and `session.spec.ts` unchanged. Full real `pnpm e2e` passes127/127 with zero skipped/unexpected/flaky/errors or unexpected console errors, excluded signed-out cases stay green, and diff audit proves no assertion/test-body edits. D10/D11.5 and account-auth govern; no new decision record or changeset.

## Issue #166 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: new Critical Path gates every page and constructs a redirect target)
Blast radius: an incomplete matcher or cookie check can expose pages, break public auth/API/static routes or cause redirect loops; an unsafe return target can create an open redirect; importing account composition would put DB work on every page prefetch.
Selected risk packs: Public-route/matcher fail-closed behavior; Redirect origin/path/query safety; Session-cookie optimistic checks versus data verification; Browser redirect/session lifecycle; Critical Path instruction-gate integrity; Full-suite regression evidence.
Evidence floor: vertical RED→GREEN unit tests for307 same-origin path+query redirects, existence-only cookie pass and exact public/protected matcher boundaries; real Next build and full unit coverage; owned-map register→seed→clear-cookie→login→editor Playwright walk with no404/console errors; full e2e128/128, `pnpm test:guardrails`, AGENTS byte/line measurements, static/dead-code/duplicate checks and existing changeset. Preserve D6/D8/D13 and all existing fixtures; no new decision record.

## Impact

- **New code:**
  - `src/contexts/account/{domain,application,infrastructure,acl}`
  - `src/contexts/map/domain` (map payload parser, unauthorized storage error)
  - `src/contexts/map/infrastructure/persistence` (HTTP adapter)
  - `src/app/api/{auth,maps,admin}/**`, plus a server-only composition module in `src/app/`
  - `src/proxy.ts`
  - `/login`, `/register` and `/admin` pages, and the header session menu
  - `db/migrations/`, a migration runner in `scripts/`, and integration tests under `tests/integration/`
  - `e2e/support/expected-responses.ts`, which lets an e2e test declare the non-2xx responses it expects (design D13, decision 0024)
- **Removed code:**
  - The IndexedDB adapter and its tests
  - The in-memory fallback wiring, the storage-unavailable banner and `StorageUnavailableError`
  - `e2e/storage-fallback.spec.ts`
  - The IndexedDB seeding and reading in `e2e/support/seed.ts`, replaced by API calls with unchanged signatures
  - The raw-record e2e cases, replaced by component tests and one integration test
- **Dependencies:**
  - No new runtime dependency (`postgres` and `node:crypto` already exist).
  - `idb` and `fake-indexeddb` are removed.
- **APIs:**
  - New: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/api/maps`, `/api/maps/{id}`, `/api/admin/users`, `/api/admin/users/{id}/password-reset`.
  - Each new route gets an entry in `schemas/openapi.yaml`, a snapshot update and coverage in `smoke/api.hurl`.
- **Configuration:**
  - `.env.example`: `DATABASE_URL` now names the app role, `MIGRATION_DATABASE_URL` is new, and the Supabase variables are removed.
  - `pnpm db:setup` (migrate, then the dev role bootstrap `db/dev/app-role.sql`) prepares a local database; `docker-compose.yml` is unchanged.
  - `.github/workflows/ci.yml` changes in layer3 (migrate and app role), layer7 (Postgres service) and `native-installed-runtime` (database for the native HMR probe).
  - `playwright.config.ts` uses its own e2e database, server and `distDir`; `next.config.ts` reads `distDir` from `NEXT_DIST_DIR`.
  - `constraints.yaml` updates the key routes and adds the `verification` surface entry for DB migrations.
  - `AGENTS.md` adds the `db:*` commands, a migration verification row and the new critical paths.
  - Every edit to a gate or Critical Path above is flagged in its PR, with `pnpm test:guardrails` evidence.
- **Documents:** decision 0023 and the PRD/TECH/CONTEXT/AGENTS/README revisions already landed on this branch. This change adds the testing decision record 0024 (declared expected HTTP errors in e2e), the database and deployment procedure in `docs/engineering/database.md`, and updates README `## Known Limitations`, TECH §3 (the schema, with migration 0001) and TECH §7 as the code lands.
