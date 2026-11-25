---
id: 0030
title: Separate native profiling from qualification
kind: testing
status: implemented
date: 2026-11-17
---

# Separate native profiling from qualification

## Problem

A native browser deadline failure does not identify compiler work, server execution, browser execution, or runner scheduling as its cause. Profiling changes the observed workload, and raw CPU/trace data can contain private strings. A successful diagnostic replay cannot qualify the original failed run.

Collection also has ownership and coverage hazards. A full document navigation can discard earlier renderer CPU samples while `Profiler.stop` still returns a valid profile. Playwright's default SIGINT handler can exit with code 130 before the collector finishes server/source/cache cleanup.

## Decision

- Keep qualification unprofiled. Permit explicit trailing `--profile` on the existing installed/candidate invocation; reject inherited Next CPU and Turbopack profiling controls before mutation. The [native HMR guide](../../../docs/engineering/native-hmr.md#opt-in-diagnostic-profiling) owns invocation, prerequisites, paths, and clock interpretation.
- Own an initially absent `.next-profiles` directory. Collect each stopped server generation before restart, retain raw data privately, and publish only a fixed-schema safe summary through a literal artifact path. Use bounded no-follow reads and fixed partial codes; unexpected entries or changed ownership never authorize deletion or overwrite. [Projection limits](../../../scripts/native-hmr-profile-projection.mjs) are the canonical ingestion/retention bounds, not a bound on Next producer or inbound CDP allocation.
- Keep collection clocks distinct. Trace coverage is observed-only; CPU samples are not utilization or exact wall-clock attribution. Mark intervals crossing top-level document transitions `renderer-local-coverage`, retaining valid available samples and bounded collector transition metadata without raw URLs or frame IDs. Stop before browser suspension/closure, restart only after resume, and permanently abandon timed-out or disconnected sessions.
- Give the collector sole SIGINT/SIGTERM ownership in both default and profiled launches. The shared launcher disables only Playwright's competing handlers for those signals. This corrects interruption behavior rather than claiming it is unchanged; browser-close and process-group shutdown budgets and ordering remain intact.
- Allow one diagnostic execution only after an eligible, non-cancelled Darwin browser-step failure. Require matching failed-result evidence, verified source/cache cleanup, unchanged current source identity, and a navigation-phase failure. Restart failures additionally need an earlier browser resume for the same generation and trial. Installation/setup, Linux, cancellation, and invalid evidence select no replay. The original step, job, and aggregate remain failed regardless of diagnostic success.

## Alternatives considered

- **Profile every qualification or use a successful replay as recovery.** Instrumentation changes the measurement, and another execution cannot replace the original outcome. Longer deadlines, retries, warmup, or cache disabling would alter the qualification contract rather than explain it.
- **Upload raw profiles, broad trace output, or diagnostic logs.** Their arbitrary names, URLs, tags, and errors are not safe publication schemas. Fixed enum/numeric projections retain useful evidence without a raw fallback.
- **Treat a successful CPU stop as complete interval history, or checkpoint every navigation.** The former hides renderer-local sample loss; the latter introduces profiling calls and races around automatic navigations. Explicit partial coverage preserves the useful latest-document evidence.
- **Leave Playwright's signal handlers enabled or compensate with forced exits.** Competing shutdown owners can preempt restoration. Disabling only the competing SIGINT/SIGTERM handlers lets the existing bounded collector teardown finish.

## Consequences

- Missing, malformed, unstable, oversized, or interrupted collection remains explicit partial evidence and does not replace functional failures. No profile or local non-reproduction establishes a root/editor latency repair or runner-contention diagnosis.
- Safe summaries retain validated workflow/checkout/head/run identity, native binary identity, observed process-group identity, and unknown profile PIDs. Raw local files are not uploadable substitutes when the summary is absent or incomplete.
- Interruption acceptance requires completed cleanup and restored owned resources, not merely a nonzero exit. Removing diagnostic collection must not reintroduce competing signal ownership.
- No active decision is superseded. [Decision 0021](../bug-fix/0021-native-hmr-registration-maintenance.md) retains native maintenance and qualification ownership; [decision 0027](0027-signed-in-native-hmr-database.md) retains signed-in probe/database topology; [decision 0020](0020-native-e2e-runtime-results.md) retains authoritative runtime outcomes and fail-closed aggregate semantics.
- This is tooling-only: no application API, storage migration, native package, dependency, or product changeset change. Diagnostic evidence does not establish CI capture, merge eligibility, or successful qualification on its own.
- [Decision 0037](0037-quarantine-darwin-native-leg.md) partially supersedes only "The original step, job, and aggregate remain failed regardless of diagnostic success": the step and job still remain failed, but the aggregate no longer depends on the quarantined Darwin leg.
