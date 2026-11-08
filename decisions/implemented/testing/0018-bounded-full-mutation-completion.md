---
id: 0018
title: Bounded full mutation completion
kind: testing
status: implemented
date: 2026-11-08
---

# Bounded full mutation completion

## Problem

The full hosted mutation workload exceeds a 30-minute job cap without final reports. A [20-minute hosted profile](https://github.com/DankerMu/mindsprout/actions/runs/42493012061) retained 895 of 3,440 planned results after a 37.25-second dry run; all 228 static mutants remained unfinished. Mean host CPU utilization was 97.23%, with ample memory and no observed cgroup OOM events. The bottleneck is aggregate execution work, not evidence that individual mutant deadlines need relaxation.

## Decision

- Keep one canonical `pnpm mutation` invocation on the existing hosted runner. Allow 170 minutes for the command, with TERM followed by KILL after 30 seconds, inside a 180-minute job envelope. The current observed-rate model estimates 69.8 minutes for nonstatic mutants plus 35.4 minutes for static full-run equivalents. The slower historical hosted-rate model estimates 98.2 + 46.7 ≈ 145 minutes; the command budget adds about 25 minutes of variability reserve, with a further job margin for setup, cleanup, and upload.
- Treat these linear projections as sizing inferences, not a completion guarantee: static execution was not reached in the profile. Require a fresh exact-head full hosted completion before acceptance. If the budget is insufficient, return to diagnosis instead of automatically increasing it.
- Preserve the canonical mutation scope, test selection, per-test coverage, worker concurrency, per-mutant deadlines, and advisory thresholds (`high: 90`, `low: 70`, `break: null`). Do not add exclusions, incremental-only acceptance, retries, or score reclassification.
- Keep native HTML, JSON, and event reporters alongside clear-text/progress output. Use info-level file logging because debug logging serializes cyclic resolved Vitest configuration and fails initialization; [issue 118](https://github.com/DankerMu/mindsprout/issues/118) owns that dependency defect. Preserve native runtime errors without treating them as killed mutants or product bugs.
- Accept completion only after the command and capture succeed, the owned resource sampler is stopped and reaped, required diagnostics exist, and nonempty final HTML/JSON exactly cover one nonempty plan. Match each unique mutant ID to its normalized source path; reject missing, duplicate, unexpected, Pending, and unknown results. Retain all seven native terminal statuses unchanged, including `RuntimeError`, and check reported high/low thresholds against the canonical configuration.
- Clear only owned generated outputs before each invocation. Write the accepted-completion artifact last; native console scores or preexisting report files alone are not acceptance. A command failure remains authoritative even when usable reports exist.
- Always attempt to upload available reports, emitted events, nanosecond event modification-time metadata, identity, resource samples, logs, and exit metadata. Missing diagnostics fail an otherwise successful invocation. Preserve original nonzero statuses, including deadline status 124, and label failed-run artifacts diagnostics-only. Signal only the saved sampler child after checking its parent, and always wait for that child.

This record partially supersedes only the mutation runtime-budget and report-policy clauses of [decision 0014](../process/0014-separate-guardrail-and-mutation-triggers.md). Its trigger policy, job identities, runner, permissions, action pins, setup, and required-check governance remain intact. No other active record is superseded.

## Alternatives considered

- **Keep the 30-minute job cap** — rejected: recorded full-scope hosted runs terminate without final reports; separating triggers does not make the work complete.
- **Parallel sharding** — not selected: it adds scope partitioning, cross-shard identities, and global score aggregation contracts. Reconsider if fresh evidence disproves the bounded single-job strategy.
- **Increase the budget without measurement** — rejected: a timeout alone does not justify an arbitrary extension. The measured slow-host sensitivity model supplies the bound, and exact-head native completion must validate it.
- **Reduce scope, alter concurrency, relax mutant timeouts or thresholds, or accept a partial report** — rejected: these change the workload or acceptance contract rather than establish full completion.

## Consequences

- Hosted mutation jobs can occupy a runner substantially longer, but remain bounded and advisory. No required CI check, trigger, permission, dependency, product behavior, or product changeset changes.
- Completeness is a workflow/report-boundary check using Node built-ins, not another mutation engine. Runtime errors remain visible terminal outcomes requiring independent investigation; no score or status is rewritten.
- Resource samples, not GNU time's wrapper-only CPU summary after a process-group timeout, support resource-pressure conclusions. Event modification times are file-write times, not guaranteed exact mutant completion instants.
- Verification must exercise incomplete-report cases and the real permanent cleanup path: deadline, initialization failure, nonzero command with usable reports, and missing diagnostics. Each interruption probe preserves available artifacts, reaps its sampler, and leaves an independent canary alive. Fixture success never substitutes for the separate full hosted run.
- Rollback is confined to the workflow and its policy records; there is no application or data migration. Diagnostic-only short deadlines are not a production fallback.
