# CONTEXT.md

> Project identity, bounded contexts, and business invariants for this repository.
> `AGENTS.md` is the operating contract; `openspec/glossary.md` defines the domain vocabulary; this file defines the domain boundaries and invariants that agents must respect when applying both.

## Project Identity

AI 驱动的思维导图生成器 — 输入一句话，让想法自动生长成结构化导图。给"想法先行、结构后补"的人用：用户给一颗种子，AI 负责长枝叶，用户负责修剪。

- **Primary users / consumers**: 个人知识工作者（学习笔记、读书拆解、头脑风暴、方案提纲）
- **Business goal**: 以"节点级持续生长 + 流式呈现"区别于一次性生成的 AI 导图工具；支持 Claude、OpenAI 兼容接口与本地开源模型
- **Lifecycle**: 几年，正式产品（L4 constraints）

## Domain Language

Canonical terms and their prohibited aliases live in `openspec/glossary.md`. Read it before naming a domain concept; never define a term here.

## Bounded Contexts

| Context                           | Owns                                                                                                          | Key terms (defined in `openspec/glossary.md`) | Forbidden logic                      | Integration boundary                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| map (`src/contexts/map/`)         | MindMap tree, TreeOp reducer, undo grouping, layout model                                                     | MindMap, MindNode, TreeOp                     | provider calls, persistence, auth    | consumes TreeOps from ai via `acl/ai.ts`; hands read-only snapshots to export |
| ai (`src/contexts/ai/`)           | Provider port + adapters, prompt assembly, capability router, quota accounting                                | Provider, Grow, TreeOp (emits)                | tree mutation, UI state, key storage | emits TreeOps only; reads credentials through an account port                 |
| account (`src/contexts/account/`) | identity/session, encrypted user-supplied provider credentials, map persistence under RLS, daily quota ledger | —                                             | AI calls, tree logic                 | exposes repositories to map and ai application layers                         |
| export (`src/contexts/export/`)   | PNG/SVG/Markdown/OPML serialisers                                                                             | MindMap (read)                                | mutation of any kind                 | pure functions over a MindMap snapshot                                        |

## Core Invariants

- A MindMap is mutated only by applying a TreeOp through the map reducer; no code path writes tree state directly (decision 0003).
- Every AI session is one undo unit: one undo restores the tree to its pre-session state.
- A Provider's output is validated against the TreeOp schema before it touches the tree; invalid output is rejected, never "repaired" silently.
- API keys (platform or user-supplied) exist in plaintext only in server memory for the duration of one request; never in the client bundle, logs, or database.
- Map reads and writes go through Supabase RLS as the authenticated user; the service-role key is never used for user data access.
- Each user's AI usage is accounted per day; a request over quota is refused with 429 before any provider call.
- Exports are pure: the same MindMap snapshot yields byte-identical Markdown/OPML output.

## Public Interfaces and Contracts

| Interface                      | Contract source                                            | Backward compatibility rule                                            | Test seam                                                 |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| HTTP API (`/api/*`)            | `schemas/openapi.yaml`                                     | additive changes only; a removed or renamed field is a versioned route | `tests/contract/openapi-snapshot.test.ts`, `smoke/*.hurl` |
| TreeOp protocol                | `src/contexts/map/domain/` (Zod schema, to be added in M1) | additive only; new op kinds need a decision record                     | map domain unit tests                                     |
| Export formats (Markdown/OPML) | `src/contexts/export/`                                     | existing output stays byte-stable; changes are snapshot-reviewed       | export snapshot tests                                     |

## Forbidden Logic & Irreversible Operations

Captured verbatim from grilling; agents must check this section before writing code that deletes data, mutates schemas, or crosses a listed boundary.

| Rule                                                                   | Scope                                  | Why                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 不得改弱门禁来让自己通过（调低阈值、加 eslint-disable、skip 测试都算） | all gates in `constraints.yaml`        | a gate relaxed to fit a change is the failure the control plane exists to prevent; needs its own decision record |
| Tests and CI never call a real paid AI key                             | `tests/`, `e2e/`, `.github/workflows/` | billing incidents; use the mock provider or recorded fixtures                                                    |
| No destructive database operation against any non-local environment    | `drop`, `truncate`, migration rollback | user data is irreversible                                                                                        |
| No production deploy, force-push, or `--no-verify` by an agent         | git + deploy                           | provenance and gate integrity                                                                                    |
| 本人只验收功能，不审核代码 — the owner's gate is functional acceptance | governance                             | code review is performed by agent cross-review (decision 0001)                                                   |

## Open Terminology Questions

| Question                                                  | Why it matters                                                | Candidate terms                    | Owner            |
| --------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- | ---------------- |
| What is the name for the three AI entry modes as a group? | PRD calls them "模式"; code will need an enum                 | InteractionMode, AiMode, EntryMode | owner, before M3 |
| Is "文本导入" a fourth mode or a Provider request type?   | decides whether it lives in ai/application or map/application | Import, Distill                    | owner, before M5 |
