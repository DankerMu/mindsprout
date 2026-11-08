# Design

## Context

The current weekly.yml runs guardrails, AGENTS liveness and mutation together on a narrow PR path list. #38 and PR #63 are merged. The known advisory mutation timeout (#88) remains independent; source/runtime performance work is outside this change.

## Goals / Non-Goals

Governing invariant: every pull request discovers the unchanged guardrail self-test; mutation discovery cannot suppress it, and each existing job has exactly one implementation.
Must preserve: Guardrail self-test and AGENTS liveness job names/content; mutation job name, command, Node/package setup, action pins, contents:read,30-minute cap and always-upload artifact behavior; Monday06:00UTC schedules and manual invocation; all three protected checks and warn/advisory severity.
Change surface: weekly.yml loses its pull_request paths filter and mutation job; new mutation.yml owns the moved job and scoped native PR discovery. Update existing policy mirrors and an accepted process decision before changing trigger policy.
Sibling surfaces: workflow event filters, job producers and names, schedule/manual entrypoints, read-only permissions, AGENTS enforcement rows, constraints mutation workflow path, architecture TDD prose, main mutation-testing spec.
Non-goals: adding required checks or changing aggregate needs; guardrail test changes; mutation optimization, retries, exclusions, budget increases or threshold changes; dependency upgrades; main protection changes.

## Decisions

Reuse weekly.yml for both cheap jobs with unfiltered pull_request, existing schedule and workflow_dispatch. Move, do not copy, mutation into mutation.yml with the same schedule/manual entrypoints.
Mutation PR paths are stryker.config.mjs, vitest.config.ts, package.json, pnpm-lock.yaml, .tool-versions and .github/workflows/mutation.yml. Native workflow filtering avoids a new runtime path-discovery script, API pagination, permissions or third-party action. It intentionally excludes unrelated application/docs/gate-only edits from PR mutation runs; weekly testing still covers the whole tree.
Keep guardrail and liveness advisory classification; this issue fixes discovery, not branch-protection policy. Required CI remains unchanged.
The parent owns temporary PR probes and records their base/head/diff. These are unmerged verification branches only, never main or another contributor's branch; no extra worktree. No source/code fixture is added to production.

## Verification sequence

1. Treat the issue's demonstrated missing trigger as the diagnosed baseline; do not rerun a known failure merely to confirm it. Author the fixture and obtain review/strict validation before implementation.
2. After the single implementer yields, run unchanged pnpm test:guardrails, docs:check, decisions:check and fmt:check; validate workflow syntax through real GitHub execution. No permanent source-text/wiring tests.
3. Push the implementation PR. Create a temporary child PR based on its reviewed implementation branch whose only changed file is jscpd.json, deliberately setting threshold5 while constraints stays2. Verify changed-file inventory is exactly jscpd.json. Observe Guardrail self-test in real PR checks and its specific d4 parity failure. Retain logs; never merge this negative probe or weaken d4.
4. Create a separate temporary child PR whose only changed file is stryker.config.mjs (inert comment). Observe the genuine Mutation testing job dispatched from mutation.yml at that probe's exact head. Trigger evidence does not claim a completed mutation score; after dispatch evidence is captured, explicitly cancel this disposable probe's remaining runs and close/delete only its owned PR/branch. Keep the normal implementation PR's evidence separate.
5. Use the implementation PR's workflow-only/config diff and passing Guardrail self-test as additional discovery evidence; inspect unfiltered event semantics to cover constraints/dependency-cruiser/other workflow paths without separate identical probes.
6. Close the negative probe and its owned branch after retaining the expected d4 failure. Full-depth review covers every moved line, no dropped steps, all trigger entrypoints, permission preservation and exact-head runtime evidence. Any new required-check failure blocks landing; known advisory #88 is reported separately, never represented as passed.

## Risks / Trade-offs

Every PR adds a cheap guardrail/liveness run, avoiding a growing path allowlist. Mutation PR scope narrows, with weekly full-tree coverage retained. Newly triggered mutation may still hit #88's existing timeout; do not expand this issue into performance tuning or suppress the failure.
Rollback is a normal reviewed git revert of this workflow split; it reintroduces the documented discovery gap and is not a default response to expected negative-probe failure. Schedule events execute on the default branch only; before merge review event definitions, after merge verify registration rather than inventing a cron run.
