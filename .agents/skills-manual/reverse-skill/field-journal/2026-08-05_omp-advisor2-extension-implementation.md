# 2026-08-05 omp advisor2 Extension 实现（Claude advisor 移植）

## 场景分类
其他（Extension 移植实现 / omp 宿主 API 实证）/ 承接同日逆向条目 `2026-08-05_claude-code-advisor-tool-logic.md`

## 目标概述
把 Claude Code 的 advisor（server-side tool，"补习班模式"：模型按需主动调用）移植为 omp extension `advisor2`，落地 `~/.omp/agent/extensions/advisor2/` 并跑通全部 8 项验证（VAL-001~008）。

## 完整执行链路

1. 读 SPEC.md v1.2 定稿（§3 含 extension.ts/prompt.ts 全文）与 omp 源码稀疏克隆 `/tmp/omp-src` 核对 API：registerTool/registerCommand/registerFlag/getFlag、ExtensionUIContext.notify、ctx.models.resolve/current、ctx.modelRegistry.resolver(model)、completeSimple(model, {systemPrompt,messages}, {apiKey,signal,disableReasoning,maxTokens})、ContextEvent.messages、SessionEntry 判别联合、AgentToolResult 形状。
2. 落盘三文件：extension.ts（context 被动快照 + advisor2 工具 + /advisor2 命令 + 降级式模型解析链）、prompt.ts（ADVISOR_SYSTEM_PROMPT + ADVISOR_TOOL_DESCRIPTION）、package.json。
3. VAL-001~002：`omp -e` 交互启动 + `/advisor2 status` 四行输出 + 模型可见工具。
4. VAL-003 首轮：模型实现前调用 advisor2，返回自审前缀文本（flag 模型==主模型 → selfReview 语义正确）。
5. 会话文件实证发现：评审调用 1 输出 XML `<invoke name="read">` 文本——无 tools 的 reviewer（deepseek-v4-flash）模仿 transcript 中结构化 toolCall 块输出 DSML。
6. 修复：messages 改 `serializeConversation`（@oh-my-pi/pi-agent-core/compaction）展平为纯文本单条 user 消息（[User]/[Assistant]/[Think]/[Tool Call]/[Tool Result]，tool result 截断 2000 字符）。
7. 加载失败排查：`@oh-my-pi/pi-coding-agent` 值导入 `serializeConversation` → "Export named 'serializeConversation' not found"（编译版 17.1.8 shim 未转发，源码 shim 有但构建更早）→ 改直连 `@oh-my-pi/pi-agent-core/compaction` 加载成功。
8. 空输出 bug：details 显示 output=2000/reasoningTokens=2000——opencode-go provider 忽略 disableReasoning，maxTokens=2000 全被推理吃满 → maxTokens=6000 + reviewText 为空时回退 thinking 块。
9. VAL-003 复验通过：独立 reviewer（deepseek/deepseek-v4-flash）返回 "VERDICT: ADJUST" 纯文本，主模型引用。
10. VAL-004/005：details.reviewedTurn=true；请求仅 {systemPrompt,messages} 无 tools。
11. VAL-006：`/advisor2 model` 切换 → details.advisorModel 变更、selfReview=false。
12. VAL-007：临时 MAX_CALLS=3，4 个并行调用第 4 个 isError "advisor2 max uses exceeded (3)"（并发计数正确）。
13. VAL-008：`/advisor2 off` 后调用 isError "advisor2 is disabled"；`/advisor2 on` 恢复。
14. SPEC 更新至 v1.5（偏差 ⑧~⑭ 全部记录）+ Validation Results 章节；回写本日志与索引。

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| 命令 handler `return "文本"` 不显示 | runner `await command.handler(args, ctx)` 丢弃返回值（agent-session.ts:5362） | 全部改 `ctx.ui.notify(msg, type)`（autoresearch/bundled-review 同款） | 5min |
| FR-006 collapsed `??` 链跳过降级级 | spec 定稿把 ①/②/③ 合并为一次 resolve | 逐级独立 resolve + 每级失败 warn 再降级 | 10min |
| 无 tools reviewer 输出 `<invoke>` XML | 结构化 toolCall 块被 deepseek 模仿成 DSML | serializeConversation 展平为纯文本单条 user 消息 | 40min |
| `serializeConversation` 从 pi-coding-agent 导入失败 | 编译版 17.1.8 的 shim 未转发该导出（源码有，构建版本更早） | 改从 `@oh-my-pi/pi-agent-core/compaction` 直连导入（叶子模块） | 20min |
| 评审输出为空文本 | opencode-go 忽略 disableReasoning，maxTokens=2000 全被 reasoning 吃满（reasoningTokens=2000） | maxTokens=6000 留文本空间 + 空文本回退 thinking 块 | 15min |
| 自审误判 | 只比 `model.id` 会跨 provider 误判 | provider+id 双键比较 | 5min |
| 扩展加载失败 → `unknown flag: --advisor2-model` 误导 | 扩展模块求值失败时 flag 未注册，CLI 报 flag 错误掩盖真因 | 先看 `[Unhandled Rejection] ExtensionExitError` 行，print 模式 `omp -p -e` 隔离复现 | 10min |

## 工具链发现

- `omp -p -e <ext> "msg"` 是扩展加载的快速隔离测试（非交互、秒级）；slash 命令在 print 模式不生效（当 prompt 发给模型）。
- 会话 jsonl（`~/.omp/agent/sessions/<ws-dir>/<id>.jsonl`）是工具结果真相源：toolResult details 含 `xdev.inner`（extension 返回的 details 信封）。
- extension 工具在本 omp 版本以 `xd://<tool>` 虚拟设备形式暴露给模型（read 文档 / write 调用）。
- `serializeConversation(messages, dialect?)`：无 dialect = 纯文本 transcript；`[Tool Result]` 截断 2000 字符；anthropic dialect 会丢 thinking。
- `disableReasoning` 是尽力而为：generic OpenAI 兼容端点用最低 effort 关推理，opencode-go 直接忽略。
- 并行工具调用下 `calls += 1` 在 await 前递增 → 配额并发安全。

## 关键代码/命令

```bash
# 扩展加载隔离测试
omp -p -e ~/.omp/agent/extensions/advisor2/extension.ts --model opencode-go/deepseek-v4-flash:max "hello"
# 交互验证（PTY）
omp -e ~/.omp/agent/extensions/advisor2/extension.ts --advisor2-model <spec> --model <spec>
# 会话文件真相源
~/.omp/agent/sessions/--private-tmp-advisor2-test--/<id>.jsonl
```

```ts
// 评审上下文展平（核心修复）
const transcript = serializeConversation(messages); // [User]/[Assistant]/[Think]/[Tool Call]/[Tool Result]
const result = await completeSimple(model, {
  systemPrompt, // 仅 [ADVISOR_SYSTEM_PROMPT]，不 dump executor system
  messages: [{ role: "user", content: transcript, timestamp: Date.now() }], // 不传 tools
}, { apiKey: ctx.modelRegistry.resolver(model), signal, disableReasoning: true, maxTokens: 6000 });
```

## 可复用的模式/脚本片段

- **无 tools reviewer 防 DSML 模仿**：结构化 toolCall 消息块会诱导工具型模型输出工具调用语法——评审/摘要类请求先展平为纯文本 transcript 单条消息。
- **扩展命令输出**：handler 返回值被丢弃，用 `ctx.ui.notify`。
- **配置降级链**：逐级独立 resolve + warn，避免 collapsed `??` 跳过中间级。
- **宿主 API 实证优于源码推演**：编译版二进制的 shim/导出可能与源码不同（serializeConversation 转发缺失），以 `omp -p -e` 实测为准。

## 进化动作
- [ ] 更新了路由矩阵
- [ ] 更新了 tool-index
- [ ] 更新了 bootstrap-manifest
- [ ] 更新了子 skill 文档
- [x] 新增了 pitfalls 记录（见本文件踩坑表）
- [x] 更新了 _index.md

## 环境信息
- OS: macOS 14.5 (darwin 23.5.0, arm64, Apple M1 Pro)
- 工具版本: omp 17.1.8 (`~/.bun/bin/omp`)；Bun 编译
- 目标: `~/.omp/agent/extensions/advisor2/`（extension.ts / prompt.ts / package.json / SPEC.md v1.5）
- 验证模型: executor opencode-go/deepseek-v4-flash:max；reviewer deepseek/deepseek-v4-flash

## 脱敏要求
本文件不含目标域名/IP/密钥/内部网络信息，无脱敏需求。

## 索引同步
已更新 `_index.md`（场景分类"Web/API/渗透测试"下新增条目；统计 9→10）。
