# Tasks

## 1. Native regression and repair

- [x] 1.1 Add a real persistent-backend regression for independently restored producer A plus newly registered B; parent records semantic RED on shared/sole asset lookup without private State mutation or reinserting A.
- [x] 1.2 Repair publication/registration ownership without self-dependency using the macro-typed canonical self-operation binding; parent observes GREEN for restoration, precedence, missing path and removal, plus macro invalid-context rejection, handle identity/no-self-edge and pin release, preserving pins/effects and genuine update semantics.
- [ ] 1.3 Prove uninstrumented native runtime closes the retained-cache reload counterexample and meaningful same-lifecycle source-edit first-navigation scenario within existing5s and browser noise assertions; capture screenshots and source restoration hashes.

## 2. Reproducible native delivery

- [x] 2.1 Add minimal source-pinned native build/package commands and macOS arm64/Linux x64 GNU delivery; verify source/patch/Cargo.lock/binary/package digest manifest and actual addon target identity without changing upstream version or trusting unreviewed binary bytes.
- [ ] 2.2 Generate package-manager overrides/lockfile for immutable candidate artifacts; clean frozen installs use the fixed binaries on both platforms, wrong integrity fails, and no diagnostic environment/native fallback is needed.
- [x] 2.3 Add decision and developer instructions covering maintenance, platform limitation, build/install failure, rollback and Renovate removal; verify docs/decisions gates and command accuracy.

## 3. Integration and merge

- [ ] 3.1 Run scoped build, native/browser regressions and guardrails for build/workflow changes; verify existing application behavior and original mutation configuration remain unchanged.
- [ ] 3.2 Complete full critical-path four-seat review, source-locked final-head CI, work summary and protected merge; satisfy all issue AC before closing and synchronizing/archiving this fixture.

## Risk-pack mapping

- Selected — Public API / CLI / script entry:1.2 audits the internal macro/helper safety contract and callers;2.1,3.1 verify real build/package commands; no new product API.
- Selected — Config / project setup:2.2 frozen installs and explicit supported targets.
- Selected — File IO / path safety / overwrite:1.1 persistent temp backend isolation;2.1 exact staged artifacts/digests; no user cache/data deletion.
- Selected — Schema / columns / units / field names:2.1 artifact metadata and package identity remain exact; no storage schema change.
- Selected — Auth / permissions / secrets:2.1 minimal artifact publication permissions, no secret logging or paid keys;3.2 review.
- Selected — Concurrency / shared state / ordering:1.1–1.2 registration-before-publication invariant, independent restore, producer precedence, macro-handle dependency semantics and GC pin release.
- Selected — Resource limits / large input / discovery:2.1 bounded build/platform inventory and exact artifact inputs; no runtime retry or input bypass.
- Selected — Legacy compatibility / examples:1.2–1.3 legitimate HMR and existing consumer behavior;2.3 supported-platform limitation.
- Selected — Error handling / rollback / partial outputs:1.2 genuine missing/removal;2.2 integrity failure;2.3 atomic revert contract.
- Selected — Release / packaging / dependency compatibility:2.1–2.2 exact source/toolchain/version, real target loads and installed regression on both named platforms.
- Selected — Documentation / migration notes:2.3 decision with maintenance/removal;3.2 archive.
