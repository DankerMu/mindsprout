# Tasks

## 1. Bind editor loads to the requested identity

- [x] 1.1 Add a native seeded-IndexedDB regression for row A with embedded ID B and a distinct peer B; parent qualifies semantic RED against unchanged source, retaining screenshot/noise evidence.
- [x] 1.2 Reject the mismatch before ready/EditorSession using the existing error state; prove GREEN. Add component no-put/lifecycle and stale-result coverage plus native matching-ID edit/autosave and peer-preservation control. Add decision0016 and patch changeset.
- [x] 1.3 Run affected component/native browser suites and scoped checks, perform full-depth cross-review, obtain owner functional acceptance, satisfy genuine required CI and merge. Sync/archive the completed fixture separately.

## Risk packs

- Public API / CLI / script entry — selected: observable `/maps/<id>` load/error behavior changes; tasks1.1–1.3 native route cases and existing status regressions. No HTTP/API handler or OpenAPI change.
- File IO / path safety / overwrite — selected: prevent wrong-target IndexedDB writes while preserving both raw records; tasks1.1–1.2 real storage snapshots, no-put lifecycle proof and matching-ID own-key save.
- Schema / columns / units / field names — selected: requested ID, storage key and embedded map.id must not be conflated; exact distinct A/B fixtures, task1.1. Schema/version formats remain unchanged and existing future-version cases run in task1.3.
- Concurrency / shared state / ordering — selected: cancelled or discarded get outcomes cannot replace current ready/error state; task1.2 adds mismatched stale-result coverage to existing StrictMode cases, and native teardown preserves rows.
- Legacy compatibility / examples — selected: missing/future/unavailable/error states, repository selection, matching-ID edits and adjacent library behavior remain intact; tasks1.2–1.3 existing component/native cases and unchanged-adapter review.
- Error handling / rollback / partial outputs — selected: error rather than not-found, no partial ready session, no put/repair/delete/fallback; tasks1.1–1.2 and design rollback. No stored-data migration.
- Documentation / migration notes — selected: canonical error contract delta, bug-fix decision0016 and patch changeset; tasks1.2–1.3 docs/decisions/fixture checks.
- Auth / permissions / secrets — not selected: local map identity/data integrity, not account authorization; no credentials, logging or tenant policy changes.
- Config / project setup — not selected: existing runtime/provider setup and production verification exception retained; no config, timeout or retry changes.
- Resource limits / large input / discovery — not selected: one constant-cost ID comparison; no copying, discovery or workload change.
- Release / packaging / dependency compatibility — not selected: no dependencies/build configuration change; patch note covered above.
