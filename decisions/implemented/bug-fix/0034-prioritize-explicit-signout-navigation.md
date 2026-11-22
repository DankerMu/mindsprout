---
id: 0034
title: Prioritize explicit sign-out over stale expiry navigation
kind: bug-fix
status: implemented
date: 2026-11-22
---

# Prioritize explicit sign-out over stale expiry navigation

## Problem

A successful explicit logout starts a fresh-document navigation to `/login`, but requests created by the outgoing protected page can settle afterwards. Their 401 handlers can replace that destination with `/login?next=<protected-path>`. A competing App Router transition can likewise commit another protected route before the login document replaces it. Treating either late response as a new session-expiry event can return the user to the page they explicitly left.

A boolean sign-out flag is insufficient: public authentication and a later protected route must be able to start a new authenticated lifecycle, while callbacks captured by the old lifecycle must remain inactive.

## Decision

Give each browser document one session-navigation lifecycle with `active`, `signing-out`, and `public-auth` phases plus a monotonically increasing epoch.

- A successful logout increments the epoch and enters `signing-out` before replacing the document with exact `/login`. A failed logout does not change the lifecycle.
- Library, editor-get, admin-list, and admin-reset expiry handlers may navigate only when their captured epoch is current and the phase is `active`. They capture through the shared session-navigation context rather than creating independent flags.
- Mounting public login or registration enters `public-auth`; successful authentication resumes `active` with a new epoch. Public-auth mounting alone does not reactivate old protected callbacks.
- If a protected route commits while `signing-out`, the shared provider reissues `window.location.replace('/login')`. A normal transition from public auth to a protected route resumes the authenticated lifecycle instead.
- Genuine expiry still uses fresh-document `/login?next=<current-path>` navigation. Editing-save failures retain pending edits and the existing new-tab re-login behavior; this decision does not add a save-time redirect.

## Alternatives considered

- **One module boolean without phases or epochs.** It cannot distinguish an outgoing sign-out from a later authenticated lifecycle and either suppresses genuine expiry or reactivates stale callbacks after remounts.
- **Independent flags in each consumer.** Library and admin would duplicate transition rules, while route interruptions outside those components could still replace the login destination.
- **Ignore every 401 after logout or cancel all protected requests.** This conflates explicit sign-out with genuine expiry and cannot prove that every already-scheduled callback or navigation is cancelled.
- **Client-router login navigation.** It does not establish the fresh-document boundary required for sign-out and leaves the outgoing provider lifetime available to stale work.

## Consequences

- Explicit sign-out has precedence only over callbacks and route transitions belonging to its outgoing document lifecycle. It does not weaken server authentication, account binding, or genuine expiry handling.
- The lifecycle is document-global while repository access remains account-keyed under [decision 0028](0028-bind-queued-map-writes-to-account.md). Test wrappers that construct the real provider must use its session-navigation scope.
- [Decision 0025](../architecture/0025-expired-session-document-navigation.md) continues to govern genuine load/reset expiry. No active decision is superseded; this record defines the explicit-sign-out exception to applying that policy to stale 401 callbacks.
- Regression evidence must cover delayed 401 responses, public-auth resume, same-path and provider remounts, and a protected route interrupting login navigation, as well as genuine library/admin expiry.
- Rollback removes the shared lifecycle and consumer guards together. A partial rollback can reopen the redirect race or suppress genuine expiry.
