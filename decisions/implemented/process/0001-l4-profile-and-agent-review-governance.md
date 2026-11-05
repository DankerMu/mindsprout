---
id: 0001
title: L4 strictness with agent cross-review as the code gate
kind: process
status: implemented
date: 2026-11-05
---

# L4 strictness with agent cross-review as the code gate

Status: active

## Problem

MindSprout is a years-lifecycle product whose code is written mostly by AI agents (Claude Code, Codex). The owner's stated position, verbatim: "本人只验收功能，不审核代码". Human review attention is the scarce resource; agents comply with mechanical gates far more reliably than with prose.

## Decision

- Engineering constraints run at **L4 maximal** (`constraints.yaml`): 700-line files, complexity 10, 90% per-file coverage, 2% duplication, TDD required, real-DB integration, E2E required, secret scan + SAST blocking, changesets releases, PR diff ≤ 400 lines CI-enforced.
- The **human gate is functional acceptance**: the owner clicks through / watches the E2E evidence and accepts the feature.
- **Code review is performed by agents**: every PR gets the `risk-adaptive-cross-review` pass (reviewer + verifier subagents from the `agentic-issue-delivery` pack). Critical paths (`AGENTS.md ## Critical Paths`) require that pass at full depth; elsewhere gray-box review (contracts + runtime evidence) suffices.
- Branch protection requires the `All checks passed` status check and linear history; it does **not** require a human approving review.

## Alternatives considered

- **L3 strict with human white-box review of critical paths** — lost: the owner will not review code, so a human-review requirement would be either bypassed or a permanent blocker.
- **Required approving review from a bot account** — lost: adds an identity to manage for no additional assurance beyond the agent cross-review already recorded in the PR.
- **L2 standard** — lost: with no human reading diffs, weaker mechanical gates leave nothing between an agent mistake and `main`.

## Consequences

- Two recorded downgrades from the L4 column (`constraints.yaml strictness_profile.downgrades`): required human review → agent cross-review + status checks; critical-path human white-box review → agent cross-review at full depth + owner functional acceptance.
- Any weakening of a gate is itself a decision record, never a PR side effect (`AGENTS.md ## Agent Operating Rules`).
- Reintroduce human code review if a reviewer with review capacity joins; this record is then superseded, not edited.
