# Proposal

## Why

Issue88 records full mutation jobs ending at the30-minute cap without final reports. Hosted profiling separates a37.25s dry run from CPU-bound mutant execution: after20minutes only895/3440 results exist, with2545 unfinished and all228static mutants still pending. The new resource and event evidence supports a bounded full-job budget rather than arbitrary test-timeout changes.

## What Changes

- Keep one canonical full-scope mutation job and allocate a measured170-minute command budget within a180-minute job envelope.
- Retain native HTML/JSON/event reports and info-level phase/resource diagnostics; preserve partial artifacts on early termination and never convert nonzero exits into success.
- Require complete final reports and exact planned/result identity coverage for success. Preserve all native statuses, including visible RuntimeError outcomes.
- Record the budget rationale and partially superseded runtime clause of decision0014 without changing its trigger policy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- mutation-testing: full configured scope completes within a justified bounded hosted budget; final completeness and early-termination diagnostics are observable contracts.

## Impact

Mutation workflow, its reviewed runtime decision, narrowly useful engineering documentation and this fixture. The diagnostic-only commits on this branch are not an accepted implementation; the final diff must contain the complete production workflow, not a20-minute profiler. No product/source/test/dependency change, changeset, exclusions, subset acceptance, concurrency tuning or mutant-timeout changes.

## Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent; expanded for shared CLI, CI configuration, resource limits, diagnostics and gate integrity.
Blast radius: false success from partial reports, lost failure evidence, or unbounded hosted work.
Selected risk packs: script entry; config; artifact IO; result schema; runtime budget; compatibility; failure/cleanup; documentation.
Evidence floor: retained hosted timeout/profile evidence; native negative completeness probes; full exact-head hosted run with all planned mutants terminal and final reports; interruption artifacts; guardrails; four-seat review; genuine required CI. Owner functional acceptance is consolidated after the queue, not requested per issue.
