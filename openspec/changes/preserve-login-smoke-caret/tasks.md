# Tasks

## 1. Deterministic hydration-held caret proof

- [x] 1.1 抽取 M2 现有 Scheduler hold/wait/release 为唯一 E2E helper，保持原回归语义；在 `/login` smoke 安装只读 caret MutationObserver，在 SSR 可见且 `data-hydrated` 缺失时截图并断言无 caret 写入，先让默认截图以 transparent 证据失败。
- [x] 1.2 仅给 `/login` smoke 截图添加 `caret: 'initial'`，保留 login.png 和严格 console/page-error 断言；释放 hydration 并确认 mount-effect marker，重复同一确定性场景转绿，M2 回归保持通过。

## 2. Qualification evidence

- [x] 2.1 运行 `pnpm verify-ui "route /"`（四条 smoke 路由）和 `pnpm verify-ui "M2 authentication waits for hydration after load"`，检查 login.png、确认无 console/hydration error、无其他路由截图选项扩散。
- [ ] 2.2 运行 `pnpm test:unit`、fmt/lint/typecheck/boundaries、strict OpenSpec/docs/decisions 与 required CI；test-only 不添加 changeset 或 production decision，archive 前最终 head required checks 全绿。

## Risk packs

- Selected: Legacy compatibility / examples - existing smoke screenshots, strict console assertions and M2 regression under 1.1/1.2/2.1.
- Selected: Concurrency / shared state / ordering - real post-load Scheduler hold and deterministic mount-effect observation under 1.1/1.2.
- Selected: Documentation / migration notes - account-auth MODIFIED spec delta; no user-visible changeset.
- Not selected: Public API / CLI / script entry - no production API or command changes.
- Not selected: Config / project setup - no dependencies or configuration changes.
- Not selected: File IO / path safety / overwrite - only existing screenshot output paths.
- Not selected: Auth / permissions / secrets - no credentials collected and no production auth changes.
- Not selected: Resource limits / large input / discovery - bounded two-input observer and existing route set.
- Not selected: Error handling / rollback / partial outputs - strict errors remain visible; no fallback behavior added.
- Not selected: Release / packaging / dependency compatibility - no dependency or package changes.
- Not selected: Schema / columns / units / field names - no data or schema changes.
