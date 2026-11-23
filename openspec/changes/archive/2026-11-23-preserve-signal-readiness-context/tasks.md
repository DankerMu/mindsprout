# Tasks

## 1. Trusted mismatch propagation

- [x] 1.1 先添加并运行红测：用真实 fixture 产生的 bounded spawn failure 调用不同 expected reason，要求抛出同一个原始 error 对象；当前 generic assertion 必须使测试变红。覆盖未标记 raw/canary error 仍不会经 mismatch path 发布。
- [x] 1.2 在现有 fixture 内以弱标记识别 `readinessError` 对象，仅对可信且 reason 不匹配的 error 原样抛出；匹配 reason 的 parsing/return schema、任意 raw error generic path、10 秒 deadline、identity 与 cleanup 均不变。

## 2. Real-path and qualification evidence

- [x] 2.1 运行 focused native tests 与普通 identity cases；用既有 throwaway delayed-ready 探针比较修复前后：旧的 masking assertion 变为原始 bounded 10 秒 timeout + connecting phase，测试仍失败且 cleanup 成功。运行完整 `pnpm native:browser:test`，不得把受控延迟表述为自然 CI 根因。
- [x] 2.2 更新 native guide 的 mismatch 诊断说明（如需），运行 format/lint/typecheck、strict OpenSpec、docs/decisions 与 required Darwin/Linux CI；不新增 changeset、retry/warmup/skip 或 deadline 改动。只有自然失败提供可归因证据后才评估关闭 #258 的原始根因验收项。

本地静态、文档、决策与 25 项 strict OpenSpec 均通过；最终 head `bf9d0b58689362d5e2dafa565389961e133e8507` 的 required CI run `45137956786`、Darwin/Linux native 与 Linux native repair 全部通过，PR #267 已合并。#258 的自然根因验收保持开放。
