# Tasks

## 1. Separate trigger ownership without changing checks

- [x] 1.1 Add the process decision, remove weekly.yml's PR path filter, move its unchanged mutation job into mutation.yml with the specified PR paths and retained weekly/manual triggers; keep permissions, pins, budgets, commands, artifacts and required checks unchanged.
- [x] 1.2 Update AGENTS enforcement rows, constraints mutation-workflow description and architecture mutation-trigger prose. Run unchanged guardrails, docs, decisions and format checks; strict OpenSpec validation.
- [x] 1.3 Parent captures real config-only PR discovery/d4-negative evidence and stryker-only mutation discovery at exact probe heads, records their one-file diff inventories, closes owned unmerged probes and preserves their logs. Complete full-depth review and exact-head required CI before normal merge.
- [x] 1.4 After merge, close issue #65 and synchronize/archive the fixture separately.

## Risk packs

- Public API / CLI / script entry — selected: PR/schedule/manual entrypoints; task1.3 real GitHub jobs plus full-depth event-definition review. Scheduled default-branch execution is not falsely claimed before merge.
- Config / project setup — selected: workflow relocation and constraints mirror; task1.2 unchanged guardrails and task1.3 native PR runs.
- Auth / permissions / secrets — selected: retain contents:read and pinned actions, no pull_request_target or executable PR interpolation; task1.3 review. Probe negative settings stay on owned unmerged branches, never main.
- Concurrency / shared state / ordering — selected: workflows must not duplicate mutation or couple guardrail discovery to it; exact-head probes and whole-job move comparison, task1.3.
- Resource limits / large input / discovery — selected: unfiltered cheap checks, native bounded mutation path list, unchanged timeouts; task1.3 actual discovered jobs and review. No API-based changed-file pagination layer.
- Legacy compatibility / examples — selected: existing weekly/manual paths, job names/steps/artifacts and required checks preserved; tasks1.1–1.3 and main mutation contract review.
- Error handling / rollback / partial outputs — selected: expected d4 failure remains observable; no threshold bypass, mutation timeout remains reported under #88; task1.3 logs and disposable-probe cleanup.
- Documentation / migration notes — selected: decision and existing mirrors; task1.2 docs/decisions/format, owner acceptance for AGENTS/governance updates before merge.
- File IO / path safety / overwrite — not selected: no application or data-path IO; workflow files are fixed repository paths, artifacts use the existing path unchanged.
- Schema / columns / units / field names — not selected: no persisted format or config schema migration; constraints description changes only.
- Release / packaging / dependency compatibility — not selected: no dependency/package changes; existing install/setup copied without version changes.
