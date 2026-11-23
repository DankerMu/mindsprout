# Tasks

## 1. Recovery transition and race safety

- [x] 1.1 先写红测：401/500 后当前 stable map 真正成功的第三次 flush 后立即断言 notice=null（在 no-op flush 前）；用 `RecordingRepository` 先 reject 新写入 401、再 resolve 旧写入，断言旧成功不清新提示，最后当前 map 成功才清；非保存 notice 经真实 PUT 后仍保留。直接 `onSaved` spy 验证 PUT resolve 前 0 次、后 1 次、no-op flush 不新增。更新锁定残留提示的断言，运行 focused tests 确认旧实现失败。
- [x] 1.2 给 autosave 增加成功通知，只在 put resolve 后 `stable === sent` 时触发；store 仅清 `SESSION_EXPIRED`/`SAVE_FAILED`。迁移直接 factory 测试，focused tests 转绿且不新增 UI 状态副本。

## 2. Browser and qualification evidence

- [x] 2.1 扩展现有 M2 two-device recovery 用例：成功 PUT 后提示和重新登录链接自动消失，刷新仍保留两次编辑，保存恢复截图且零 console/page error。运行 `pnpm verify-ui "two devices, pending-edit recovery"`。
- [ ] 2.2 添加 patch changeset，运行 `pnpm test:unit`、fmt/lint/typecheck/boundaries、strict OpenSpec/docs/decisions 与 required CI；完整记录并发矩阵和浏览器证据，archive 前确认最终 head 全绿。

## Risk packs

- [x] Concurrency / shared state / ordering — 1.1/1.2 identity guard and older-success/newer-failure tests.
- [x] Error handling / rollback / partial outputs — both 401 and generic failures remain pending and visible until current success.
- [x] Documentation / migration notes — two spec deltas, changeset, final CI evidence.
- [ ] Public API / CLI / script entry — not selected: internal autosave option only; all direct consumers migrate in the same change.
- [ ] Config / project setup — not selected: no configuration changes.
- [ ] File IO / path safety / overwrite — not selected: existing repository port only.
- [ ] Schema / columns / units / field names — not selected: no persisted envelope change.
- [ ] Auth / permissions / secrets — not selected: recovery UX only; session validation and link target unchanged.
- [ ] Resource limits / large input / discovery — not selected: no loops, storage, or discovery changes.
- [ ] Legacy compatibility / examples — covered by existing debounce, rebase, flush and failed-write tests under 1.1/2.2.
- [ ] Release / packaging / dependency compatibility — not selected: no dependency or package changes.
