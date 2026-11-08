# Tasks

## 1. Approve and apply the bounded policy change

- [x] 1.1 Capture baseline protection and real check-run app provenance; record owner approval in an implemented process decision before mutation. Update AGENTS.md's enforcement row and the existing detail page; retain constraints.yaml and workflows unchanged.
- [x] 1.2 Parent rechecks the baseline, applies the narrow checks-list PATCH and verifies full protection equality except the aggregate app_id. Preserve failure evidence; no blind retry or automatic weakening rollback.
- [ ] 1.3 Run docs, decisions, format and guardrail checks; obtain full-depth correctness, evidence/spec and security review. Observe genuine final-head app15368 checks satisfy all required checks and merge without bypass.
- [ ] 1.4 After merge, close issue #64 and synchronize/archive this change in a separate lifecycle follow-up.

## Risk packs

- Public API / CLI / script entry — selected: narrow GitHub PATCH/GET; evidence task1.2 payload and full-object comparison.
- Config / project setup — selected: remote protection and documentation mirrors; tasks1.1–1.3, guardrails and required-check evaluation.
- Auth / permissions / secrets — selected: trusted app pin and authorized settings operation; owner approval, real producer evidence, no forged status, task1.3 full-depth security review. Never print credentials.
- Concurrency / shared state / ordering — selected: shared remote settings; immediately-before GET must equal baseline, unexpected drift stops mutation, task1.2.
- Legacy compatibility / examples — selected: retain every check/context and other policy field; full before/after comparison and this PR's successful genuine checks, tasks1.2–1.3.
- Error handling / rollback / partial outputs — selected: uncertain PATCH outcome resolved by GET, no blind replay/automatic unpin; task1.2 and read-only review. No deliberate API failure injection against remote protection.
- Documentation / migration notes — selected: accepted decision and existing two policy mirrors; docs/decisions/format, task1.3. No new catalog or guide.
- File IO / path safety / overwrite — not selected: local prose edits use fixed tracked paths; no user-file publication or data overwrite surface.
- Schema / columns / units / field names — not selected: use existing GitHub API schema; constraints.yaml shape unchanged.
- Resource limits / large input / discovery — not selected: exactly three known checks, no unbounded discovery.
- Release / packaging / dependency compatibility — not selected: no dependency/build/release changes.
