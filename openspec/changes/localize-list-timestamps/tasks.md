# Tasks

## 1. One formatter and both list consumers

- [x] 1.1 先写红测：固定 UTC instant 在 UTC、America/Los_Angeles、Asia/Shanghai 的硬编码跨日期结果；`MapLibrary.test.tsx`、`MapLibrary-mutations.test.tsx`、`AdminUserList.test.tsx` 可见本地化文本、原始 `dateTime` 和既有排序/操作断言。增加不可解析字符串 fallback 及混合合法/非法行的排序、兄弟行和操作回归，先确认异常失败。
- [x] 1.2 新建唯一 module-scoped `Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })` formatter，并只替换两列表 time 的可见 children；不可解析值原样返回，不改 API、排序、状态、校验或属性。运行 focused tests 转绿。

## 2. Browser and qualification evidence

- [x] 2.1 更新现有 map-library/map-editor/account-admin e2e：显式 Playwright timezone，断言本地化可见值与原始 ISO `dateTime`，重新保存列表、编辑器返回列表和管理页截图且零意外 console/page error。分别运行 `pnpm verify-ui "map-library"`、`pnpm verify-ui "map-editor"` 与 `pnpm verify-ui "account-admin"`。
- [ ] 2.2 添加 patch changeset，运行 `pnpm test:unit`、fmt/lint/typecheck/boundaries、strict OpenSpec/docs/decisions 与 required CI；确认没有第二份 formatter 或 hydration warning，archive 前最终 head 全绿。

## Risk packs

- Selected: Schema / columns / units / field names — display-only timestamp units; raw ISO attributes/API values remain unchanged under 1.1/2.1.
- Selected: Legacy compatibility / examples — raw ordering, list operations, permissions and client-only loading under 1.1/2.1/2.2.
- Selected: Documentation / migration notes — two spec deltas and patch changeset.
- Not selected: Public API / CLI / script entry — no API or command changes.
- Not selected: Config / project setup — no dependencies, settings or user timezone configuration.
- Not selected: File IO / path safety / overwrite — no filesystem behavior.
- Not selected: Auth / permissions / secrets — existing permissions and account data are unchanged.
- Not selected: Concurrency / shared state / ordering — no new state or concurrent work; existing raw ordering only.
- Not selected: Resource limits / large input / discovery — one formatter instance reused; no loops beyond existing rows.
- Selected: Error handling / rollback / partial outputs - unparseable timestamps accepted by existing contracts must fall back to the original string without losing sibling rows or actions (1.1/1.2).
- Not selected: Release / packaging / dependency compatibility — no dependency or package changes.
