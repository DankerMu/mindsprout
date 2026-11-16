---
id: 0025
title: Use document navigation after an expired-session load
kind: architecture
status: implemented
date: 2026-11-15
---

# Use document navigation after an expired-session load

## Problem

An expired-session response during the initial library, editor or admin-list load, or an admin password-reset action, must enter login through a new document, as specified by D7 and D9. Next's `no-location-assign-relative-destination` rule recommends client routing for internal destinations, which preserves a different document and provider lifetime.

## Decision

Keep `window.location.assign('/login?next=' + encodeURIComponent(window.location.pathname))` after a current library-list or editor-get failure classified as `StorageUnauthorizedError`. Check cancellation and map identity before redirecting. The admin page uses the same fresh-document policy with one fixed-target `window.location.assign('/login?next=%2Fadmin')` helper after a live list-load401 or reset401; cancellation is checked before redirecting a discarded load, and both paths reuse that one call. Permit targeted next-line exceptions to the Next navigation rule at the three document-navigation call sites only.

A save failure during editing never navigates the current document. It retains pending edits and presents the new-tab re-login link. Notices remain explicitly dismissed under [decision 0011](0011-session-storage-failure-boundaries.md).

## Alternatives considered

- Client router navigation does not establish the specified fresh-document boundary.
- Absolute URLs, aliases or dynamically obscured strings would hide the same operation from lint without documenting the exception.
- Disabling the rule globally would permit unrelated hard navigations and discard its protection elsewhere.

## Consequences

- Load-time session expiry performs a full document request; ordinary internal navigation remains subject to the Next rule.
- Discarded loads cannot navigate, and editing-session expiry cannot discard the active canvas by redirecting it.
- An expired admin reset uses the existing admin document-navigation call; it does not add an exception or retain account data.
- The three inline exceptions must retain this decision reference. Remove them if the login contract changes to client routing or Next provides an equivalent rule-supported document-navigation mechanism.
- No active decision is superseded. [Decision 0023](0023-self-hosted-accounts-on-postgres-rls.md) continues to govern authentication and storage.
