# Stage 5 / 5.5 详细步骤：Issue 分组、创建与对齐审核

> 由 [stage-flow.md](stage-flow.md) Stage 5 / 5.5 引用。实现就绪契约的字段清单、规划门禁与两个可拆性字段的语义在该文件；本文件承载分组原则、创建步骤、issue 正文模板与对齐审核维度。

## 分组原则

- 不设置子 issue 数量上限；数量由模块边界、依赖关系和可审阅 PR 体量决定。用 Epic 保持总览，不通过合并子 issue 来压低数量。
- 每个子 issue 只覆盖一个模块、包、服务、目录边界或 ownership 边界。禁止一个实现 issue 同时修改数据库、后端 API、前端 UI、CI、文档生成等多个模块。
- 按"可独立实现和验证的模块内交付物"分组。一个子 issue 应包含 1-3 个紧密相关的 tasks；如果 tasks 会形成大 PR，继续拆分。**1-3 是上限不是许可证**：它约束 task 计数、不约束工作量，一个粗 task 撑爆的 issue 同样违规——粒度的实际下限由下面的宽度门禁给出。
- **单一验证路径**：一个子 issue 的全部验收标准应当能由**一条**验证路径证明（同一测试套件 / 同一条验证命令 / 同一个手工验证流程）。需要两条及以上互不重叠的路径才能全部证明，就按验证路径切分，除非写 `Width exception: multi-path - <理由>`。只数证明验收标准所需的路径，lint/build/format 等 hygiene 检查不计入。这是"小 PR"唯一可证伪的判据；行数和文件数都太容易被自圆其说。
- 跨模块能力必须拆成多个子 issue，用 `Dependencies` 串联：先创建共享契约或接口准备 issue，再分别创建各模块实现 issue，最后创建必要的集成验证 issue。
- **宽改造（wide refactor）例外**：单一机械改动（改列名、改共享类型）爆炸半径横跨全库、任何模块内切片都无法独立保绿时，不按模块硬切，改用 **expand–contract** 三段拆分——先建"新旧并存"的 expand issue；再按爆炸半径（按包/目录）分批迁移调用点，每批一个 issue 且 `Depends on` expand issue，旧形态仍在故 CI 逐批保绿；最后一个 contract issue 在无调用者后删除旧形态，`Depends on` 全部迁移批次。批次也无法独立保绿时，各批共享集成分支，绿灯只在最终 integrate-and-verify issue 承诺。
- 只有当多个 task 位于同一模块、同一 owner、同一验证路径，且拆开会制造无意义阻塞时，才允许合并——**且必须写 `Width exception: merged-tasks - <理由>` 留痕**。与 `atomic` 声明对称：省事地合并和省事地宣称原子，都要举证。
- 不以 capability 名称机械合并 issue；同一 capability 可以拆成多个模块 issue，不同 capability 也只有在同一模块内强耦合时才可合并。
- 依赖允许的前提下，issue 排序按决策密度前置：数据模型、接口契约、用户可见流程的 issue 排在 DAG 前面，机械重构殿后——让人工 review 注意力落在最可能被调整的部分（与 `implementation-planning` 0.2 的 phase 排序原则一致）。
- 每个 issue 必须包含：任务清单、必读文档表、验收标准。

## 创建步骤

1. 创建标签（如 `epic`, `sub-task`, `priority:high`, 阶段标签如 `m0`）：

   ```bash
   gh label create <name> --color <hex> --description "<desc>" --force
   ```

2. 创建 Epic issue：概述和交付物表、设计文档引用、子任务占位（后续更新）、依赖关系图。

3. 从 `tasks.md` 生成子 issue 分组：标注每个 task 的目标模块、主要文件/目录、依赖 task、验证方式，并**继承所属 task 组的 `Suggested fixture level` 与 `Minimal mergeable slice` 声明**（Stage 2 产出、Review 3 已审，此处只消费不发明；tasks.md 缺声明属上游缺陷，如实记录并回报，不得现场补写）；将跨模块 task 拆成模块内 task（无法拆分时在 issue 正文说明原因和预期 PR 边界）；检查每个分组是否能由一个小 PR 完成，不能则继续拆分。

3.5. **过宽度门禁**（`stage-flow.md` Stage 5"宽度门禁"，创建前逐个分组执行）：

   - **首刀拆分**：分组的 `Minimal mergeable slice` 不是 `atomic:` 时，把首刀拆成独立 issue，剩余部分作为后继 issue 并 `Depends on #<首刀>`，对剩余部分递归本闸直到它自身 `atomic`。不设数量上限；递归拆出的切片之间按真实依赖连边，互相独立的切片不得机械串成线性链。
   - **验证路径**：验收标准需要多于一条独立验证路径时，按路径切分（hygiene 检查不计入路径）。
   - **合并留痕**：合并多个 task 时写 `Width exception: merged-tasks - <理由>`。
   - 任何一条不执行拆分，都必须在 issue 正文写 `**Width exception:** <触发项> - <理由>`；缺失即门禁未过，不得标 `Implementation Ready: yes`。

4. 为每个分组创建子 issue，正文包含：
   - `Part of #<epic>` 链接
   - 依赖声明：每个依赖单独一行 `Depends on #<dep>`（不要合并成 `**Dependencies:** #a, #b`）——下游 `subagent-workflow` 的 DAG reader 逐行 grep 字面量 `Depends on #NN` 解析依赖图
   - `**Module / Scope:** <module-or-path>` 单一模块或路径范围
   - `**In Scope:**` / `**Out of Scope:**`
   - `**PR Boundary:**` 预期修改范围和明确不包含的相邻模块
   - `**Suggested fixture level:** <none|compact|expanded> - <一行理由>`（继承自 tasks.md task 组声明）
   - `**Minimal mergeable slice:** <首刀描述或 atomic: 理由>`（继承自 tasks.md task 组声明）
   - `**Width exception:** <slice-deferred|multi-path|merged-tasks> - <理由>`（**条件字段**，仅当突破默认粒度时出现；理由须说明为何更细的切法对交付没有价值，而不是"拆开麻烦"）
   - 任务清单（从 tasks.md 提取，保留 checkbox 格式）
   - 必读文档表（从 IMPLEMENTATION_PLAN.md 或 Stage 1 收集的文档清单中提取，标注优先级和重点章节）
   - 验收标准
   - 行为描述遵循 `gh-create-issue` 的 agent-brief 耐久性契约（其 `references/agent-brief.md`，单一事实源）：写接口/类型/行为契约与 `Current/Desired behavior`，不写文件路径与行号——issue 在 DAG 中等待期间，代码结构会被前置 issue 改变
   - `**Implementation Ready:** yes`，仅当契约全部满足时允许创建

5. 回填 Epic 的子任务列表和依赖关系图，按模块分组展示，避免子 issue 数量增加后失去总览。

6. 输出创建结果汇总（issue 编号、标题、模块范围、依赖关系）。

## Stage 5.5 审核维度与流程

| 维度 | 检查内容 |
|---|---|
| missing-coverage | tasks.md 中的 task 未被任何 issue 覆盖 |
| wrong-boundary | 单个 issue 混合了多个模块或 ownership 范围 |
| over-broad | 单模块内过宽——`Minimal mergeable slice` 非 `atomic` 却未拆首刀、验收标准跨越多条独立验证路径、或任务清单含可独立交付子集，且无 `Width exception` 或其理由是"拆开麻烦"一类的省事默认。**这条专补 wrong-boundary 的盲区**：边界正确但体量过大的 issue 此前六个维度全绿放行 |
| wrong-dependency | issue 间依赖链与 task 依赖顺序不一致 |
| scope-mismatch | issue 的 In Scope / Out of Scope 与 task 实际内容不符 |
| missing-reference | issue 缺少 change 中的 spec 或设计文档引用 |
| content-drift | issue 内容（任务清单、验收标准、PR 边界）与 change artifact 矛盾或偏离 |

流程：审核 agent 读取所有 change artifact 和已创建 issue，逐条比对输出结构化对齐缺口（P0/P1）→ 修复 agent 用 `gh issue edit` / `gh issue create` 修复 → 独立验证 agent 确认。P0 + P1 均阻塞，未清则继续，最多 2 轮；残留如实记录到 Epic。
