# Changelog

All notable changes to this skill will be documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-09-14

### Changed

- Dropped the references to `subagent-workflow`'s `review_gate.py` ledger CLI (removed in that skill's 0.36.0): seat caps inside the workflow are applied by the orchestrator at spawn time, and the severity crosswalk names the workflow's evidence vocabulary without CLI flags. No contract change.

## [0.6.0] - 2026-09-05

### Added

- `finding-contract.md` gains a conditional **Lens** field: cross-review seats name the single lens id whose checklist produced the finding (a paired `a+b` seat still names one lens). `subagent-workflow` 0.33.0 already asked reviewers for it in the brief; making it a contract field means the loop-log `catches[i].lens` attribution has a canonical source instead of a workflow-local extension. Design reviews and `review` runs have no seats and omit it; the `reviewer` agent's operating guide lists it as item 11.

## [0.5.0] - 2026-09-05

### Changed

- **Reviewer set becomes a seat plan with hard caps; the six-reviewer high-risk set is gone.** A seat is one parallel reviewer carrying one lens or a `a+b` lens pair whose checklists are inlined together. Defaults: low 1-2 seats (`correctness+test-evidence`, plus `integration`/`security-perf` only when touched); medium 2-3 seats, cap 3; high exactly 4 seats — `correctness`, `invariant-state`, `test-evidence+spec-compliance`, `security-perf+integration`. Hybrid Review no longer adds seats for the fixture. Motivation, from four repos' `review-loop-log.jsonl` (NWM 523 lines, xagent 138, yd-viewer 22, open-workbuddy-web 14; 2026-08/09): the "escalate to 6" trigger list was the definition of `high`, so 6 was the de facto default (NWM 45/58 high PRs, xagent 28/29, owb-web 11/11); in six-seat round 1 at least one lens produced a P0/P1 in only 30/48 (NWM) and 15/31 (xagent) rounds; `integration` had the lowest catch-per-run in all four repos (0.25/0.09/0.17/0.17 at high); `spec-compliance` catches were mostly P2 (NWM 22/124 P0/P1) and near-zero outside spec-heavy projects; `invariant-state` was low-volume but carried the highest P0/P1 share (NWM 19/29, owb-web 9/13). Expanded-level rounds were also running 6 seats against a written cap of 4 (xagent 17/34, yd-viewer 8/16), which is why the cap is now mechanical downstream (`subagent-workflow` 0.33.0 `review_gate.py record-round --lenses`).
- `reviewer-packages.md` gains the canonical **lens id** table (`correctness`, `integration`, `security-perf`, `test-evidence`, `spec-compliance`, `invariant-state`) — the vocabulary loop logs, gate ledgers, and seat lists must use. A finding is attributed to the single lens whose checklist produced it, never to a pair.
- Frontmatter description unchanged (eval-tuned in 0.4.1); the lens names it lists are still the lens names.

## [0.4.2] - 2026-07-23

- Severity Crosswalk 补上自家下游的词表映射：`subagent-workflow` ledger/CLI（`review_gate.py --highest`、round-ledger、gate 规则）的 `critical|major|minor|none` ↔ 本契约 P0/P1/P2/Note（Note 无 ledger 表示，`none` 表示 clean 轮而非 Note）。此前该映射只是隐式约定——外来词表（review/entropy-review）都有 crosswalk，唯独最重的消费方没有；0.29.0 的 P2 延期默认规则以严重度分流修复经济学，映射从此是承重的，写死在 canonical 处，工作流侧只指针引用。

- Tighten the hybrid trigger description from 489 to 387 characters (slimming batch 6), eval-gated by the new cross-skill routing suite (`skill-lifecycle-manager/eval/cross-skill-routing-cases.json`): three A/B runs, zero per-case routing regressions, candidate 27/27 on the final run (deepseek-v4-pro-guan judge via dmxapi). All negative redirects preserved.

## [0.4.0] - 2026-07-02
- Add a **Severity Crosswalk** section to `finding-contract.md` mapping sibling pack vocabularies into the canonical P0/P1/P2/Note: `review` P0/P1/P2 map 1:1 and P3/Nit → Note; `entropy-review` E0 → P1 (P0 when it breaks a selected risk-pack invariant), E1 → P2, E2 → P2, E3 → Note; plus a dimension→failure-class map (naming drift → `conventions`, error-model fork → `contract`, state split → `state-transition`, duplication → `reuse`, dependency-direction violation → `altitude`). Lets consumers fold sibling grades into this contract without re-deriving them.
- Add `invocation_posture: hybrid` to `SKILL.md` frontmatter, matching the sibling `review` and `entropy-review` skills.
- Fix the under-specified output template: each finding now points at all ten finding-contract fields instead of four, and the merge-blocking field list in `SKILL.md` adds the missing **Consequence**.
- Give Risk Triage a concrete Low/Medium discriminator — Medium when the change touches more than 3 files, more than one module, or any public/exported API; otherwise Low — so the mandatory removed-behavior audit (`reviewer-packages.md`) no longer flips on a fuzzy boundary. High enumeration unchanged.

## [0.3.0] - 2026-06-18
- Add a closed **Failure-Class Vocabulary** to `finding-contract.md` (implementation/code classes plus spec/OpenSpec-artifact classes plus `other`) so the `Failure class` field draws from a whitelist; this makes dedup, failure-class synthesis, and cross-run logging consistent across reviewers and the workflows that consume this skill. Adapted (clean-room, with author permission) from the stellarlinkco/skills `code-review` category taxonomy and broadened to cover the OpenSpec review modes.
- Add a **Reject When (Precision Gate)** to `finding-contract.md`: explicit precision rules (no speculative/unanchored/style-only findings; no "add guards" without naming the failing input and wrong result; no race without naming shared state and concurrent access) that turn weak items into non-blocking notes instead of blocking findings.
- Add an **Oracle Integrity** rule to `finding-contract.md`: the spec/fixture, acceptance criteria, existing tests, and project rules are the immutable oracle a finding is measured against — never weaken them to clear a finding, and a merge/exit gate is a deterministic check against that frozen oracle, not a "probably fine" verdict.
- Add a **Gap Sweep** step to `SKILL.md` synthesis: one final clean-slate pass for real defects the recall-biased first passes systematically miss (removed behavior, contract drift, boundary/error/async/auth/migration/cache/wrapper paths), verified through the same standard and the Reject When gate. Wire the vocabulary, precision gate, and oracle rule into the Finding Contract pointer.
- Drop the stale `codeagent-wrapper` dependency (skill.json `requirements.tools`) and the `codeagent-wrapper --backend codex` parallel-execution instruction in `SKILL.md`, replacing it with the orchestrator's native parallel-subagent mechanism and a read-only reviewer-leaf boundary. This aligns the canonical review skill with the native-subagent migration already done in `subagent-workflow` and `stage-change-pipeline`, which consume it.

## [0.2.0] - 2026-06-18
- Add a "Cross-Cutting Review Lenses" section to `reviewer-packages.md`: change-triggered lenses (removed-behavior audit, wrapper/proxy faithfulness, altitude/ownership) that named reviewers apply on top of pack scope, each tagged with owning reviewers, triggers, and failure classes, and bound to the existing finding contract. Adapted (clean-room, with author permission) from the stellarlinkco/skills `code-review` finder angles.
- Promote the detailed per-reviewer checklists into `reviewer-packages.md` as the canonical "Reviewer Checklists" (Correctness, Integration, Security/Performance, Test & Evidence, Spec Compliance, Invariant/State-Machine/Compatibility), so workflows inline them instead of forking their own copies. This is the single source `subagent-workflow` Phase 4 now consumes.
- Wire the lenses into `SKILL.md` reviewer-pack guidance and into the per-reviewer prompt requirements.

## [0.1.1] - 2026-06-15
- Update stale cross-reference: `codex-codeagent-workflow` -> `subagent-workflow` (skill renamed).

## [0.1.0] - 2026-05-25
- Initial risk-adaptive cross-review skill.
- Supports PR/diff/branch review and OpenSpec/stage-change review modes.
- Adds reviewer-pack selection, actionable finding contracts, and failure-class synthesis references.
