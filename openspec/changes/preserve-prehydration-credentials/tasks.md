# Tasks

## 1. Preserve native credential values

- [x] 1.1 Add deterministic SSR-to-hydration regressions in the existing CredentialsForm tests for both modes and both early-input fields; observe the stale-state overwrite before the source fix.
- [x] 1.2 Remove controlled credential state and synchronously submit native field values; verify existing pending/error/redirect contracts and explicit source-file coverage with `pnpm test:unit src/components/account/CredentialsForm.test.tsx --coverage.include=src/components/account/CredentialsForm.tsx`.
- [x] 1.3 Verify real held-script login and registration with exact JSON payload, matching session username, screenshots, and zero unexpected browser noise; include the new-tab login surface without changing the existing helper.
- [x] 1.4 Record the input-ownership decision and user-visible patch changeset after smoke proof; verify `pnpm decisions:check` and scoped formatting.

## 2. Verify integration and deliver

- [x] 2.1 Run existing `pnpm e2e e2e/account-auth.spec.ts`, preserving native POST/415, redirect, HTTP/noise, session, and new-tab recovery assertions; run typecheck and scoped lint.
- [ ] 2.2 Complete risk-scaled cross-review and current-head required CI; merge and archive this change only with green gates.

## Risk packs

Selected:

- Auth / permissions / secrets: tasks 1.2, 1.3, 2.1; exact two-field JSON, masked password, POST fallback, existing session assertions.
- Concurrency / shared state / ordering: tasks 1.1–1.3; hydration then another input event must not overwrite early input, submit captures values synchronously.
- Legacy compatibility / examples: task 2.1; existing no-JS/native POST, safe redirect, and legacy-session/new-tab E2E are unchanged.
- Error handling / rollback / partial outputs: task 1.2; existing failure/pending tests plus field retention across error render; no new retry.
- Documentation / migration notes: task 1.4; no data migration.

Not selected:

- Public API / CLI / script entry: no API, CLI, or script contract changes; existing auth API assertions are preservation checks.
- Config / project setup: no environment or configuration change.
- File IO / path safety / overwrite: no application file IO.
- Schema / columns / units / field names: no schema or request field changes.
- Resource limits / large input / discovery: no limit changes; server validation remains authoritative.
- Release / packaging / dependency compatibility: patch metadata only; no dependency or packaging behavior changes.
