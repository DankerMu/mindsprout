# Design

## Context

`CredentialsForm` serves `/login` and `/register`. Server HTML is editable before handlers attach. Local replay evidence is recorded in issue #217; it distinguishes a controlled-state overwrite from hydration node replacement.

## Goals / Non-Goals

Governing invariant: a hydrated submission sends the exact current username and password visible in the form, including values entered before hydration.

Must preserve: native `method="post"` and endpoint action, JSON content type for hydrated requests, exact whitespace/case, password masking, autocomplete names, pending-submit suppression, HTTP/network error messages, safe-next routing, and session identity.

Non-goals: authentication API changes, server validation, session/cookie/RLS changes, supporting successful native form-encoded authentication, timeout/retry/skip changes, or diagnoses #199 and #211.

## Decisions

The browser input elements own credential values. Capture their `FormData` synchronously at submission before pending/error updates; only request status belongs in React state. This removes the stale second source rather than waiting for hydration in the login helper.

Uncontrolled inputs retain early edits through hydration and status re-renders. No field value is persisted outside the form/request. Keep the existing explicit two-field JSON payload rather than serializing every form entry.

Rejected alternative: disable or wait for client-ready inputs. That bypasses the reported early-input failure and prevents users entering credentials while scripts load. Keeping controlled state with hydration reconciliation introduces another synchronization boundary.

Sibling surfaces: login and registration callers; username and password fields; normal hydrated input and pre-hydration input; button/Enter native POST fallback; pending/error render paths; API request payload and authenticated session view.

Seams under test: actual server-rendered form DOM hydrated by React for deterministic regressions, then the real Next/browser/Postgres login and registration boundaries. Existing account-auth E2E retains new-tab/legacy-session recovery coverage.

## Risks / Trade-offs

- Reading an async event target after pending state changes → capture the form values synchronously before any await.
- Browser-input ownership bypasses React onChange → no client validation depends on it; server validation and exact-field transport remain authoritative.
- A unit test rendered only after hydration misses the defect → create HTML with the real component, enter a value before hydration, hydrate, edit the other field, assert DOM retention and submission.
- Timing waits could hide the defect → do not change the existing login helper or readiness gates; use the deterministic hydration seam and an independently held-script browser replay.

## Migration Plan

No data migration or public interface change. Deploy the component change atomically; rollback is a normal revert. Document the input ownership decision and patch release note after smoke proof.
