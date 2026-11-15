---
id: 0026
title: Isolate the e2e database and development server
kind: testing
status: implemented
date: 2026-11-15
---

# Isolate the e2e database and development server

## Problem

E2e must reset its test database without affecting a developer's maps. Reusing the development server would retain its database environment, and two Next development servers sharing one output directory contend for the same lock.

## Decision

The e2e entrypoints prepare `app_e2e` before Playwright starts its server. Reset and server configuration share the database-target derivation in `scripts/test-database.mjs`; both URLs retain their host/credentials but bind to the test database and discard database query overrides. Existing reset allowlists and production refusal remain authoritative.

Playwright owns port3100 with `reuseExistingServer: false` and `NEXT_DIST_DIR=.next-e2e`. Its fixed server launcher derives both URLs and supplies them directly to the Next child environment, not serializable `webServer.env` or command text. Native stdout and file reporters therefore cannot expose database credentials. Next defaults to `.next` outside the output override. Ignore exactly the generated `.next-e2e` tree in Git, ESLint, Prettier and knip; project source and gate thresholds remain covered.

The preparation script and Playwright each load environment independently using Node built-ins. Exported values win over `.env`; missing database keys fail before connection or server startup. Preparation is silent on success so stdout remains available to native Playwright reporters; fixed failure diagnostics go to stderr without URL values or raw database errors.

Knip evaluates the Playwright configuration during static discovery. The `dead-code` command supplies explicit credential-free database URLs on the reserved `.invalid` domain for that process only. Configuration derives targets without connecting; analysis needs no database. Keep the Playwright plugin enabled and runtime validation unconditional.

## Alternatives considered

- Reusing port3000 can direct tests at a developer's database and couples test results to an unrelated server.
- Resetting from Playwright globalSetup is too late: webServer startup precedes globalSetup.
- Copying URL derivation into Playwright can diverge from reset handling of driver query overrides.
- Sharing `.next` prevents independent development-server locks; broad generated-directory ignores would also hide unrelated project files.
- Disabling Knip's Playwright plugin loses configuration-driven discovery; adding runtime URL fallbacks hides missing deployment configuration.
- Putting credential-bearing URLs in `webServer.env` leaks them through Playwright's native JSON serialization; rewriting reports would fork the external evidence contract instead of fixing credential transport.

## Consequences

- E2e requires Postgres and both database URL keys; it can run beside the ordinary development server without sharing its database or build output.
- One local e2e lifecycle owns `app_e2e` and port3100. Do not run competing test-database resets in the same environment.
- Signed-in fixtures and API seeding are separate changes; this lifecycle preserves the existing IndexedDB specs.
- Rollback reverts the preparation, server configuration and CI service together.
- No active decision is superseded. [Decision0020](0020-native-e2e-runtime-results.md) continues to govern runtime reports and zero-skipped-test evidence; [decision0023](../architecture/0023-self-hosted-accounts-on-postgres-rls.md) governs account persistence.
