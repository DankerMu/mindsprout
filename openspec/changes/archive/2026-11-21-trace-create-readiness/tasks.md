# Tasks

## 1. Attribute request and budget evidence

- [x] 1.1 Extend existing native observer/runtime/projection test seams with behavioral regressions for PUT→RSC→GET and exact original budget/outcome. Cover redirectResponse with reused requestId, method changes, excluded hops and stale events. Follow hop65 with response/data/completion and prove hop64 cannot mutate; standalone out-of-scope requests consume no capacity. Observe semantic red via `pnpm native:browser:test`; defaults issue no new commands/records.
- [x] 1.2 Extend `scripts/native-hmr-observation.mjs`, `native-hmr.mjs`, `native-hmr-runtime-profile.mjs` and existing projection/collection seams in place; preserve baseline result/clock/cleanup ordering and emit fixed partial channel states. Verify observer→runtime→safe-file assertions green, including original failure unchanged after late responses. Update native guide request/clock interpretation and document the diagnostic decision in this group; docs/decisions gates must pass.

## 2. Observe sampled visibility without changing readiness

- [x] 2.1 Add real-Chromium regressions for absent/hidden/visible marker, opacity0, SPA URL/history or GET completion without ready, first-observed brackets, stalls/navigation/crash and hostile binding data. Cover late visibility during existing capture; test acknowledged success disposal and held disposal across1000ms/homeBack, measuring page-side samples separately from collector acceptance. Controlled cases test measurement semantics, not #199 reproduction. Run red before implementation.
- [x] 2.2 Implement lifecycle-owned sampling/route observation with armed/observing/failed-tail/abandoned/finalized states. Bound samples128/cadence50ms and autonomous6400ms expiry checked before layout reads; no late-result wait. Verify timeout/disconnect epochs, immutable brackets/outcome and best-effort disposal partial status; late callbacks cannot revive acceptance and residual work stops within autonomous bounds/page close without extending cleanup. Update guide limitations; no product/interception changes.

## 3. Preserve safe publication and bounded teardown

- [x] 3.1 Add regressions then integrate `summary.publicCreate` into existing full/compact safe projection: hostile data rejected before any new sink, finite clock fields, bounded ordinals/arrays, missing/failed setup channels, cap-plus-one and total1MiB overflow. Verify real safe files retain identity/start/deadline/outcome/completeness without raw fallback, while all original CPU/trace/gap fields and ownership-conflict guarantees remain intact. Update guide output/limit contract; run native tests and scoped lint/format.
- [x] 3.2 Exercise interrupted setup, action rejection, CDP timeout/disconnect, active and paused signal cleanup and late callback finalization; assert no extra HTTP requests, recovery, profiling resurrection or extension of browser/process close budgets. Run `pnpm native:browser:test`, `pnpm docs:check`, `pnpm decisions:check` and strict change validation; existing tests cannot be weakened to clear a finding.

## 4. Prove integration and evidence interpretation

- [x] 4.1 On Node22.23.4 with real Chromium and owned scratch Postgres, run both installed-native modes with `--profile`, an unprofiled control, and signal/failure teardown. Verify stage records or explicit partials, original functional exits, source/cache/profile/process restoration and dropped scratch DB. Inspect literal safe payload fields/string values/caps and distinguish sampling brackets from exact timestamps. Keep local non-reproduction explicit.
- [x] 4.2 Run `pnpm change-scope <verified-base>`, scoped lint/format, `pnpm test:guardrails`, strict validation and independent high-risk gate/privacy/state review. Freeze the reviewed SHA and obtain its required installed/candidate CI results plus one attributable eligible Darwin diagnostic capture; retain original failure/artifacts and analyze only same-invocation measurements. If no eligible natural failure occurs, report capture pending rather than induce timeout or rerun for green. No merge into frozen PR221/219; retarget only after dependency landing and fresh scope/checks.

## Risk packs

Selected:

- Public API / CLI / script entry: 1.1–1.2,4.1; existing two modes/candidate grammar and opt-in/default contracts.
- Config / project setup: 2.1,4.1; existing Node/Chromium/owned DB setup, no new environment/CLI policy. Add a test file to the existing package script only if required by file limits.
- File IO / path safety / overwrite: 3.1; existing safe publisher reused, real-file conflict/overflow regressions, no new path/glob.
- Schema / columns / units / field names: 1.1–3.1; fixed new channel, explicit clock domains, no cross-clock arithmetic or inferred response.
- Auth / permissions / secrets: 1.1,2.1,3.1,4.1; method/route allowlist, hostile payload rejection, no bodies/headers/IDs/credentials.
- Concurrency / shared state / ordering: 1.1,2.1–3.2; attempt identity, immutable outcome, passive tail, late callback and cleanup ownership.
- Resource limits / large input / discovery: 1.1,2.1,3.1;64requests including hops,16routes,128samples/50ms,1MiB aggregate, explicit cap-plus-one statuses.
- Legacy compatibility / examples: 1.1,4.1–4.2; default output/callers and original profiling fields retained; installed/candidate verification.
- Error handling / rollback / partial outputs: 1.1–3.2; failed observation cannot replace functional result, partial channel output and unchanged cleanup budgets.
- Documentation / migration notes: 1.2,2.2,3.1,4.2; guide owns interpretation, decision records diagnostic extension, no false latency-repair claim.

Not selected:

- Release / packaging / dependency compatibility: native packages, recipe, dependencies and release are explicit non-goals; existing candidate CI remains a compatibility control in4.2.

## Execution boundary

Planning artifacts do not authorize code execution. After apply is requested: confirm parent/base state, review fixture and strict validation, then use one implementer in the current checkout with parent-owned red/green checks. Do not reuse or reset PR221's clean review ledger for this distinct issue. New review/PR identity and bounded fix-pass ledger belong to this change. Rollback and independent stack constraints are in [design](design.md).
