# Design

## Context

The repository uses classic main branch protection. The owner approved pinning the aggregate check and retaining strict=true and enforce_admins=false; approval is recorded in #64 comment 6716084660. Current check runs identify GitHub Actions as app 15368.

## Goals / Non-Goals

Change surface: `branches/main/protection/required_status_checks`, an implemented process decision, AGENTS.md's branch-protection enforcement row, and the existing enforcement detail page.
Must preserve: exactly three current context names; existing app15368 pins; strict=true; enforce_admins=false; linear history; force-push/deletion restrictions; all unrelated remote fields; constraints.yaml's existing context-name schema and all workflow behavior.
Must change: only `All checks passed` app_id from null to15368, plus documentation of that policy.
Governing invariant: only the intended aggregate-check source changes; legitimate GitHub Actions checks continue satisfying the same three required checks.
Sibling surfaces: remote checks and contexts projections, check-run producer app identity, required-check evaluation on the PR, constraints.yaml context inventory, AGENTS summary and enforcement detail.
Non-goals: enforce_admins changes, rulesets migration, workflow redesign, optional periodic drift audit, dependency changes or fabricated commit statuses.

## Decisions

Use the narrow PATCH endpoint with strict=true and the full current three-entry checks list. Never PUT the full branch protection document or update the contexts-only endpoint.
Author the owner-approved decision before remote mutation. The parent owns API operations; the implementer changes only the decision and documentation, without commits or tests mid-flight.
Immediately before PATCH, reread full protection and compare it with the captured baseline; changed policy stops the write for reconciliation. Resolve app15368 from real check-run evidence, not from an invented producer.
After PATCH, GET full protection and compare parsed objects (normalize check/context ordering only): the aggregate app_id is the sole permitted difference. Preserve all other fields exactly.
On API failure or uncertain transport outcome, read authoritative state before deciding whether any action is needed; never blindly retry, overwrite concurrent changes or automatically restore an unpinned source. An unexpected post-state blocks merge and is reported.
Rollback is a separately approved policy change; reverting documentation does not undo remote settings. Do not weaken protection to make this PR pass.

## Required evidence

- Baseline GET shows aggregate app_id=null, other pins15368, strict=true, enforce_admins=false; real check runs show producer github-actions/15368.
- Post-PATCH GET shows all three15368; semantic full-object comparison allows only the aggregate app_id change.
- On this PR's final head, the genuine aggregate check succeeds with app15368 and `gh pr checks --required` passes all three; merge succeeds under unchanged protection, with no admin bypass.
- `pnpm docs:check`, `pnpm decisions:check`, `pnpm fmt:check`, `pnpm test:guardrails` pass. No application tests required for this remote-policy/docs-only surface.
- Review focuses on endpoint/payload scope, preserved policy, provenance evidence and accurate documentation. No test emits a spoofed status.

## Risks / Trade-offs

A mistaken source ID could leave checks Expected; actual check-run provenance and this PR's successful required checks prove compatibility. Administrator bypass remains intentionally unchanged; this fix authenticates non-admin required-check sources, not every merge actor.
