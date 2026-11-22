# Tasks

## 1. Non-mutating browser evidence

- [x] 1.1 在 `e2e/account-auth.spec.ts` 两个既有 `page.screenshot` 显式使用 `caret: 'initial'`；不新增 helper 或改生产代码。以临时页面 mutation diagnostic 分别包裹两个真实截图调用，记录两个 credential input 的 caret 相关 inline-style old/new 瞬变；修改前存在 caret mutation 是 harness red（不是原 CI 时序复现），修改后两个调用均为零，且没有截图后的残留。删除临时 diagnostic，保留凭据请求为空、401、链接、输入和 `observed.noise()` 零断言；运行 `pnpm verify-ui "Switching public forms"` 检查截图。

## 2. Verification and delivery

- [x] 2.1 运行 `pnpm typecheck`、`pnpm lint`、`pnpm fmt:check` 和 strict OpenSpec；将修改场景与证据写入 PR，观察完整 E2E/CI，不能把单次通过称为 CI 间歇性根因的确定修复。

Risk-pack mapping: concurrency/shared state/ordering → 1.1 的非变更截图选项与 hydration 边界；legacy compatibility → 保留原表单切换、凭据和噪音契约。未选 auth/permissions（不改会话/API）、file IO（固定既有截图路径）、config、schema、release 或产品 UI，因为无相应变化。
