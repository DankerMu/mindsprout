---
id: 0027
title: Signed-in native HMR probes with job-local Postgres
kind: testing
status: implemented
date: 2026-11-15
---

# Signed-in native HMR probes with job-local Postgres

## Problem

Native HMR qualification must exercise an authenticated browser without admitting expected authorization failures into its strict console gate. Registration and server-side sessions need a real database on both supported platforms, but GitHub Actions service containers are Linux-only. Database setup and sign-in must ship together without duplicating or weakening installed-native qualification.

## Decision

Use two independent jobs in `.github/workflows/ci.yml`:

- `native-installed-runtime` runs on `ubuntu-24.04`, with public check name `Installed native HMR (linux-x64-gnu)` and a healthy `postgres:16` service container.
- `native-installed-runtime-darwin` runs on `macos-26`, with public check name `Installed native HMR (darwin-arm64)`. Resolve the Homebrew `postgresql@16` keg explicitly, initialize an owned cluster under `$RUNNER_TEMP/native-postgres`, start it with `pg_ctl`, create `app_native`, and prove readiness before qualification. Remove only the owned temporary password file after initialization; an always-run step stops the owned cluster even when qualification fails. No global Homebrew service is used.

Both jobs own a fresh `app_native` database on `127.0.0.1:5432`. The migration connection uses owner `app`; the runtime connection uses non-owner `mindsprout_app`. Fixed CI passwords are non-production fixtures. The shared composite action at `.github/actions/native-installed-runtime/action.yml` runs frozen installation, `pnpm db:setup`, installed-addon verification, frozen integrity regression, Chromium installation, native unit tests, both browser modes, production build and always-upload evidence. Checkout remains in each caller. `All checks passed` requires both job IDs and retains every other dependency and its fail-closed treatment of failures, cancellations and skips. There is no cross-platform fail-fast cancellation.

The `linux-native` job in `.github/workflows/native-hmr.yml` consumes the same signed-in probe, so it also owns a Postgres16 service with the same `app_native` URLs and runs `pnpm db:setup` immediately after its frozen `--ignore-scripts` bootstrap. Its candidate-only build/tests, 180-minute budget, triggers, artifact identities and `NEXT_TEST_NATIVE_DIR` remain unchanged. It does not use the installed-only composite action or add a macOS candidate leg.

After the browser context receives its existing 5000ms defaults and before its first page, one support helper POSTs a fresh `native-<UUID>` username and test-only password to `/api/auth/register` using that context's request client. It requires status201, then GETs `/api/auth/session` through the same context and requires status200 with the exact registered username. This proves the HttpOnly cookie jar before public map creation. Only the public username is returned; refusal diagnostics are fixed and contain no response bodies, headers, cookies, tokens or passwords. The session survives the existing server restarts without re-registration.

No expected non-2xx page response or D13 declaration is needed. Keep every timing, readiness, console-noise, health-request, reload, source/cache ownership and cleanup contract unchanged. Do not add retries, warmup requests, extra page navigation, database resets or reporter rewriting. Preserve action pins, native addon and frozen-install checks, artifact names/paths, 14-day retention and always-upload behavior. Local prerequisites and commands live in the [native HMR guide](../../../docs/engineering/native-hmr.md).

## Alternatives considered

- **One mixed-platform matrix with services:** GitHub service containers cannot run on macOS; a conditional matrix entry does not make a job-level service portable.
- **Duplicate the complete qualification jobs:** allows browser, integrity, build and artifact gates to drift. Separate database lifecycles with one shared action keep one gate implementation.
- **Unsigned probes or global console filters:** miss authenticated behavior or hide real authorization failures instead of establishing a session before page creation.
- **A shared developer database or destructive test reset:** couples qualification to unrelated data and risks modifying it. Each CI job can own a disposable database without extending reset allowlists.
- **A global Homebrew service:** obscures cluster ownership and cleanup. Explicit `initdb` and `pg_ctl` bind startup and shutdown to the same job-owned directory.
- **Prepare only the installed jobs:** leaves the candidate workflow's direct calls to the same signed-in helper without a database. Database prerequisites belong to every probe caller; candidate qualification still uses its distinct build and package checks.

## Consequences

- Real cookie/database behavior still requires both local native modes, both installed CI platforms and the Linux candidate workflow; request-double tests establish helper ordering and refusal semantics, not browser acceptance. Candidate success is required evidence for shared-probe changes, not a new aggregate dependency.
- Native probes require Postgres 16, both database URLs and `pnpm db:setup`. Test users remain in the owned database for its lifetime; the probe never deletes shared data.
- No active decision is superseded. [Decision0021](../bug-fix/0021-native-hmr-registration-maintenance.md)'s two-platform qualification matrix is realized by these independent jobs and one composite action; its maintenance, no-bypass and rollback obligations remain. [Decision0020](0020-native-e2e-runtime-results.md) still governs native E2E reports, [decision0023](../architecture/0023-self-hosted-accounts-on-postgres-rls.md) owns account/RLS persistence, and [decision0026](0026-isolated-e2e-database-and-server.md) owns the separate e2e database/server lifecycle. Native qualification neither adopts that reset mechanism nor changes its ports or output ownership.
- Rollback reverts sign-in, installed and candidate job-local database lifecycles, shared-action extraction and aggregate dependency changes together, restoring the two-platform installed qualification topology. Do not drop a developer database, change published native bytes, suppress console errors or bypass required checks to make rollback pass. A login-required application needs equivalent authenticated qualification before that rollback can be accepted.
- [Decision 0038](0038-delete-darwin-native-ci-leg.md) partially supersedes only the `native-installed-runtime-darwin` job bullet, "`All checks passed` requires both job IDs" and "both installed CI platforms": `native-installed-runtime` is the only installed CI job and `All checks passed` requires it; macOS runs both modes locally against an owned Postgres 16 database.
