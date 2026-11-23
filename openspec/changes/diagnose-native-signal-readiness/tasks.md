# Tasks

## 1. Handshake phase and bounded failure evidence

- [x] 1.1 先以现有 parent/child handshake seam 写失败诊断回归，确认当前仅有笼统 readiness timeout；实现 launch 后立即上报 PID、父进程同步验证身份、固定 connect/ready 阶段、child exit/error 与安全输出状态，保存红/绿命令、退出码和断言。原始 stderr/错误消息不发布；唯一允许的固定失败行映射为 `fixture-failed`，其余为 `unpublished`，16 KiB cap 仅防内存增长。用 credential-canary、混合/多行和 oversized 输入验证最终 error/artifact 无秘密。
- [x] 1.2 增加 launch 成功但 connect 阻塞的红/绿 partial-startup 覆盖：父进程在 connect 阻塞前已取得并验证浏览器身份， readiness 失败后迟到 ready 不能逆转结果或触发 test SIGINT/SIGTERM，child/browser 在原 teardown bounds 内回收。以四种 mode/signal 的真实 `pnpm native:browser:test` 验证原 10 秒 deadline、身份校验和清理断言不变；不加重试/延时，确保临时输出与进程资源全部清理。

## 2. Verification and delivery

- [x] 2.1 运行受影响 Node tests、`pnpm lint`、`pnpm typecheck`、`pnpm fmt:check` 和 strict OpenSpec；在 PR 中区分有界诊断改动与未知原始间歇性根因，不新增 changeset（仅测试工具）。

Risk-pack mapping: CI/script entry → 1.1/1.2/2.1 原 native test command；concurrency/ordering → handshake/ready/signal/清理顺序与 late-event fencing；file IO/path safety → 仅 test-owned 有界输出；auth/permissions/secrets → 1.1 原始 stderr/错误消息不发布及 canary/oversize 测试；error handling/rollback → readiness/child failure/清理；resource limits → 16 KiB 内存 cap、固定输出与 process reap；legacy compatibility → 四种 signal/cleanup 原断言。未选产品 API/schema、dependency/release，因为无产品变化。
