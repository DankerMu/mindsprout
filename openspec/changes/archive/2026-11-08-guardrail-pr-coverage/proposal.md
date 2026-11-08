# Proposal

## Why

Issue #65 identifies a discovery gap: configuration-only PRs can miss the guardrail self-test because its workflow shares a narrow path filter with mutation testing. The existing self-tests detect invalid gate settings, but cannot do so when the workflow never starts.

## What Changes

- Remove the PR path filter from the existing weekly harness workflow so its guardrail and AGENTS liveness jobs run on every PR.
- Move the existing mutation job, unchanged, into a dedicated workflow with weekly/manual triggers and a narrow native PR path filter for its runner, dependencies, runtime and workflow configuration.
- Keep all test content, thresholds, job permissions, action pins, timeouts, artifact behavior, aggregate required checks and branch protection unchanged.
- Record the trigger-separation decision and align existing enforcement/architecture prose and the constraints mutation-workflow description.

## Capabilities

### New Capabilities

- `harness-triggers`: reliable PR discovery of guardrail checks, separated from mutation's scoped PR triggers.

### Modified Capabilities

None; the existing mutation execution/report contract remains unchanged.

## Impact

.github/workflows/weekly.yml, one new mutation workflow, AGENTS.md enforcement rows, constraints.yaml mutation description, docs/engineering/architecture-discipline.md and one process decision. No application, dependencies, guardrail test cases or Stryker configuration changes.

## Fixture triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent; workflow/constraints Critical Paths and gate-discovery behavior require expanded.
Blast radius: a wrong event filter silently omits checks; moving jobs incorrectly can duplicate work or lose weekly/manual coverage.
Selected risk packs: Public API / CLI / script entry; Config / project setup; Auth / permissions / secrets; Concurrency / shared state / ordering; Resource limits / large input / discovery; Legacy compatibility / examples; Error handling / rollback / partial outputs; Documentation / migration notes.
Evidence floor: unchanged local guardrails75/0; genuine config-only PR checks and deliberately mismatched d4 failure; stryker-only PR mutation job discovery; strict fixture, docs/decisions/format, exact-head CI and full-depth review. Existing #88 runtime timeout is not fixed or hidden here.
