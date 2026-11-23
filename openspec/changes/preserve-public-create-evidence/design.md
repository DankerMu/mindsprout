# Design

## Context

Decisions 0030/0031 keep profiling separate from qualification and late evidence non-authoritative. The default path already constructs `observeNavigation`, installs the existing CDP listeners and Performance snapshots, and calls start/actionSettled/outcome; without diagnostic options those hooks are dropped and `public-create-outcome` is `{}`. The profile path already owns bounded safe network/attempt projection and failed-tail receipts.

## Goals / Non-Goals

Goals: retain the original default attempt's five-second budget, action settlement, readiness outcome, fixed-class network receipts and explicit unknown marker/route state. Keep late network/DOM capture attributable as failed-tail without changing qualification.

Non-goals: enabling CPU/trace profiling or marker/route sampling by default, new listeners/files/HTTP requests, changing product behavior/deadlines/retry/warmup/noise/cleanup, replacing legacy raw artifacts, or proving the intermittent readiness root cause.

## Decisions

- In the default runner, pass diagnostic options to the existing `observeNavigation`: existing origin/clock, a local claim that registers the default finalizer before the first awaited Performance snapshot, current mode/generation/trial/page context, and a sink that records `safePublicCreate(...)` as one `public-create-evidence` event. Add an explicit no-sampler option; default and profile share the factory/projection, not a second collector. `arm()` registers before that snapshot, `begin()` precedes `start()`, and the claimed no-sampler attempt stays armed until `start()` writes the original budget and enters observation. Interruption before claim/start produces null budget and unavailable action/outcome without premature finalization. Legacy empty `public-create-outcome` and raw bounded `public-create-network` remain unchanged for compatibility.
- Default diagnostic processing uses the listeners already installed by `observeNavigation`; it issues no additional CDP/HTTP command and creates no sampler, page binding, `.next-profiles` or `safe/` entry. Safe output uses fixed classes, numeric clocks, 64-request bound and existing omission/partial codes; no URL, request/map ID, body, header, credential or raw error is added. Marker and routes are explicit `missing-*-observation`, not inferred from failure HTML.
- Default failure finalization is deferred through the existing `observeEditorVisit.finally` until after the runner's existing failure capture and before cleanup. Add a finish seam to the same diagnostic/observation objects. Readiness/action failure therefore accepts bounded network receipts only as `failed-tail`; success finalizes immediately and later navigation cannot mutate it. Root-commit failure before first visit publishes only partial/unknown attempt evidence. Profile finalization remains owned by `createRuntimeProfile` and is not moved.
- `capturePage` accepts optional fixed metadata from the navigation observation. Only an action/readiness-failed attempt labels its existing failure capture `publicCreate.phase = failed-tail`; no attempt, ready outcome or unrelated capture adds that label. Capture content/timestamps/errors remain unchanged and never retroactively qualify readiness.
- Preserve the existing ordering where readiness becomes `ready` before the subsequent save-failure assertion. Pin a negative test showing a later save assertion failure does not rewrite that ready outcome; correcting that attribution is outside this issue.
- Update the `development-navigation` default and CI scenarios, native guide, and a new testing decision that partially supersedes 0031's profile-only scope. Keep 0030/0031 replay, safety and non-authoritative rationale, cross-link rather than rewriting them into a different decision.

## Governing invariant

The original invocation's immutable budget and action/readiness outcome remain authoritative; every later observation is explicitly failed-tail and cannot change readiness, qualification, cleanup or a separate replay.

## Sibling surfaces

- Default first create, action rejection, readiness timeout, root-commit-before-attempt, ready-then-save-assertion failure, interruption/page close, second SPA navigation and later trial failure.
- Existing raw JSONL outcome/network, fixed safe evidence event, failure-capture JSON/HTML/screenshot, result status/failures and cleanup artifacts.
- Profiled claim/sink/finalization/safe summary and its independent CI replay; no default `.next-profiles`/`safe/` output.
- Both source-change and restored-lifecycle, required Darwin/Linux qualification, 5000ms/noise/no-retry/no-warmup assertions and source/cache/process cleanup.

## Seams under test

Use `observeEditorVisit` + real `observeNavigation` with controlled CDP/guard/readiness fixtures for exact default output and failure ordering; real Chromium for no sampler/page work; real unprofiled native invocations for unchanged qualification/artifacts. Do not fabricate an original CI root-cause reproduction.

## Required evidence

- Default fulfilled action + readiness failure: exact start/+5000 deadline, fulfilled action, readiness-failed outcome, partial marker/routes; post-outcome network and DOM capture are failed-tail and outcome/status stay failed.
- Action rejection, interruption before claim/start, root failure before start, ready/save-failure and success fencing produce their specified states; second navigation cannot replace attempt 1. A successful first create followed by a later restored-lifecycle trial failure keeps attempt 1 finalized ready, rejects later mutations, omits `publicCreate.phase = failed-tail` from the unrelated capture, and preserves that later failure/cleanup as authoritative.
- Hostile URL/request/error canaries stay out of `public-create-evidence`; cap-plus-one yields bounded omissions; no new listener/sampler/HTTP/profiler command or `safe/`/`.next-profiles` entry.
- Two real unprofiled modes plus full native tests and required CI retain original assertions/cleanup; a profile replay is separately labelled and never repairs the original result.

## Risks / Trade-offs

- Reusing diagnostic computation adds bounded default work but no wire/page work → retain the 64-record safe projection and existing raw 256-record cap; measure full native suite and both modes.
- A second event beside the legacy empty outcome is intentional compatibility, not dual authority → only `public-create-evidence` carries terminal state; legacy/raw events remain observations, not readiness evidence.
- Delaying default finalization until after capture must not extend teardown → no wait/grace period is added; finish is synchronous in the existing finally before cleanup, and late receipts after finalization are rejected.

## Migration / Rollback

No deployment/data migration. Revert the default wiring/finish seam, spec/docs/decision successor and tests together; profiled diagnostics and product behavior remain independent.
