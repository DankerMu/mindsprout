---
id: 0025
title: Use document navigation after an expired-session load
kind: architecture
status: implemented
date: 2026-11-15
---

# Use document navigation after an expired-session load

## Problem

An expired-session response during the initial library, editor or admin-list load must enter login through a new document, as specified by D7 and D9. Next's `no-location-assign-relative-destination` rule recommends client routing for internal destinations, which preserves a different document and provider lifetime.

## Decision

Keep `window.location.assign('/login?next=' + encodeURIComponent(window.location.pathname))` after a current library-list or editor-get failure classified as `StorageUnauthorizedError`. Check cancellation and map identity before redirecting. The admin list uses the same fresh-document policy with the fixed target `window.location.assign('/login?next=%2Fadmin')` after a live401, with cancellation checked before redirecting. Permit targeted next-line exceptions to the Next navigation rule at those three document-navigation calls only.

A save failure during editing never navigates the current document. It retains pending edits and presents the new-tab re-login link. Notices remain explicitly dismissed under [decision 0011](0011-session-storage-failure-boundaries.md).

## Alternatives considered

- Client router navigation does not establish the specified fresh-document boundary.
- Absolute URLs, aliases or dynamically obscured strings would hide the same operation from lint without documenting the exception.
- Disabling the rule globally would permit unrelated hard navigations and discard its protection elsewhere.

## Consequences

- Load-time session expiry performs a full document request; ordinary internal navigation remains subject to the Next rule.
- Discarded loads cannot navigate, and editing-session expiry cannot discard the active canvas by redirecting it.
- The three inline exceptions must retain this decision reference. Remove them if the login contract changes to client routing or Next provides an equivalent rule-supported document-navigation mechanism.
- No active decision is superseded. [Decision 0023](0023-self-hosted-accounts-on-postgres-rls.md) continues to govern authentication and storage.
