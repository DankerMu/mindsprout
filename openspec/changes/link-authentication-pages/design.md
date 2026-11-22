# Design

## Context

Change surface: shared `CredentialsForm` on `/login` and `/register`, its unit test, account-auth browser coverage and spec.
Must preserve: native POST credential privacy, exact pre-/post-hydration values, pending/error behavior, JSON-only APIs and successful same-site redirect.
Must add: one opposite-mode link with the sanitized return path; no API or session side effect while following it.
Governing invariant: public-form navigation never weakens safe-next handling or submits credentials, and successful authentication still consumes the same sanitized return path.

## Goals / Non-Goals

**Goals:**

- Discoverable registration and sign-in navigation in both modes.
- Valid paths and queries survive the cross-link; unsafe paths become `/`.
- Explicit proof of session200 after protected-path registration.

**Non-goals:**

- No API, session, form-field, styling, recovery, third-party auth or safeNextPath parser change.

## Decisions

- Reuse `safeNextPath(next)` for both the existing successful-submit redirect and new opposite-mode `next/link`; do not add another sanitizer.
- Preserve the complete sanitized path/query with `encodeURIComponent`; omit `next` only when absent.
- Sibling surfaces: login and register pages, proxy-supplied next, existing successful-submit redirect, native form POST, safeNextPath and both browser directions.
- Seams under test: CredentialsForm accessible links/exact hrefs; real protected-path registration and API session; existing submit/early-input/error tests.
- Required evidence: hostile `//evil.example`, `https://evil.example` and `/\evil` all produce `/register?next=%2F`; absent next produces `/register`; both-direction navigation sends no credentials and creates no session; full `pnpm e2e` is green with zero console errors.

## Risks / Trade-offs

- Unsafe URL leaks into href → exact encoded-href tests through the one sanitizer.
- Link click treated as form submission → explicit no-request/no-session assertions in both directions.
- Existing credential behavior regresses → paired unit and full browser suites, no test weakening.
- Review focus: link ownership, URL encoding, both modes, no side effects and successful return-path/session proof.
