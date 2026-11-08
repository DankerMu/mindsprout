# Tasks

## 1. Replace discovery with runtime evidence

- [x] 1.1 Prepare one disposable issue/deadline-linked runtime-skip probe; parent observes old native CI execute it as skipped while route titles remain and the existing gate passes, retaining the actual RED baseline.
- [x] 1.2 Add native same-run JSON/list reporting and fail-closed result checking, preserve route presence, top-level concurrency, complete always-running aggregate/needs/rejection logic and UI upload name/path/missing-file policy, and document decision0020; parent verifies identical native skipped-case rejection, ordinary assertion-failure propagation, current-suite positive control, actual-block report boundaries including wrong-typed/nonempty report-level errors and stale sentinel removal, then scoped guardrails/format/docs/decisions/strict checks.
- [ ] 1.3 Complete four-seat review and exact-head required CI, protected merge and separate spec sync/archive; retain final functional evidence for one consolidated EPIC acceptance.

## Risk packs

- Public API / CLI / script entry — selected: existing pnpm e2e arguments, exit status and gate step;1.1–1.3.
- Config / project setup — selected: reporter env/output contract and CI controls;1.2–1.3.
- File IO / path safety / overwrite — selected: one owned report, stale removal and existing upload;1.2 native/probe evidence.
- Schema / columns / units / field names — selected: native nested outcomes/counters, report-level errors array and rejected invalid reports;1.2.
- Auth / permissions / secrets — not selected for change: contents:read unchanged; report must not dump environment secrets.
- Concurrency / shared state / ordering — selected: producer-before-validator, same execution, ordinary failure precedence;1.1–1.2.
- Resource limits / large input / discovery — selected: no rerun or narrowing; full current suite and retained route presence;1.1–1.3.
- Legacy compatibility / examples — selected: list output, required names/triggers/aggregate and UI upload retained;1.2 diff/native cases.
- Error handling / rollback / partial outputs — selected: skip/missing/invalid/report mismatch, wrong-typed/nonempty report-level errors, assertion failure and available evidence;1.2.
- Release / packaging / dependency compatibility — not selected: existing reporters/built-ins, no dependency changes.
- Documentation / migration notes — selected: decision and canonical capability;1.2–1.3. No product changeset or data migration.
