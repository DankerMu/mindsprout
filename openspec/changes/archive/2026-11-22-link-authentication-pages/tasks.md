# Tasks

## Risk packs

- Public API / CLI / script entry: not selected; no endpoint or CLI change.
- Config / project setup: not selected; no dependency or configuration change.
- File IO / path safety / overwrite: selected; hostile next values must produce exact safe hrefs through the one sanitizer.
- Schema / columns / units / field names: not selected; no data-format change.
- Auth / permissions / secrets: selected; sanitize next before constructing public navigation and prove no foreign target or credential leak.
- Concurrency / shared state / ordering: not selected; link rendering is synchronous and stateless.
- Resource limits / large input / discovery: not selected; existing safe-next handling remains the only parser.
- Legacy compatibility / examples: selected; existing exact credential submission, early input, error and successful redirect behavior stays unchanged.
- Error handling / rollback / partial outputs: not selected; no new side effect or failure publication.
- Release / packaging / dependency compatibility: not selected; no package changes.
- Documentation / migration notes: selected; account-auth delta and user-visible patch changeset ship together.

## 1. Cross-link behavior

- [x] 1.1 Add component cases for both directions, no next, valid next with query, and all listed hostile values; implement through the existing safeNextPath seam and verify focused unit coverage.
- [x] 1.2 Add the protected-path → sign-in → 注册 → registration → original-path browser flow, explicitly assert `GET /api/auth/session` returns 200, add both-direction navigation assertions proving no credential submission and no session creation, and verify existing credential submission/error/early-input tests remain unchanged and green.

## 2. Delivery evidence

- [x] 2.1 Add the required patch changeset and verify `pnpm test:unit`, full `pnpm e2e` with zero console errors, `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm docs:check`, and strict OpenSpec validation.
