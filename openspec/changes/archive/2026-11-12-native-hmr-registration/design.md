# Native registration repair design

## Context

Existing source: Next16.4.5 commit4e5335a00314be7fbb2aace5e9be56a88e64e5a8. `insert_output_assets` owns reverse registration; independently restored `compute_entry` publishes forward membership. Native logs directly show a selected restored producer lacking its reverse entry, then Update::Missing. Diagnostic evidence is under `.workplans/79/resume/`; synthetic restart stimulus is not itself the original source-edit acceptance.

## Goals / Non-Goals

Goal: native content publication and registration remain consistent under restore, independently demanded computation and source invalidation. Application behavior, APIs and storage are unchanged.
Non-goals: HMR suppression, first-message filtering, cache disabling/clearing, retry/timeout expansion, dependency version upgrades, paid services, or fixes for #118/#119 in this change.

## Decisions

Governing invariant: every forward-selectable producer already has the same session's pinned compute-entry registration; lookup never depends on an unrelated old endpoint caller rerunning.
Move ownership to the restored computation/publication path and register before forward publication. Preserve assets/compute-operation pins, first producer selection, emitted effects and strong consistency.
Operation construction itself registers a child edge, including cache hits; reconstructing the current operation would therefore create a self-dependency. Add an opt-in `self_operation` binding to the existing operation macro, typed from its declared output and absent from caller inputs/cache keys. Only operation functions may request it. A doc-hidden unsafe internal helper obtains the already executing task identity without creating/connecting a task; its safety contract requires the exact executing operation and matching output type, established by macro expansion. Existing guards reject absent/top-level contexts; do not expose a safe arbitrary-type current-operation API.
Pass that canonical handle to the session-dependent computation and register its pins before forward membership publication. Audit dependency/caching semantics of the handle as a task input; storing/pinning must not itself connect a self edge. Remove split registration ownership rather than retaining alternate writers.
Sibling surfaces: initial registration, independent compute demand, restored sessions, shared and sole producers, removed assets, HMR baseline/update, macro argument parsing/output typing, operation identity/dependency construction, GC pin release, package installation and all supported native consumers.
Seams: real native asset lookup with persistent backend and real browser navigation/HMR. No private State mutation or fabricated restart frames.
Native regression: seed producer A owning shared-main/home-only and B owning shared-main/editor-only; persist/stop/reopen; demand restored A computation without reinserting A; register B; all three assets retain correct content. Missing path remains missing; removed asset disappears. Existing first-producer semantics remain observable.
Use same-version platform packages on macOS arm64 and Linux x64 GNU. Package only the repaired native binary with unchanged official metadata/license; locked integrity binds downloads to reviewed bytes. Other platforms are explicitly outside this temporary repair's verified support, never silently represented as fixed.
Build from exact source commit plus reviewed patch and pinned upstream Rust/Cargo.lock. Keep build scripts/workflow in-repo; use existing package-manager entrypoints. A clean isolated source commit supplies an honest cache namespace; never fake dirty/hash metadata or reuse incompatible cache namespaces.
Stage candidate packages as non-production prerequisite artifacts; publish immutable names with digest manifest, then generate package-manager overrides and lockfile together. CI consumes final packages rather than a test-only native seam. No production deployment is authorized.
A decision record owns maintenance/removal: adopt a released upstream repair via Renovate, remove override/build-only machinery atomically after equivalent regressions pass. Do not introduce a runtime fallback to the faulty binary.

## Risks / Trade-offs

Native supply chain/platform divergence → traceable exact source, patch and binary/package digests; real addon-load and runtime evidence on both named platforms; no package version masquerading as an upstream release.
Instrumentation perturbation → remove diagnostic logging from delivered patch; demonstrate native invariant regression and uninstrumented browser behavior.
Ownership/self-cycle errors → native tests include independent restore demand and missing/removed/shared paths; macro tests reject use outside operation declarations; backend evidence verifies canonical handle identity, no self dependency and pin release. The unsafe helper's only production caller is generated operation code with the documented preconditions.
Original-source scenario differs from diagnostic restart → exercise same live dev process with a meaningful source edit followed by first editor navigation within existing5s, without repeated reloads and with existing warning/error/pageerror assertions. Also rerun retained-cache restart counterexample, allowing only normal session-reconnect reload.

## Migration Plan

1. Freeze native regression and obtain parent-observed semantic RED before repair.
2. Repair registration; parent runs focused native GREEN and browser counterexamples, then remove diagnostic scaffolding.
3. Build reviewed platform packages; verify provenance, frozen install, actual loading, normal production build and dev browser scenarios; add decision/docs in the same change.
4. Full review, final-head CI/protected merge, then sync/archive fixture. Rollback is an atomic revert of override/lockfile/build patch; it reintroduces the disclosed development defect but does not migrate or delete user data.

Source-change proof ordering (owner decision 2026-11-11, diagnosis `.workplans/79/review/fix-pass-3-diagnosis-result.md`): the first-navigation tab starts only after the B compile is observed. Starting it in the same tick as the source write races the recompile: a navigation that fetches the editor chunk before B is emitted renders A, and a client-navigated tab never subscribes the editor chunk-list (upstream SPA HMR gap), so it cannot recover. The retained-HMR clock runs from the source write; target readiness and target-B clocks run from navigation start; all remain 5 s.
