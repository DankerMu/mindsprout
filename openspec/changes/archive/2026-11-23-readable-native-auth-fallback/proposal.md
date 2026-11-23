# Proposal: readable-native-auth-fallback

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: expanded (agree: new public HTTP handler, proxy/public-auth surface, and CSRF compatibility)
Blast radius: an unsafe fallback could read/log credentials, create a session, bypass JSON-only CSRF protection, or introduce an open redirect.
Selected risk packs: Public HTTP entry; Schema/public contract; Auth/permissions/secrets; Error handling; Legacy compatibility; Documentation.
Evidence floor: handler/proxy/component red→green unit tests, OpenAPI + Hurl contracts, guardrails, native button/Enter browser matrix, direct API 415 checks, hydrated-auth regressions and required CI.

## Why

Before hydration, native form POST currently lands on raw `415 {"error":"unsupported-media-type"}` JSON. The owner selected a readable Chinese failure page, not README-only documentation.

## What Changes

- Replace only the native form action with a public non-API handler; preserve POST and hydrated JSON fetch behavior.
- Return 303 to the same login/register form with a Chinese retry notice and return link, without reading the credential body or mutating account/session state.
- Preserve a sanitized same-site `next`; keep direct form-encoded API POSTs at 415 and document the native limitation.
