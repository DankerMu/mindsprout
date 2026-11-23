---
id: 0036
title: Readable non-mutating native auth fallback
kind: bug-fix
status: implemented
date: 2026-11-23
---

# Readable non-mutating native auth fallback

## Problem

Before hydration, login and registration native POSTs landed on the JSON API's raw 415 response. Native authentication must remain unsupported and the JSON-only API is a CSRF boundary, but the owner requires a readable Chinese failure form instead of raw JSON or README-only documentation.

## Decision

Native forms POST to a public non-API `/native-auth/{login|register}` route handler. The handler never reads the body or invokes account/session services; it validates the mode, applies the existing `safeNextPath` sanitizer, and returns a relative 303 Location to the same form with a Chinese retry notice and return link. Other modes and child paths return 404.

The proxy exempts only the `/native-auth/` namespace so signed-out invalid modes can reach the same 404 contract. Near misses outside that namespace remain protected. OpenAPI, its snapshot and signed-out Hurl smoke document and verify relative 303/no Set-Cookie and invalid-mode 404. Direct form-encoded API POSTs remain 415 before side effects; hydrated JSON authentication and safe-next behavior are unchanged.

## Alternatives considered

- **Redirect form-encoded API requests with 303.** Rejected: it weakens the explicit JSON-only/CSRF contract and couples a readable UI fallback to the authentication mutation endpoint.
- **Document the raw 415 limitation only.** Rejected by the owner: slow or disabled JavaScript users would still receive an unreadable dead end.
- **Handle POST on the existing page route.** Rejected: Next 16 does not permit `route.ts` and `page.tsx` at the same segment, and reading form credentials would add an unnecessary second authentication path.
- **Exempt only the two valid proxy paths.** Rejected: signed-out invalid modes would redirect to login instead of reaching the published 404 contract, creating different isolated-handler and real-HTTP behavior.

## Consequences

- Native submission remains POST and credentials stay out of every URL, but no native account/session success is introduced. The handler is stateless and does not consume arbitrarily large credential bodies.
- [Decision 0032](0032-native-credential-input-ownership.md) is partially superseded only where it preserved the old native endpoint. Its browser input ownership, exact two-field hydrated JSON payload and safe-next decisions remain active and are cross-linked.
- The public namespace contains only redirects and 404 responses, never protected data. Any future mutation there requires a new security review and CSRF decision.
- OpenAPI/snapshot, Hurl, proxy matcher, route/component unit tests and the native browser matrix are required contract surfaces; changes must update them atomically.
