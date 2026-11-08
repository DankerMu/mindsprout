# Proposal

## Why

Main's aggregate required check accepts any source (`app_id: null`), unlike the other two required checks. Issue #64 closes that source-authentication gap without changing which checks are required or administrator bypass policy. The owner approved source pinning in issue comment 6716084660.

## What Changes

- Pin `All checks passed` to GitHub Actions app 15368 through the narrow required-status-checks endpoint.
- Preserve both existing pins, all three context names, strict up-to-date checks and every other branch-protection setting.
- Record the accepted policy and update the branch-protection summary in AGENTS.md and its existing detail page. Keep constraints.yaml's context-name list unchanged; no consumer/schema migration is needed.

## Capabilities

### New Capabilities

- `required-check-sources`: required check provenance and preservation of the existing main protection policy.

### Modified Capabilities

None.

## Impact

Remote classic branch protection, one implemented process decision, AGENTS.md Enforcement Index and docs/engineering/enforcement-index.md. No workflow, application, package or test changes; no forged status/check probe.

## Fixture triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent; auth/permissions and remote shared policy require expanded.
Blast radius: replacing the wrong checks or protection fields could weaken the merge gate or block legitimate PRs.
Selected risk packs: Public API / CLI / script entry; Config / project setup; Auth / permissions / secrets; Concurrency / shared state / ordering; Legacy compatibility / examples; Error handling / rollback / partial outputs; Documentation / migration notes.
Evidence floor: before/after protection snapshots and semantic equality except the single app_id; real Actions check provenance and required-check success on this PR; docs/decisions/format/guardrails; full-depth review and owner-approved policy.
