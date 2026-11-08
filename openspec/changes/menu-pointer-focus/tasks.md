# Tasks

## 1. Preserve native menu focus

- [x] 1.1 Author one native disabled-Delete regression in the existing menu browser file; parent qualifies semantic RED against unchanged source with actual mouse coordinates and document focus, preserving screenshot/zero-noise evidence.
- [x] 1.2 Apply the smallest existing-handler correction; verify GREEN, then add padding and enabled-action/native-title compatibility coverage. Preserve all existing menu behavior and add a patch changeset.
- [ ] 1.3 Run both complete menu browser files against a fresh production build under the accepted issue79 verification exception, existing menu component tests/per-file coverage, scoped static checks and required CI. Review the full diff; merge and sync/archive after acceptance.

## Risk packs

- Concurrency / shared state / ordering — selected: native mouse-focus default precedes later keyboard routing; tasks1.1–1.3 prove focus and enabled click ordering, and existing submenu coverage remains.
- Legacy compatibility / examples — selected: existing enabled actions, stale-session gates, title-input native behavior and submenus must remain intact; tasks1.2–1.3 browser controls and existing component suite.
- Error handling / rollback / partial outputs — selected: disabled presses must not mutate or leave an unusable open menu; tasks1.1–1.2 assert map/history unchanged and Escape dismissal. Revert is atomic; no data rollback needed.
- Documentation / migration notes — selected: spec delta and patch changeset describe the user-visible correction, tasks1.2–1.3. No migration.
- Public API / CLI / script entry — not selected: no exported signature or script change; existing menu-local event boundary only.
- Config / project setup — not selected: no configuration/timeout/retry change; reuse existing production verification path.
- File IO / path safety / overwrite — not selected: no file or persistence logic changes; browser fixtures reuse existing isolated seeding.
- Schema / columns / units / field names — not selected: no representation changes.
- Auth / permissions / secrets — not selected: no credential or authorization surface.
- Resource limits / large input / discovery — not selected: constant-cost event prevention; no allocation/discovery or workload change.
- Release / packaging / dependency compatibility — not selected: no dependency/build changes; patch changeset is covered by documentation pack.
