# Tasks

## 1. Complete the unchanged mutation workload

- [x] 1.1 Profile the full configured workload on the existing hosted runner; distinguish initial tests, execution, resources, timeouts/tool errors and diagnostic-method failures. Preserve partial artifacts and measured budget rationale.
- [ ] 1.2 Replace the diagnostic workflow with the measured bounded full run, final-report completeness checks and preserved interruption diagnostics; add lifecycle-checked decision and update only its related documentation. Parent executes every completeness matrix case and all four mandatory permanent-path interruption/cleanup probes, including owned-sampler/canary checks, before scoped checks.
- [ ] 1.3 Run full exact-head hosted mutation to completion, verify whole-plan terminal outcomes/score/report and inspect any timeout/tool-error outcomes; four-seat review, genuine required CI, protected merge and separate sync/archive. Include evidence in final consolidated EPIC acceptance without per-issue prompts.

## Risk packs

- Public API / CLI / script entry — selected: unchanged pnpm mutation caller, native exit/report checks in1.2–1.3.
- Config / project setup — selected: measured job/command limits only; preserve workload, actions/triggers/permissions and all native mutation controls;1.2 review and1.3 exact-head CI.
- File IO / path safety / overwrite — selected: same-run artifact directory, plan/report source-path binding, partial retention and owned sampler cleanup;1.2 probes and1.3 artifacts.
- Schema / columns / units / field names — selected: planned IDs, terminal statuses, net-vs-wall durations, source paths and high/low thresholds;1.1 interpretation and1.2 completeness probes.
- Auth / permissions / secrets — not selected: no credential/permission changes or external report service; diagnostics must not dump environment or process arguments.
- Concurrency / shared state / ordering — selected: sampler/process cleanup, completion-before-upload and nonzero status propagation;1.2 failure probes,1.3 full run. Worker concurrency remains unchanged.
- Resource limits / large input / discovery — selected: measured170-minute command/180-minute job envelope, complete dynamic inventory and artifact sizes;1.1–1.3 hosted evidence.
- Legacy compatibility / examples — selected: original CLI/workload/advisory semantics and decision0014 trigger policy retained;1.2 diff audit and1.3 native run.
- Error handling / rollback / partial outputs — selected: no partial-success claim, timeout/nonzero exit retained, missing reports rejected, partial artifacts uploaded;1.1–1.3.
- Release / packaging / dependency compatibility — not selected: no dependency or package changes; opt-in debug failure stays#118, not patched here.
- Documentation / migration notes — selected: measured rationale/decision ownership and canonical delta;1.2–1.3. No migration or product changeset.
