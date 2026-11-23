# Design: readable-native-auth-fallback

Change surface: `CredentialsForm`, login/register pages, `src/app/native-auth/[mode]/route.ts`, `src/proxy.ts`, OpenAPI/snapshot + Hurl, native account-auth E2E, decisions 0032/0036 and README.
Must preserve: native POST and credential URL exclusion, hydrated JSON 200/201 + safe-next behavior, API form-encoded 415 before side effects, existing auth links and session handling.
Must add/change: non-API `POST /native-auth/{mode}`, 303 readable-form redirect, public namespace matcher, one native alert/link, HTTP contract/smoke, decision 0036 and patch changeset.
Governing invariant: the non-API native endpoint never reads credentials or performs account/session work; it only validates the route mode, sanitizes `next`, and redirects to a readable same-origin form.
Sibling surfaces: login and register, button and Enter, disabled/blocked JavaScript, direct JSON APIs, proxy/public-surface spec, OpenAPI + Hurl, native/hydrated errors and safe-next navigation.
Seams under test: direct route handler with spied body readers, Next proxy matcher, `CredentialsForm`, real signed-out Hurl and browser requests, and existing hydrated account-auth flows.
Required evidence: body reader spies and `bodyUsed === false`; login/register return 303, other modes 404; relative Location contains no credentials and only sanitized same-site next.
Required evidence: the `/native-auth/` namespace is public so signed-out invalid modes reach 404; child paths are public 404, while near misses such as `/native-auth-extra` remain proxy-protected. No protected content exists in the namespace.
Required evidence: native browser POST reaches `/native-auth/{mode}`, returns 303, then shows the Chinese notice/link; every request/final URL excludes generated credentials and `/api/auth/session` remains 401.
Required evidence: direct form-encoded POST to both JSON auth APIs remains 415 without a session; existing route unit tests remain unchanged.
Required evidence: `schemas/openapi.yaml` and its reviewed snapshot document the handler; signed-out Hurl proves relative 303/no Set-Cookie and invalid-mode 404. `pnpm test:contract` and `pnpm smoke` pass.
Required evidence: decision 0036 records the public non-mutating handler and partially supersedes only 0032's endpoint consequence; `pnpm decisions:check` passes.
Required evidence: `pnpm test:unit`, `pnpm test:guardrails`, `pnpm verify-ui "account-auth"`, static/boundary/docs/OpenSpec checks and required CI pass.
Non-goals: successful native form-encoded authentication, reading valid credentials, relaxing JSON-only APIs, login rate limiting, or changing session/logout behavior.
Review focus: namespace-only proxy exception and real invalid-mode outcome, no body/account import or secret publication, HTTP contract/snapshot/smoke parity, decision cross-links, and complete native + hydrated coverage.

The archived pre-hydration design's API `endpoint action` preservation is explicitly superseded for native submission by issue #242's owner decision. Its native POST, exact-input, JSON hydrated request and safe-next constraints remain authoritative. Next 16 route-handler documentation confirms POST support and that a route handler cannot share a segment with a page, hence the separate `/native-auth/[mode]` path.
