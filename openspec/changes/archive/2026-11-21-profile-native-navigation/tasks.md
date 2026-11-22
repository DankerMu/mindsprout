# Tasks

## 1. Implement bounded opt-in evidence

- [x] 1.1 Add behavioral regressions for exact CLI grammar, ambient-profile refusal, default no-op with an unowned entry, hostile-string/known-clock fixed projections, malformed/cap-plus-one/stale/ambiguous inputs, no-follow ownership conflicts, bounded safe publication, profiler timeout/disconnection/late replies and interrupted cleanup; observe failure before implementation.
- [x] 1.2 Implement opt-in server trace/CPU and browser CPU collection with explicit units, provenance, fixed error codes, bounded output, and suspension/cleanup handling; keep default mode unchanged.
- [x] 1.3 Wire exactly one diagnostic-only Darwin execution after an eligible failed native browser qualification, with verified prior cleanup/current source identity and fresh output; prove restored/source selection, success/Linux/install/cancellation/ineligible exclusion, safe-only publication, and unchanged failed-job propagation.

## 2. Verify and analyze

- [x] 2.1 Run `pnpm native:browser:test`; on Node 22.23.4 with an owned scratch database, run both native modes with trailing `--profile` and one unprofiled control. Inspect safe artifact names, complete-or-explicit-partial status, original functional exits, multi-generation suspension gaps, interrupted teardown, no secret sentinels, and restored source/cache/profile-directory state.
- [x] 2.2 Record the collection/interpretation contract in the native guide and its decision record; run scoped lint/format, docs/decision checks, guardrails, and strict fixture validation.
- [x] 2.3 Complete full gate-integrity/privacy cross-review and one attributable CI diagnostic capture with distinct workflow/checkout/head/run/attempt identity, original failed result/artifacts retained, safe-only diagnostic files, and the required job still red regardless of diagnostic outcome; analyze without asserting an unproven repair.

## Risk packs

Selected:

- Public API / CLI / script entry: 1.1–1.2; existing optional candidate manifest and explicit profiling flag are unambiguous.
- Config / project setup: 1.3, 2.2; existing job/DB setup is reused, no new environment requirement.
- File IO / path safety / overwrite: 1.1–1.2, 2.1; owned absent profile directory, bounded reads, no raw publication, CAS source/cache restoration unchanged.
- Schema / columns / units / field names: 1.1–1.2; allowlisted projections and separate clock domains, no invented PID or CPU utilization.
- Auth / permissions / secrets: 1.1, 1.3, 2.1; hostile strings never reach safe artifacts; real verification uses synthetic users in an owned database.
- Concurrency / shared state / ordering: 1.2, 2.1; collect each stopped generation before restart, no CDP while suspended, default API-first ordering retained.
- Resource limits / large input / discovery: 1.1–1.2; bounded ingestion/retention/output and CDP operation time; Next producer allocation and inbound CDP allocation are explicit limits, not falsely claimed to be bounded by post-receipt checks.
- Legacy compatibility / examples: 1.1, 2.1; installed/candidate and both native modes remain valid without profiling.
- Error handling / rollback / partial outputs: 1.1–1.3, 2.1; fixed incomplete codes, preserved original failures, owned cleanup after interruption.
- Documentation / migration notes: 2.2–2.3; diagnostic interpretation and raw-artifact exclusions, no data migration.

Not selected:

- Release / packaging / dependency compatibility: no native patch, recipe, package, dependency, or publication changes; existing installed/candidate qualifications remain authoritative.
