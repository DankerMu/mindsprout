# Tasks

## 1. Recovery transition and race safety

- [x] 1.1 先写红测：401/500 后当前 stable map 真正成功的第三次 flush 后立即断言 notice=null（在 no-op flush 前）；用 `RecordingRepository` 先 reject 新写入 401、再 resolve 旧写入，断言旧成功不清新提示，最后当前 map 成功才清；非保存 notice 经真实 PUT 后仍保留。直接 `onSaved` spy 验证 PUT resolve 前 0 次、后 1 次、no-op flush 不新增。更新锁定残留提示的断言，运行 focused tests 确认旧实现失败。
- [x] 1.2 给 autosave 增加成功通知，只在 put resolve 后 `stable === sent` 时触发；store 仅清 `SESSION_EXPIRED`/`SAVE_FAILED`。迁移直接 factory 测试，focused tests 转绿且不新增 UI 状态副本。

## 2. Browser and qualification evidence

- [x] 2.1 扩展现有 M2 two-device recovery 用例：成功 PUT 后提示和重新登录链接自动消失，刷新仍保留两次编辑，保存恢复截图且零 console/page error。运行 `pnpm verify-ui "two devices, pending-edit recovery"`。
- [x] 2.2 添加 patch changeset，运行 `pnpm test:unit`、fmt/lint/typecheck/boundaries、strict OpenSpec/docs/decisions 与 required CI；完整记录并发矩阵和浏览器证据，archive 前确认最终 head 全绿。

最终 head `a20f62cacf489bf9ab580a3921926af9d652dcab` 的 required CI run `45179938746` attempt 2 全部通过；PR #273 已合并，#239 已关闭。Attempt 1 的 Darwin 冷 root Document commit 超时已保留，重跑仅作资格证据，不声明根因修复。

## Risk packs

- Selected: Concurrency / shared state / ordering — 1.1/1.2 identity guard and older-success/newer-failure tests.
- Selected: Error handling / rollback / partial outputs — both 401 and generic failures remain pending and visible until current success.
- Selected: Documentation / migration notes — two spec deltas, changeset, final CI evidence.
- Not selected: Public API / CLI / script entry — internal autosave option only; all direct consumers migrate in the same change.
- Not selected: Config / project setup — no configuration changes.
- Not selected: File IO / path safety / overwrite — existing repository port only.
- Not selected: Schema / columns / units / field names — no persisted envelope change.
- Not selected: Auth / permissions / secrets — recovery UX only; session validation and link target unchanged.
- Not selected: Resource limits / large input / discovery — no loops, storage, or discovery changes.
- Selected: Legacy compatibility / examples — existing debounce, rebase, flush and failed-write tests under 1.1/2.2.
- Not selected: Release / packaging / dependency compatibility — no dependency or package changes.
