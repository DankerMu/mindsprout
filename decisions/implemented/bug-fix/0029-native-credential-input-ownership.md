---
id: 0029
title: Native credential input ownership
kind: bug-fix
status: implemented
date: 2026-11-16
---

# Native credential input ownership

## Problem

Login and registration fields are editable before hydration. Controlled React state does not receive those early edits; editing the other field after hydration can overwrite the browser's value and submit stale credentials.

## Decision

Native inputs own credential values. At submission, synchronously capture `FormData` from `event.currentTarget` and read only `username` and `password` before pending/error state updates. Hydrated requests send the explicit two-field JSON payload without trimming or normalization. React owns request status, not credential values.

## Alternatives considered

- **Disable inputs or wait for client readiness.** This prevents useful input while scripts load instead of preserving it; a readiness wait in the login helper hides the user-facing failure.
- **Reconcile controlled state during hydration.** This retains two value owners and adds a synchronization boundary. No client validation requires controlled credential state.

## Consequences

- Hydration, other-field edits, and pending/error renders retain native field values. A refused or network-failed submission permits resubmission without re-entering credentials.
- Native submission remains POST to the existing endpoint, keeping credentials out of the URL. This does not add support for successful form-encoded authentication. Password masking, autocomplete, pending-submit suppression, error messages, and safe redirects remain unchanged.
- No active decision is superseded. [Decision 0023](../architecture/0023-self-hosted-accounts-on-postgres-rls.md) governs authentication, sessions, and RLS; [decision 0028](0028-bind-queued-map-writes-to-account.md) governs account-bound queued writes. Server validation and those contracts are unchanged.
