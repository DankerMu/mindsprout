# Tasks

## Risk packs

- Public API / CLI / script entry: not selected; no HTTP route or contract change.
- Config / project setup: not selected; no dependency or configuration change.
- File IO / path safety / overwrite: not selected; fixed same-origin `/` link, no path handling.
- Schema / columns / units / field names: not selected; no data shape change.
- Auth / permissions / secrets: selected; the refused (`无权访问`) state must still show no account data and the admin API must still answer 403 → the new non-admin e2e in 1.2 asserts both (`GET /api/admin/users` → 403 via the page's own request, no account rows) besides the single-link check; `smoke/api.hurl` keeps its existing non-admin 403 entry and `pnpm smoke` runs in 2.1.
- Concurrency / shared state / ordering: not selected, explicit non-goal; leaving `/admin` through the new link while a reset is pending or the one-time temporary-password dialog is open drops that UI exactly as browser Back or closing the tab already does today; recovery is resetting again. The link adds no new state or ordering.
- Resource limits / large input / discovery: not selected; one constant link.
- Error handling / rollback / partial outputs: selected; the list-read error state (`无法读取用户列表`) must gain an exit → e2e in 1.2 stubs `GET /api/admin/users` with 500 (declared per decision 0024) and asserts the alert plus exactly one `/` link.
- Legacy compatibility / examples: selected; `e2e/smoke.spec.ts` /admin assertions (`管理后台` link → `/admin`, 用户列表 visible, zero console errors) and existing `AdminUserList` tests stay green unweakened.
- Release / packaging / dependency compatibility: not selected; no package change.
- Documentation / migration notes: selected; account-admin spec delta and a patch changeset.

## 1. Admin page navigation

- [x] 1.1 `AdminUserList`: remove the forbidden-branch `返回首页` link, keeping the `无权访问` text; update/add paired unit coverage asserting the forbidden state renders `无权访问` and no link to `/`; per-file coverage stays ≥ 90%.
- [x] 1.2 `src/app/admin/page.tsx`: add inline `<Link href="/">返回导图列表</Link>` at page level next to the `管理后台` heading. Browser coverage in `e2e/account-admin.spec.ts`:
  - ready: seed one map for `e2e-admin` with `seedRecords(adminPage, …)`; open `/admin` directly (no history); move focus to 返回导图列表 by Tab and press Enter → URL is `/`, `app-ready` visible, the seeded map's title listed; before navigating, the ready page has exactly one link with `href="/"`;
  - loading: hold `GET /api/admin/users` unresolved with `page.route` → `正在读取用户列表` visible and exactly one `/` link named 返回导图列表;
  - refusal: the default non-admin `page` opens `/admin`, declaring `collectExpectedResponses(page, [{ url: '/api/admin/users', status: 403 }])` → the observed response is 403, `无权访问` visible, no account rows (`用户列表` absent), exactly one `/` link named 返回导图列表;
  - read error: admin with `GET /api/admin/users` fulfilled as 500 and declared per decision 0024 → alert `无法读取用户列表`, exactly one `/` link;
  - screenshot to `.run/ui-evidence/`, zero undeclared console errors in every case.
  - Non-goal: session-expired (401) state, which redirects to `/login` before the link matters.

## 2. Delivery evidence

- [x] 2.1 Patch changeset; verify `pnpm test:unit`, `pnpm e2e`, `pnpm smoke`, `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm docs:check`, `openspec validate link-admin-to-library --strict --no-interactive`. New-behavior tests must be shown red before the source change and green after.
