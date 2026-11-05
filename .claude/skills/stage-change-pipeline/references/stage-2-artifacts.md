# Stage 2 详细步骤：OpenSpec Artifact 逐个生成

> 由 [stage-flow.md](stage-flow.md) Stage 2 引用。目标与不可协商项（Grill 清单强制输入、seams 必须落 design.md、4/4 complete）在该文件；本文件只承载逐 artifact 的操作细节。

## 命令骨架

```bash
openspec new change "<stage-name>"
openspec status --change "<name>" --json   # 获取构建顺序
# 每个 artifact 撰写前取指令（artifact ∈ proposal | design | specs | tasks）：
openspec instructions <artifact> --change "<name>" --json
```

## 按依赖顺序生成

**proposal.md**（第一个，无依赖）：

- 基于设计文档写 Why / What Changes / Capabilities / Impact
- Capabilities 部分的每个 capability 用 kebab-case 命名，后续会生成对应 spec

**design.md**（依赖 proposal）：

- 写技术决策（选型理由、备选方案）、风险和缓解
- **`## Goals / Non-Goals`（模板自带，Non-Goals 必须填实）**：本 change 明确排除的工作——出了目的地的东西，不是"以后再做"的雾；grill 清单里被用户划出范围的分支落这里。没有就写"无"
- **`## Not yet specified`（必须有）**：范围内、能看见要来但现在还说不清问题的工作。判据是"能否精确说出问题"而不是"能否回答"——问题已清楚但答案未定的写 open question，问题本身还模糊的才进这里。它比 task 粗，一块雾可能日后化成几个 task 也可能一个都不成，所以一律不预切进 specs/tasks；等后续 change 的前沿推到它再毕业。没有就写"无"
- 如果技术决策还没有稳定依据，先用 `future-aware-architecture` 形成架构决策输入
- 领域概念多、术语易漂时，用 `grill-me` docs 模式对齐术语并 inline 沉淀到 `openspec/glossary.md`/`docs/adr/`，再定稿 design/specs
- **Sketch seams under test**（自动，不设交互停点）：写下测试将行使的公共边界——优先已有 seam、用最高的 seam、越少越好（理想一个），每个 seam 附一行选择理由，直接记入 design.md。监督走既有回路：Stage 3 三路审核与下游 fixture review 会检查该清单，无需专门向用户确认。清单随 fixture 流入 `subagent-workflow`（fixture 模板的 `Seams under test` 字段），实现期只消费、不再谈判——测试精力据此落在关键路径而非每个边角

**specs/**（依赖 proposal，可与 design 并行）：

- 为 proposal 中列出的每个 capability 创建 `specs/<capability>/spec.md`
- 每个 spec 包含 `## ADDED Requirements`，每个 Requirement 下有 `#### Scenario:` 用 WHEN/THEN 格式
- capability 数量多时（>4），用并行 agent 分批写入

**tasks.md**（依赖 design + specs）：

- 按 capability 分组，每个任务用 `- [ ] X.Y 描述` 格式
- 任务粒度：单个 session 可完成；任务顺序：按依赖关系排列
- 只切已明确的工作：design.md `## Not yet specified` 与 Non-Goals 里的条目不得出现为 task（Stage 3 Review 3 核对）
- **每个 task 组尾部写两行契约声明**（Stage 5 宽度门禁的输入，在此产出、受 Stage 3 Review 3 审核、Stage 5 只消费不发明）：
  - `Suggested fixture level: <none|compact|expanded> - <一行理由>`——词表以下游 `subagent-workflow` 的 `issue-risk-contract.md` 为单一事实源
  - `Minimal mergeable slice: <首刀描述>` 或 `Minimal mergeable slice: atomic - <理由>`——最小可独立合并保绿的子集（模块/文件级 + 一行为何它能独立保绿）；`atomic` 必须给具体理由，不是省事默认
- 如果任务依赖、验证或回滚路径复杂，先用 `implementation-planning` 产出执行计划，再写 tasks

## 收尾验证

```bash
openspec status --change "<name>"
grep -q '^## Not yet specified' "openspec/changes/<name>/design.md" && grep -q '^## Goals / Non-Goals' "openspec/changes/<name>/design.md" || echo "fog 两节缺失"
```

确认 4/4 artifacts complete 且 fog 两节都在（缺了先补，不要拿一轮 Stage 3 审核去发现一个 grep 能说的事），然后回 SKILL.md 进入 Stage 3。
