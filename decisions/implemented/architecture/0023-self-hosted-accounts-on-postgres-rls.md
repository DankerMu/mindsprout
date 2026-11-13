---
id: 0023
title: Self-hosted username/password accounts on Postgres RLS, login required
kind: architecture
status: implemented
date: 2026-11-13
---

# Self-hosted username/password accounts on Postgres RLS, login required

## Problem

M2 (账号与云存储) was planned on Supabase Auth + Supabase Postgres + Drizzle (`docs/TECH.md` 0.1). The local and CI databases are plain `postgres:16`. They have no `auth` schema, no `auth.uid()` and no GoTrue, so RLS policies written against Supabase cannot run in the integration tests, which must hit a real database and never self-skip. The owner asked for lightweight authentication: username + password, with no email, OAuth or anonymous trial. The browser-only IndexedDB storage from M1 then has no user left to serve.

## Decision

- **Accounts are self-hosted in the `account` context.** Users register and sign in with a username and password.
  - Passwords are stored as a scrypt hash from `node:crypto`; no new dependency is added.
  - Sessions are server-side rows, referenced by an httpOnly cookie and valid for 30 days.
  - Signing out deletes the session row.
  - Registration is open and self-service.
- **Isolation stays in the database.** Postgres RLS on `maps` is `owner_id = current_setting('app.user_id')`.
  - Each request sets the user inside its transaction with `set_config(..., true)`.
  - The application connects as a role that does not own the tables and has no `BYPASSRLS`.
  - Migrations run under a separate owner role.
- **Persistence uses the existing `postgres` package and numbered SQL migrations** applied by a small runner. Drizzle is not adopted.
- **Login is required for every page and API route** except the sign-in and registration pages, `/api/auth/*` and `/api/healthz`. `src/proxy.ts` only redirects optimistically to `/login?next=`; every route handler verifies the session itself.
- **An admin panel lists users and resets a password.**
  - A reset sets a temporary password and deletes all of that user's sessions.
  - The first user to register on an empty database becomes the only admin, and the database guarantees there is never more than one.
  - Admins stay bound by RLS and cannot read anyone's maps.
- **The M1 IndexedDB repository, the in-memory fallback and the "未保存到浏览器" banner are removed.** No legacy local data is imported. The `MapRepository` port and its contract suite stay; the browser now saves through `/api/maps`.
- The stored `schemaVersion` stays 1. `owner_id` is a server column, not part of the `MindMap` payload, so the bump to 2 announced in M1 is withdrawn.

## Alternatives considered

- **Supabase local stack (`supabase start`) in development and CI.** It gives real GoTrue and `auth.uid()`, but makes every local run and CI job heavier and adds a CLI to the toolchain. Its value lies mostly in email and OAuth flows, which the owner deferred.
- **Stub `auth` schema on plain Postgres.** It emulates `auth.uid()` from JWT claims and drifts semantically from the hosted service it imitates. It still needs real Supabase for the login flow itself.
- **supabase-js / PostgREST with the user's JWT.** RLS comes for free, but it is tied to Supabase hosting and drops the typed query layer for no M2 gain.
- **Application-level `where owner_id = ...` only.** It is the simplest, but one forgotten predicate leaks another user's maps. CONTEXT.md requires isolation at the database.
- **Drizzle ORM and drizzle-kit.** M2 has three tables, so the ORM adds two dependencies and a knip entry. No M2 scenario fails without it.
- **Anonymous trial with migration on login (PRD 0.1 story 7).** It needs a mid-session repository switch, which decision 0011 rules out, plus an upload and merge path. The owner chose login-required.
- **Edit lock or revision check for maps open on two devices.** The owner chose last-write-wins with a documented limitation.

## Consequences

- PRD story 7 and the account row, TECH §1/§2/§3/§8/§9, CONTEXT.md (map and account rows, RLS invariant), AGENTS.md (stack row, note 4) and README are revised in the same change.
- Deferred work and the trigger that reopens each item:
  - OAuth and email login: before the M6 public launch.
  - Login throttling: before the first public deployment.
  - Changing your own password: the first public deployment or a user request. Until then a temporary password set by an admin stays valid indefinitely.
  - Concurrent-edit protection: user reports of overwritten edits.
  - Timed save retry: user reports of edits lost on a weak network.
  - Drizzle: schema or query complexity growing past a handful of tables.
- A forgotten admin password has no recovery path: there is one admin, no password change and no recovery tool. The owner accepted this as a known limitation, to be reassessed with password change at the first public deployment.
- On a new public deployment, whoever registers first becomes admin. The deployment procedure tells the owner to register immediately after deploy; reassess this at the first public deployment.
- Decision 0011 is partially superseded. Its IndexedDB-to-memory fallback goes away. Its once-per-session repository choice and its explicitly dismissed notices stay.
- Decisions 0002 to 0005 are unaffected.
