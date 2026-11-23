# Tasks

## 1. Non-mutating native endpoint and readable form

- [x] 1.1 先写红测：route 对 login/register 返回相对 303 Location，非法 mode 404，body reader/`bodyUsed` 不触发且 secret 不入 Location；proxy 放行 native namespace 的 invalid/child 404、近邻仍 307；CredentialsForm action/单 alert/返回链接和安全 next 符合约束。同步 OpenAPI/snapshot，并添加 signed-out Hurl 303/no Set-Cookie/invalid 404。
- [x] 1.2 实现独立 `native-auth/[mode]` route（不 import account services、不读 body）、proxy matcher、页面 searchParams 与共享 CredentialsForm action；保持 JSON API 文件不变。运行 focused unit、`pnpm test:contract` 与 signed-out `pnpm smoke` 红→绿，随 PR 保留 decision 0036 与 0032 部分 supersession 回链。

## 2. Browser and qualification evidence

- [x] 2.1 更新 native e2e helper：login/register × button/Enter 及 blocked-script 覆盖 POST/303/中文页面/返回链接/所有 URL 无凭据/session 401，保存截图；另直接验证两个 API form POST 仍 415，并验证 signed-out invalid/child 404、近邻 307。运行 `pnpm verify-ui "account-auth"`，保留 hydrated 200/201 与 safe-next 证据和零意外 console。
- [x] 2.2 更新 README Known Limitations 与 patch changeset，运行 `pnpm test:unit`、`pnpm test:guardrails`、fmt/lint/typecheck/boundaries、strict OpenSpec/docs/decisions 与 required CI；archive 前确认最终 head 全绿。

## Risk packs

- Selected: Public API / CLI / script entry — new non-API HTTP route, relative redirect and invalid-mode tests under 1.1/2.1.
- Selected: Auth / permissions / secrets — proxy public surface, no body/account work, credential-free URLs and 401/415 proof under 1.1/2.1.
- Selected: Error handling / rollback / partial outputs — native failure is readable and non-mutating; no partial account/session output.
- Selected: Legacy compatibility / examples — hydrated JSON, safe-next, API 415 and existing auth tests under 1.1/2.1/2.2.
- Selected: Documentation / migration notes — account-auth delta, README limitation and changeset.
- Not selected: Config / project setup — no dependencies or configuration values; only the existing proxy matcher is extended.
- Not selected: Concurrency / shared state / ordering — the new handler is stateless and does not mutate shared state.
- Not selected: File IO / path safety / overwrite — no filesystem access.
- Selected: Schema / columns / units / field names — no persistence change; public OpenAPI route/request/redirect contract and byte-identical snapshot under 1.1/1.2.
- Not selected: Resource limits / large input / discovery — the body is never consumed; no loops or discovery.
- Not selected: Release / packaging / dependency compatibility — no dependency or package changes.
