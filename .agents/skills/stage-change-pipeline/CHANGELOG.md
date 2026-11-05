# Changelog

All notable changes to this skill will be documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.20.1] - 2026-09-14

### Changed

- 终局回流措辞对齐 `subagent-workflow` 0.36.0：下游终局事件由"round-ceiling"改为"两轮修复用尽（fix-pass gate 锁定）"，sizing-retro 的 `outcome` 词表 `ceiling-split` 改为 `gate-split`，`rounds_burned` 来源改为下游停机报告（round ledger 已删除）。契约字段 `Suggested fixture level` / `Minimal mergeable slice` 不变。

## [0.20.0] - 2026-09-05

### Changed

- **压测门禁的跳过豁免改由用户拍板（breaking：`grillGate` 跳过形态变更）**。`"skipped:<理由>"` 字符串是 agent 自己写给自己的豁免——门禁和豁免由被门的一方一手写就，与 `mattpocock/skills` wayfinder 的 Notes 自我授权是同一失效类，也是 0.15.0 拒绝裸 `"passed"` 时漏掉的另一半。现在 `full-pipeline.workflow.js` 只接受 `{ status: "skipped", reason, approvedBy: "user", userConfirmed: true }`；裸字符串拒绝启动。跳过提议在提供 `AskUserQuestion` 的 harness 上必须经该工具提出，让用户同意留下工具调用记录。审计日志 `grill_gate` 改记 `skipped:user:<理由>`（`loop-accountability.md` 同步），与 0.20 之前的 agent 自决跳过可区分。跳过理由有了消费者：注入 Stage 3 Review 1 prompt，审核者核对 artifact 里没有该理由罩不住的隐含决策。诚实声明：与 `passed` 凭证的 `userConfirmed` 一样，这是对话里的用户确认被编码进参数，脚本校验的是"agent 必须显式断言用户批准"，不是用户签名。
- 门禁校验补齐 `openItems`：缺省或字符串数组才放行（原先非数组值能过门禁、随后在 ledger 渲染处抛异常，审计日志来不及写）。
- `references/stage-flow.md` 压测门禁措辞跟随 `grill-me` 0.6.0：由"多轮、一次一问"改为"按前沿逐轮"；凭证结构与收敛判据不变。

### Added

- **fog 两节**（adapted from wayfinder 的 fog of war / out of scope，反瀑布装置），都落在 design.md：`## Not yet specified`——范围内、能看见要来但问题本身还说不清的工作，判据是"能否精确提问"而非"能否回答"，比 task 粗、一律不预切进 specs/tasks，等后续 change 的前沿推到再毕业；OpenSpec 模板自带的 `## Goals / Non-Goals` 的 Non-Goals 半必须填实——出了本 change 目的地的工作（不另开 proposal.md 节：模板里 proposal 没有 non-goals 位，design.md 有，两处并存会漂）。open question / Not yet specified / Non-Goals 三者分工写在 stage-2-artifacts.md，stage-flow.md 只留指针。Stage 2 收尾多一条 grep 硬停（两节缺失不进 Stage 3）；Stage 3 Review 1 核对两节存在（缺失 P1）、条目未切成 spec；Review 3 核对没有 task 在实现两节条目（有即 P1），一项检查一个审核者。`full-pipeline` 与 `review-loop` 的审核 prompt 同步。**对存量 change 的影响**：0.20 之前生成的 change 缺两节，重跑 `review-loop` 会先吃一个 P1，补两节即可。

## [0.19.0] - 2026-08-09

### Changed

- Contract declarations move upstream: every tasks.md task group now ends with two contract lines (`Suggested fixture level`, `Minimal mergeable slice`) authored in Stage 2 (`stage-2-artifacts.md`), audited for credibility by Stage 3 Review 3 (missing lines are P0), and only consumed — never invented — by Stage 5. This closes the ordering defect where Review 3 was asked to audit fields that did not exist until Stage 5, and stops the width gate's executor from writing its own inputs.
- `full-pipeline.workflow.js` Stage 5 issue-creation prompt now carries the full width gate: contract-field inheritance from tasks.md, the three criteria (slice-deferred / multi-path / merged-tasks), the single `Width exception` escape, and the recursion endpoint. Previously the hardcoded workflow path created issues with the pre-0.17 field list, so the gate existed only in prose and degraded into Stage 5.5 after-the-fact repair.
- Review 3 (tasks-executability) prompts in `full-pipeline.workflow.js` and `review-loop.workflow.js` now audit the tasks.md contract lines and flag coarse tasks (multiple verification paths or an independently deliverable subset inside one task).
- Removed the >5-issue recursion cap and its return-to-Stage-4 backflow: it contradicted the first grouping principle (no cap on sub-issue count) and had no execution path inside the hardcoded workflow. Recursion ends only when the remainder is `atomic`; issue count follows module boundaries and dependencies.
- Slices produced by first-slice recursion are linked by real dependencies only — independent slices must not be chained linearly, preserving downstream DAG parallelism.
- `multi-path` criterion clarified everywhere (both reference docs and both reviewer prompts): only paths needed to prove the acceptance criteria count; hygiene checks (lint/build/format) do not.

## [0.18.0] - 2026-08-09

### Added

- **Stage 5 宽度门禁**（`stage-flow.md`）：创建子 issue 前逐个分组过三条判据，补上"issue 拆得太宽"的四个漏洞。
  - **首刀拆分闸**：`Minimal mergeable slice` 非 `atomic:` 时默认把首刀拆成独立 issue，剩余部分 `Depends on` 首刀并递归至自身 `atomic`。此前该字段书面证明了可拆性却不触发任何动作，只服务下游 gate 的事后补救——可拆性一旦被证明就必须兑现。
  - **单一验证路径**：验收标准需多于一条互不重叠的验证路径才能全部证明即为过宽，按路径切分。这是给"一个小 PR"补上的唯一可证伪判据；行数/文件数太容易被自圆其说。
  - **合并需举证**：合并多个 task 须留痕，与 `atomic` 声明对称——此前省事地合并无人过问，省事地宣称原子反被 Review 3 审查。
  - 递归产出 >5 个 issue 判为上游粒度缺陷，回 Stage 4 修 `tasks.md`，不在 Stage 5 硬切。
- **`Width exception` 条件字段**（`<slice-deferred|multi-path|merged-tasks> - <理由>`）：三条判据的唯一豁免出口，缺失即门禁未过、不得标 `Implementation Ready: yes`。合并为单一字段而非三个平行免责字段。理由须论证更细的切法对交付没有价值，而非"拆开麻烦"。
- **Stage 5.5 新增 `over-broad` 维度**（第七维，同步两个 workflow 脚本的 enum、维度描述与修复指引）：专查单模块内过宽。此前 `wrong-boundary` 只查"混合多个模块"，一个老实待在单模块内、却塞进整个模块改造的 issue 六个维度全绿放行——这是对齐审核对宽度的硬盲区。

### Changed

- Stage 3 Review 3 增加 **task 粒度过粗** 检查项：单个 task 跨越多条验证路径或含可独立交付子集，是 `tasks.md` 的粒度缺陷，在 Stage 4 修，不得留到 Stage 5 靠"1-3 个 tasks"的计数上限糊过去。
- 分组硬规则明确"**1-3 个 tasks 是上限不是许可证**"：它约束 task 计数、不约束工作量，一个粗 task 撑爆的 issue 同样违规。

## [0.17.0] - 2026-07-23

### Changed

- **结构重构：照搬 `subagent-workflow` 的薄核架构，SKILL.md 33KB → 8KB，行为契约零变化**。触发即载入的 SKILL.md 只留路由（When Not to Use / 概览 / 跳过策略）、**不可协商项索引**（压测门禁 EITHER/OR + 主会话时序、seams 清单、P0+P1 双阻塞、4.5 ack 凭据、Stage 5 契约字段名、收尾问责、终局回流）与启动入口（`Workflow()` 调用示例唯一一份，消除此前三处重复的 grillGate 形态）：
  - 新增 `references/stage-flow.md`：Stage 1→5.5 完整执行契约整体下沉（原文迁移），漏读的机械兜底是 workflow.js 拒启 + ack 凭据 + 硬编码回环。
  - 新增 `references/stage-2-artifacts.md`（逐 artifact 写法/命令骨架）与 `references/stage-5-issues.md`（分组原则全文/创建步骤/issue 正文模板/5.5 维度表），由 stage-flow.md 引用。
  - 编排器四步日志流程移入 `references/loop-accountability.md`（与 schema/kill/ratchet 同处）。
  - Stage 3/4/4.5 教学性清单删除（"典型 P0 问题类型"等），brief 构建与核销步骤收拢成段；三路分工表、oracle 完整性、回环判定原文保留在 stage-flow.md。
  - 契约两个可拆性字段与终局回流的实测战史从句删除——论据已完成说服使命，规则本体不动。workflow 脚本注释的三处 SKILL.md 指针同步改指新位置。

## [0.16.0] - 2026-07-23

联合改版（与 `subagent-workflow` 0.28.0 同批）。实跑复盘归因：下游最贵的失效类——xagent #291 同一 issue 连撞两次 5 轮 review ceiling（约 10 轮，超过当年 #131 单 PR 事故的量级）、被迫终局拆分后最小子 PR 一轮全绿；SHUD issue-79 十连 same-invariant 手动门后撞顶拆分、子 PR 三轮收敛——根因一半在本流水线：Stage 5 承诺"小 PR + 预期 PR 边界"却不提供可证伪的可拆性声明，切片失败的代价全部在下游烧掉、零回流。本版把单向交接改成回路。

### Added

- **实现就绪契约新增两个字段**（Stage 5 契约清单 + 步骤 4 issue 正文模板，Stage 3 Tasks-可执行性审核路新增对应检查项）：
  - `Suggested fixture level`：`none|compact|expanded` + 一行理由，词表以下游 `issue-risk-contract.md` 为单一事实源（指针不镜像，沿用 gh-create-issue agent-brief 先例）。动机：上游最了解模块边界与预期 PR 体量却不预判分级，实测下游要么整段时期全按最重档跑（SHUD 26/26 expanded/high，无视 "prefer compact"）、要么自造词表外标签（xagent `standard`/`light`）。下游从该建议起判，双向偏离都须记录理由——分级偏离从默认行为变成可见决策。
  - `Minimal mergeable slice`：首刀声明——若需拆分，最小可独立合并保绿的子集（真原子写 `atomic: <理由>`；expand–contract 批次天然满足）。动机：下游 `Split rebuttal` 是自由散文时被泛泛反驳连续骗过两次（#291 双 ceiling），拆分默认无锚可锚；此字段让反驳对象变成一把具体的刀。Stage 3 审核核对该刀是否真能独立保绿——防止它像当年裸 `"passed"` 一样被敷衍填写（0.15.0 已为同类失效付过一次学费）。
- **终局回流（sizing-retro）**（SKILL.md 跨运行问责第 2 节 + `loop-accountability.md` 第 4 节 schema）：下游任何 PR 以 round-ceiling 拆分/放弃/降档收场，都是本流水线一次切片或契约失败的证据，必须回流——(1) 拆分子工作项重过 Stage 5 全字段契约 + 一轮轻量 Stage 5.5 对齐审核（仅限拆分子 issue），不得以裸 PR/裸 fixture 出生（实测绕过契约的拆分子项实现前烧三轮 fixture 修复；下游 0.28.0 起两轮封顶后会作为 `contract-gap` 上报回来）；(2) 向 `docs/stage-pipeline-log.jsonl` 追加 sizing-retro 行，裁决 `slice-error|contract-gap|genuinely-hard` + 一行"下一个同类阶段怎么切"。边界：这是问责不是跨 change 学习，sizing-retro 不注入后续 change 的审核 brief（非目标不变）；顺带治好 stage-pipeline-log 躺尸病——日志此前只记成功运行，恰好错过它声称要问责的最贵事件。sizing-retro 行不计入 kill 标准样本。

## [0.15.1] - 2026-07-17

### Fixed

- **凭证时点语义**：明确 `grillGate` 凭证以启动时点的最终共识为准——Stage 2 期间经用户确认的决策变更须先更新凭证对应分支再启动。否则照抄 grill 时点快照会让 Stage 3 把合理变更判成"漂移"，强制 artifact 对齐过期决策。

## [0.15.0] - 2026-07-17

### Added

- **Grill 结论闭环消费**（补 0.14.0 留下的断链：凭证只用于校验和计数，分支内容校验后即被丢弃，结论传导全靠对话记忆）：
  - Stage 2 新增强制输入规则：每个已拍板分支的结论必须落入对应 artifact（设计决策进 design.md，范围/边界类进 proposal 的 What Changes/Non-goals）；开放项要么解决、要么显式写成 open question/non-goal。
  - `full-pipeline.workflow.js` 把凭证对象渲染成 Grill ledger 文本块（`[decided:user|fact-check]` / `[open]` 逐条），注入 Stage 3 的 design-consistency 与 spec-completeness 两路审核 prompt，逐条核对：漂移、矛盾、开放项静默消失均为 finding。`skipped:<理由>` 运行不注入。review-loop 独立运行无上游凭证，不含此块（同步注释已标注差异）。

### Changed

- **压测门禁从声明升级为凭证（breaking：`grillGate` 参数形态变更）**。实跑发现管道内 grill 强度塌缩为敷衍几问——裸 `"passed"` 字符串是纯自我声明，workflow 只校验格式不校验证据，而管道推进压力天然把模型推向最便宜的"过门"路径（与 subagent-workflow 三轮硬门被跳过是同一失效类：散文规则输给目标竞争）。现在 `full-pipeline.workflow.js` 只接受逐分支凭证对象 `{ status: "passed", branches: [{ branch, decision, decidedBy: "user"|"fact-check" }], openItems, userConfirmed: true }`（每分支需有非空结论且 `decidedBy` 合法、`userConfirmed` 必须为 true）或 `"skipped:<理由>"`；裸 `"passed"` 拒绝启动。凭证数据源 = grill-me 0.4.0 的逐分支收敛清单（其铁律 8 同步声明：嵌入时退出判据与单独使用一致）。
- Stage 1 门禁措辞同步：passed 的判据是分支收敛 + 用户确认，不是问题个数；轮数由决策树分支数决定，不由管道进度决定。`logEntry.grill_gate` 落盘形态改为 `passed:branches=<n>,open=<n>`，压测深度随跳过率一并可审计（`references/loop-accountability.md` 同步）。

## [0.13.0] - 2026-07-16

### Added

- **`blind-spot-pass` 正式接进 Stage 1**（修复成员引用完整性缺口——它此前是 pack 成员却未被任何主干流程引用）：支撑 skill 清单登记 + Stage 1 新增"盲区侦察"步骤，位于文档读取之后、压测门禁之前。触发条件：目标阶段进入陌生模块/外部系统/设计文档覆盖不到的区域；产出的盲区清单决策点直接作为 `grill-me` 压测输入；熟悉领域可跳过、无需留痕（与压测门禁的强制留痕形成有意对比——侦察是条件动作，压测是必决策门）。

### Changed

- 描述减重：frontmatter description 从 457 字符压至 ~280——删触发词枚举（保留三个最强触发），补"单 issue 走 subagent-workflow"的反触发。未跑触发评测（无 ANTHROPIC_API_KEY），触发率变化留观察。

## [0.12.0] - 2026-07-14

- Stage 2 design.md 新增 **Sketch seams under test** 步骤（自动，不设交互停点——除 grill 门禁外流水线保持自动化）：写下测试将行使的公共边界（优先已有 seam、用最高的 seam、越少越好、理想一个），每个 seam 附一行选择理由记入 design.md；监督走既有回路（Stage 3 三路审核 + 下游 fixture review），随 fixture 流入 `subagent-workflow` 0.15.0 的 `Seams under test` 字段——测试预算据此落在关键路径。Adapted from `mattpocock/skills` v1.1.0 `to-spec`（seam 前置）与 `tdd`（seams 先定后测）；上游的"与用户确认"有意改为自动决策 + 审核留痕。

## [0.11.2] - 2026-07-14

- Stage 5 子 issue 契约新增一条：行为描述遵循 `gh-create-issue` 0.4.0 的 **agent-brief 耐久性契约**（指针引用其 `references/agent-brief.md`，单一事实源，不镜像）——写接口/类型/行为契约与 `Current/Desired behavior`，不写文件路径与行号，因为 issue 在 DAG 中等待期间代码结构会被前置 issue 改变。

## [0.11.1] - 2026-07-11

- Push loop-accountability detail (logEntry schema, kill criteria, ratchet policy) to `references/loop-accountability.md` and the duration estimate + minimal command set to `references/quick-reference.md` (slimming batch 5). The four mandatory orchestrator log steps, dependency list, and skip strategy stay in the body.
- Deduplicate the reliability disclaimer — stated once at Stage 4.5, referenced from Trigger Anchoring.

## [0.11.0] - 2026-07-11
- Stage 5 grouping principles gain a wide-refactor exception: a single mechanical change whose blast radius spans the repo is sliced by **expand–contract** (expand issue → migrate batches sized by blast radius, each `Depends on` the expand → contract issue depending on all batches; integration-branch fallback when batches can't stay green alone) instead of forcing per-module slicing. Mirrors `gh-create-issue` 0.3.0; adapted from `mattpocock/skills` v1.1.0 `to-tickets`.

## [0.10.1] - 2026-07-06
- Stage 5 分组原则新增一条：依赖允许的前提下，issue 排序按决策密度前置（数据模型、接口契约、用户可见流程在 DAG 前，机械重构殿后），与 `implementation-planning` 0.2 的 phase 排序原则对齐——人工 review 注意力优先落在最可能被调整的部分。

## [0.10.0] - 2026-07-02

Closes the audit finding that the hardened Stage 3→5.5 entry point silently bypassed the documented grill gate: the multi-round `grill-me` stress-test lived only in Stage 1 prose ("可选但推荐"), was absent from all workflow scripts, and — being user-interactive — cannot run inside a workflow at all. In practice it never fired.

### Added
- **Breaking: grill-gate attestation** in `full-pipeline.workflow.js`: a required `grillGate` arg — `"passed"` (grill-me ran in the main conversation) or `"skipped:<reason>"` (explicit, reasoned skip). Missing or malformed → the script refuses to start. Since workflow subagents cannot interact with the user, the gate is enforced as a launch precondition rather than an in-script step.
- `grill_gate` field in `full-pipeline`'s returned `logEntry`, so the pass/skip decision (with reason) lands in `docs/stage-pipeline-log.jsonl` and skip-rate becomes auditable. `review-loop` standalone runs operate on an existing change (the gate decision is upstream) and do not carry the field.

### Changed
- SKILL.md Stage 1 压测门禁 upgraded from "可选但推荐" to an EITHER/OR gate (run `grill-me` OR record an explicit skip reason), stating explicitly that the multi-round grill can only happen in the main conversation before the workflow launches; invocation examples, the logEntry schema, and the dependency list now include `grillGate`/`grill_gate`.

## [0.9.0] - 2026-07-02

Hardening pass from a defect audit of the workflow scripts and `SKILL.md`. **Minor** bump because it adds a new exit gate (completion self-audit) and a returned `logEntry` contract.

### Added
- **Completion self-audit gate** in both `review-loop.workflow.js` and `full-pipeline.workflow.js`: when the fix-verify loop clears all findings, a self-audit subagent re-derives the Stage 1 goals/acceptance criteria from the design docs, confirms each maps to a spec requirement and a task, and runs `openspec status` expecting 4/4. Pass exits the loop; fail turns the gaps into active findings that keep looping toward `MAX_ROUNDS` (residual on cap). Enforces the previously documented-but-unenforced SKILL.md 4-condition exit.
- **`logEntry` return object** from both loop scripts carrying the accountability-log fields (`gate_net_catch`, `p0`, `p1`, `regressions`, `approx_subagent_calls`, `verdict`) computed from real per-run counters. SKILL.md's "跨运行问责" section now spells out the orchestrator handoff as explicit numbered steps (take `logEntry`, add `date`, append one JSON line to `docs/stage-pipeline-log.jsonl`, commit) and aligns the documented schema to exactly what the scripts return.
- `failureClass` and `impact` are now **required** finding fields in `FINDINGS_SCHEMA`, and all six reviewer prompts request them, matching the SKILL.md finding contract.

### Changed
- **Ack tokens now match the mandated strings**: scripts emit `Stage 4.5 round <N>: started` on round start and `round <N> verdict: <resolved>/<total> resolved, residual P0=<n> P1=<n>` after verdicts, as SKILL.md requires for auditable proof the gate ran.
- **`gate_net_catch` definition unified** across prose and code: per round it counts findings the fixer claimed resolved but the verifier judged `unresolved`/`regressed` **plus** newly-introduced regressions (regressions were never counted before).
- Stage 5 issue template and the issue-creation prompt emit one `Depends on #NN` line per dependency (was `**Dependencies:** #a, #b`) so the downstream `subagent-workflow` DAG reader can parse the dependency graph.
- `full-pipeline` args contract unified to `{changeName, designDocs, stageLabel?}` in both SKILL.md examples; the dead `skillDir` arg is removed.
- SKILL.md now states vague/unanchored review items are **rejected** (not "降级为 note"), matching actual code behavior.
- Added `// NOTE: duplicated in … — keep in sync` comments above the reviewer briefs, `FINDINGS_SCHEMA`, `VERDICT_SCHEMA`, and `ALIGNMENT_SCHEMA` blocks that are copied across the scripts and SKILL.md.

### Fixed
- **Reviewer success floor**: fewer than 2 of 3 reviewers returning no longer reads as a clean review — the pipeline logs the failure and aborts with `verdict: "review-round-failed"` instead of proceeding on partial/empty results.
- **Alignment review null-guard**: a null alignment review now retries once and then aborts with an explicit error, instead of silently reporting the issues as "aligned" (both `full-pipeline.workflow.js` and `issue-alignment.workflow.js`).
- **`stageLabel` enforcement**: when a stage label is provided, the creation prompt now instructs `gh label create "<stageLabel>" --force` and applying that label to the Epic and every sub-issue, so Stage 5.5's label filter no longer silently drops unlabeled sub-issues as falsely "aligned".
- **Oracle integrity for fixers**: every fixer prompt now states the design docs / implementation plan / Stage 1 criteria (plus, for alignment fixers, the change artifacts) are an immutable oracle that must never be edited to make a finding or issue pass.
- **Defensive args parsing** added to `review-loop.workflow.js` (guards `changeName`) and `issue-alignment.workflow.js` (guards `changeName` and `epicNumber`), matching `full-pipeline.workflow.js`.
- **Truncation guard**: the `gh issue list --limit 100` step now instructs the agent to treat a full-100 result as likely truncated and re-list with a higher limit.

## [0.8.2] - 2026-07-02
- Add English trigger phrases to the SKILL.md description ("start the next stage", "turn this design into issues", "create issues from the spec/design", "run the stage pipeline"): the trigger surface was almost entirely Chinese, so English prompts rarely auto-activated the skill.
- Fix a typo in the `skill.json` description ("an reviewed" → "a reviewed").

## [0.8.1] - 2026-06-22
- **Fix**: Rewrite `full-pipeline.workflow.js` to inline all review-loop and issue-alignment logic instead of using `workflow()` sub-calls. Fixes "nesting is limited to one level" error when the script is invoked via `Workflow()` (the `workflow()` calls to child scripts created an implicit second nesting level). `review-loop.workflow.js` and `issue-alignment.workflow.js` remain available as standalone scripts.
- **Fix**: Add defensive args parsing — if `args` is passed as a JSON string instead of an object (caller-side serialization bug), parse it; abort early with clear error if `changeName` is missing.

## [0.8.0] - 2026-06-20
- **Breaking**: P1 升为阻塞带——P0 和 P1 均驱动回环，不再允许 P1 携带到 issue 而跳过修复。回环退出条件从"P0 清零 + P1 resolved-or-carried"变为"P0 + P1 全部 resolved"。
- Add `review-loop.workflow.js`: 将 Stage 3→4→4.5 回环逻辑从散文指令改为 Claude Code Workflow 脚本硬编码执行。`while (activeFindings.length > 0 && round < MAX_ROUNDS)` 循环不可被编排器跳过，解决实际运行中"一轮 review 完没 clean 就跳到 Stage 5"的问题。
- Workflow 脚本输出 `gateNetCatch` 指标，可直接写入跨运行问责日志。
- Add Stage 5.5 `issue-alignment.workflow.js`: Issue 创建后强制运行 Issue-Change 对齐审核，检查覆盖完整性、模块边界、依赖链、Scope 准确性、引用和内容漂移，fix-verify 循环最多 2 轮，解决"Issue 和 change 没有完全对齐"的问题。
- **(dim 5)** Add resolved-signature tracking and convergence detection to both workflow scripts: maintain a `resolvedSignatures` set across rounds; when a regression matches a previously-resolved title, flag it as whack-a-mole and log it; if active finding count stops decreasing past round 1, break early to avoid empty churn. Return `whackAMoleCount` in review-loop results.
- **(dim 8)** Add `full-pipeline.workflow.js`: chains review-loop → issue creation → issue-alignment via `workflow()` sub-calls, reducing the trigger surface from 2 manual workflow invocations to 1. Add a "触发锚定" section to SKILL.md with guidance on anchoring the single invocation to CI/pre-PR hooks in consuming repos and auditing skip-rate.

## [0.7.0] - 2026-06-18
- Stage 3 review contract now draws the finding's failure type from the `risk-adaptive-cross-review` `finding-contract.md` Failure-Class Vocabulary (including the spec classes `design-consistency`/`spec-completeness`/`task-executability`) and applies its Reject precision gate so vague, unanchored, or style-only items become notes instead of P0/P1.
- Add an **Oracle Integrity** constraint to the Stage 4.5 verification gate: the source design docs, implementation plan, and Stage 1 stage goals/acceptance criteria are the immutable oracle; fixes edit the OpenSpec change, never the artifacts that judge it. A genuine source-design change routes back through `brainstorming`/`future-aware-architecture` and is recorded, never silently rewritten to clear a finding.
- Add a **completion self-audit (premature-completion guard)** as a Stage 4.5 exit precondition: before entering Stage 5, re-derive each Stage 1 stage goal and acceptance criterion and confirm every requirement maps to a spec requirement plus task with no dropped design goal/boundary and no internally contradictory fix — an uncovered requirement returns to Stage 4 instead of passing on "looks done". Adapted from stellarlinkco/skills `harness`/`code-review` (clean-room, with author permission).

## [0.6.0] - 2026-06-18
- Add a cross-run "Loop Accountability" section (meta-loop dimension 6): a committed, append-only catch-rate log (`docs/stage-pipeline-log.jsonl`) records per-run `gate_net_catch` (findings the independent Stage 4.5 verifier overturned that Stage 3 review and `openspec status` missed), rounds, residuals, regressions, and cost.
- Define a kill criterion (≥5-run minimum sample; retire or narrow the gate if `gate_net_catch` ≈ 0) and a ratchet rule (promote a finding-class recurring across ≥2 runs into a permanent openspec/lint/CI check), so the gate keeps earning its cost and resolved issues become invariants.
- Scope explicitly to organizational accountability only — no Reflexion-style cross-change learning — to avoid importing bias across unrelated changes.

## [0.5.0] - 2026-06-18
- Harden Stage 4.5 trigger reliability (meta-loop dimension 8): forbid skipping straight from Stage 4 to Stage 5, require per-round acknowledgement tokens (`round <N>: started` / `verdict ...`) as auditable proof the gate ran, and honestly document that a portable doc-skill cannot install a host-repo pre-commit/pre-PR hook — per-project skip-rate stays an audited open question.
- Rework severity gating (meta-loop dimensions 1 + 4): P0 is the blocking band that drives the loop; P1 becomes a non-blocking carry band — still fixed opportunistically each round but no longer blocks exit or forces extra rounds. Exit gate is now "P0 cleared + P1 resolved-or-carried-to-issue", removing the prior "until clean" non-convergence smell.

## [0.4.0] - 2026-06-18
- Replace the single review→fix pass with a bounded verification loop: Stage 4 now resolves both P0 and P1 findings, and a new Stage 4.5 independent verification gate adversarially confirms each finding is resolved (default `unresolved` without evidence) and delta-scans for regressions in touched artifacts.
- Loop back to Stage 4 while any P0/P1 stays `unresolved`/`regressed`, capped at 3 rounds; on cap or convergence, residual findings are recorded into the issue body with a `needs-followup` marker instead of being silently dropped.
- Add the `verifier` subagent (`verify-review-fixes`) as a Stage 4.5 dependency that must not be the fixer; update pipeline diagram, skip strategy, and quick reference accordingly.

## [0.3.0] - 2026-06-15
- Add `grill-with-docs` as the Stage 2 domain-modeling pass: align terminology against `openspec/glossary.md` and persist long-lived decisions to `docs/adr/` while writing design/specs.

## [0.2.0] - 2026-06-15
- Integrate the `grill-me` skill as an optional pre-OpenSpec design stress-test gate between Stage 1 and Stage 2.
- Migrate Stage 3 review execution from the `codeagent`/`codeagent-wrapper` CLI to the orchestrator's native parallel subagents (`reviewer`), aligning with `subagent-workflow`. Drop `codeagent-wrapper` from requirements and the `codeagent` tag.
- Rename stale references from `codex-codeagent-workflow` to `subagent-workflow` (dependency note, When-Not-To-Use, implementation-ready contract, quick reference).

## [0.1.0] - 2026-05-25
- Initial canonical package for the stage-change pipeline.
- Converts design-stage context into OpenSpec changes, parallel Codex review, fixes, and fine-grained GitHub issues.
- Includes small-PR issue splitting rules based on module, ownership, dependency, and verification boundaries.
- Documents how Stage 3 aligns with `risk-adaptive-cross-review` OpenSpec review semantics.
- Documents reuse points for `clarify`, `future-aware-architecture`, `implementation-planning`, `project-documentation`, and `gh-create-issue`.
- Adds an Implementation-Ready Issue Contract so downstream implementation workflows should not need requirements clarification.
- Requires `Implementation Ready: yes` on generated sub-issues before they can enter `codex-codeagent-workflow`.
