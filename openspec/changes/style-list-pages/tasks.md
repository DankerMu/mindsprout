# Tasks

## 1. Shared presentation and semantic preservation

- [x] 1.1 先扩展现有 map-library/account-admin 浏览器断言：两个列表 `list-style-type: none`、行 flex 布局和共享按钮 border/radius；保留同名行内目标、取消/焦点、持久化和 reset 断言。运行 focused e2e 确认默认样式红。
- [x] 1.2 新建唯一 `src/components/list-page.module.css`，仅给 home/admin 两处 `<main>` 添加共享 class；覆盖列表、行、时间、按钮、输入和行内 form/dialog，不修改状态、语义、API 或其他路由。运行 focused e2e 转绿。

## 2. Visual and qualification evidence

- [x] 2.1 运行 `pnpm verify-ui "map-library"` 与 `pnpm verify-ui "account-admin"`，检查列表、同名 rename/delete 和 admin 截图，确认控件/时间清晰、行内目标明确、零意外 console/page error。
- [ ] 2.2 添加 patch changeset，运行 `pnpm test:unit`、fmt/lint/typecheck/boundaries、strict OpenSpec/docs/decisions 与 required CI；确认没有全局样式泄漏或第二份列表样式，archive 前最终 head 全绿。

## Risk packs

- Selected: Legacy compatibility / examples - existing roles, accessible names, inline identity, focus/cancel/persistence/reset behavior under 1.1/2.1.
- Selected: Documentation / migration notes - two spec deltas and patch changeset under 2.2.
- Not selected: Public API / CLI / script entry - no API or command changes.
- Not selected: Config / project setup - no dependencies or configuration changes.
- Not selected: File IO / path safety / overwrite - no filesystem behavior.
- Not selected: Auth / permissions / secrets - no permission or credential behavior changes.
- Not selected: Concurrency / shared state / ordering - no runtime state or ordering changes.
- Not selected: Resource limits / large input / discovery - bounded existing lists only.
- Not selected: Error handling / rollback / partial outputs - existing status/error UI is styled, not changed.
- Not selected: Release / packaging / dependency compatibility - no dependency or package changes.
- Not selected: Schema / columns / units / field names - no data or timestamp value changes.
