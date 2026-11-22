# Tasks

## 1. Map row action targets

- [x] 1.1 先以同名第二行的组件测试证明旧呈现不在行内；将现有 rename/delete UI 移入其 activeSession.id 对应行并验证焦点、取消、失败与 peer 不变（MapLibrary mutations tests 红→绿）。
- [x] 1.2 增加 map-library 同名行的真实浏览器 rename/delete 场景、截图和零 console 断言，验证实际记录 ID，保留并断言第二行确认逐字为 `确定永久删除“新导图”吗？`；运行 `pnpm verify-ui "map-library"`。

## 2. Account reset targets

- [x] 2.1 先更新 AdminUserList 测试为按用户名定位按钮和点名确认；实现相同 ID 请求、取消零请求、原失效整句、pending/secret/focus 保留（红→绿）。
- [x] 2.2 更新 account-admin 浏览器走查并截图，运行 `pnpm verify-ui "account-admin"` 验证零 console error 和原有会话失效语义。

## 3. Integrated delivery

- [x] 3.1 添加 patch changeset，完成受影响单测、coverage、`pnpm typecheck`、`pnpm lint`、`pnpm boundaries`、`pnpm docs:check`、`openspec validate identify-list-action-targets --strict --no-interactive`；记录 orchestrator 一次验证及实际 UI 证据。

Risk-pack mapping: concurrency/shared state/ordering → 1.1/1.2 的捕获 ID、peer 和 serialization；auth/permissions/secrets → 2.1/2.2 仅保留既有 reset 权限与会话失效，无 secret 日志；legacy compatibility → 两个组件旧取消、失败、焦点断言；documentation → 两个 spec deltas 与 3.1 changeset。未选 public API、config、file IO、schema、resource limits、release，因为不改变这些边界。
