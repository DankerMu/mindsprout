# Tasks

## 1. Default bounded attempt evidence

- [x] 1.1 先以 default `observeNavigation` + `observeEditorVisit` 写失败回归：原实现没有 budget/action/outcome、marker/route partial 或 safe evidence。复用现有 diagnostic factory 与 `safePublicCreate`，加入显式 no-sampler default wiring 和有界 `public-create-evidence` sink；保留 legacy empty outcome/raw network，仅新增一个 CDP-close 生命周期 hook，不新增 network/timeline listener、HTTP/CDP command、`safe/` 或 `.next-profiles`。
- [x] 1.2 覆盖 arm 在首个 awaited snapshot 前注册 finalizer、begin→start、start 前保持 armed，以及 interruption-before-claim/start 的 null budget/unavailable action/outcome 且不过早 finalize。覆盖 fulfilled/rejected action、ready/readiness-failed/action-failed、root-commit-before-start、第二次导航与 ready 后 save assertion failure。验证原始 start/+5000 deadline 和 outcome 不被改写；ready/save 顺序仅 pin 现有行为，不修产品归因。

## 2. Failed-tail capture and lifecycle

- [x] 2.1 先写 readiness failure 后网络 receipt 与 DOM capture 红测，再让 default finalization 延后到现有 capture 后、cleanup 前；晚到记录只标记 failed-tail，success 立即 fence，root failure 仅 partial/unknown。不得增加 grace wait、deadline 或清理预算。
- [x] 2.2 验证 canary URL/request/error 不进入 safe event，64-request cap/omissions、marker/route missing codes、异常/中断/页面关闭均显式 partial；profile replay/finalization 与 default 产物分离。增加首个 create ready 后 restored trial failure：attempt 1 保持 ready、迟到观察不改写、无关 capture 不含 failed-tail metadata，后续 failure/cleanup 仍权威。

Fix-pass red/green 覆盖 Chromium CDP detach 的四个阶段、实际 runner 的 action/root/ready 发布错误，以及 replay selector 的 20,000 legacy + 1 valid evidence 边界；保留 later restored trial failure 回归。

Replay selector red/green 覆盖 20,000 legacy + 1 valid evidence + 1 paired publication notice 边界及非法组合。实际 runner 验证 action/root/ready 的持久化形状，包括 root 的 JSONL fallback append 失败；later restored trial 回归仍通过。证据：`.run/issue260-checks/fix2/`。

## 3. Contract and verification

- [x] 3.1 更新 native guide、development-navigation contract 和决策记录：新增 testing decision 部分承接 0031 的 default scope，保留并交叉链接 0030/0031。以 JSONL 断言验证 legacy `public-create-outcome`/`public-create-network` 形状不变、新 `public-create-evidence` 字段/provenance 精确、capture metadata 仅在指定失败出现；文档说明字段解释与无需迁移。运行 `pnpm decisions:check`、`pnpm docs:check` 和 strict OpenSpec。
- [x] 3.2 运行 focused native tests、`pnpm native:browser:test`、`pnpm lint`、`pnpm typecheck`、`pnpm fmt:check`；以 fresh output 分别运行真实 unprofiled source-change 与 restored-lifecycle，断言无 profiler/sampler/extra HTTP、无 default safe/profile 目录、原 noise/readiness/cleanup 不变。最终 required CI 必须通过；不新增 changeset（测试工具）。

本地检查及两种真实 unprofiled mode 已通过，日志与退出码保存在 `.run/issue260-checks/`。最终 head `afce15c54de3a907a2e90e0aaaee8f06718d68f3` 的 required CI run `45120472610` 全部通过，包括 Darwin/Linux installed native、E2E、aggregate、lockfile 与 diff guard；PR #265 已合并。

Risk-pack mapping: CI/script entry → 1.1/3.2 原命令与 required CI；concurrency/ordering → 1.2/2.1 claim/start/action/outcome/capture/finalization；file IO/path safety → 2.1 仅现有 JSONL/capture 路径，不新增 safe/profile 文件；auth/permissions/secrets → 2.2 fixed projection/canary；schema/field names → 3.1 legacy 形状、新 event/provenance/capture metadata 精确断言；documentation/migration notes → 3.1 native guide、决策交叉链接、无需迁移说明及 docs/decisions/OpenSpec 检查；error handling/rollback → 1.2/2.1 原错误与 cleanup；resource limits → 1.1/2.2 既有 64/256 caps、无新 page work；legacy compatibility → 1.1/2.2/3.2 两模式、legacy/raw/profile 分离。
