# Tasks: ci-gate-hardening

## 1. Naming guard (#61, #59)

- [x] 1.1 Red: guardrail cases n1–n6 and p1–p6 from design "Fixture"; show the behaviour-changing ones failing
- [x] 1.2 NUL-separated staged read; physical path-mode resolution with outside-repo exit 0; decision 0008
- [x] 1.3 Bites for #61 and #59; /bin/bash 3.2 runs

## 2. Tool configs and records (#37, #47, #38, #40, #53)

- [x] 2.1 Red: boundaries cases b1–b3 and duplicate-code cases d2–d4
- [x] 2.2 `.dependency-cruiser.cjs` rule, `constraints.yaml` mirrors, `package.json` duplicate-code script, `stryker.config.mjs` plugin
- [x] 2.3 Move and narrow decision 0006; update AGENTS.md (branch protection, Branch model strict, duplicate-code row if needed)
- [x] 2.4 Bites for #37 and #47; local `pnpm mutation` run

## 3. Lockfile guard (#49)

- [x] 3.1 Red: cases l1–l8
- [x] 3.2 `scripts/check-lockfile-pairs.sh`, `.github/workflows/lockfile-guard.yml`, remove the job from `ci.yml`, AGENTS.md row, create the `lockfile-refresh` label
- [x] 3.3 Bites for #49; live probe PR

## 4. Close-out

- [x] 4.1 `openspec/changes/m1-canvas/design.md` 0006 path reference; all gates; archive this change before the final review round

## Risk packs — issues #61, #38, #37, #47, #49, #59, #40, #53

- **Config / project setup — selected.** depcruise rule, jscpd invocation, stryker plugins, workflow triggers and concurrency. Evidence: b1–b3, d1–d4, the mutation run, the live probe.
- **File IO / path safety — selected.** Raw staged bytes and physical path resolution decide what can be committed. Evidence: n1–n6, p1–p6, bites.
- **Public API / CLI / script entry — selected.** `check-naming.sh` exit codes and stderr; the `check-lockfile-pairs.sh` argument, env and exit codes. Evidence: every existing naming case unchanged, l1–l8.
- **Concurrency / ordering — selected.** Racing opened and labeled runs on the lockfile guard. Evidence: per-PR cancel-in-progress group, probe step 1.
- **Auth / permissions / secrets — selected.** `GH_TOKEN` is `github.token` with read-only scopes, and nothing is printed. Evidence: review.
- **Error handling — selected.** The lockfile script fails closed. Evidence: l6, l7, l8, bite (ii).
- **Legacy compatibility — selected.** Check names, other ci.yml jobs, ASCII naming verdicts and 0006's decision content are preserved. Evidence: ci.yml diff limited to the removed job, existing cases unchanged.
- **Documentation — selected.** AGENTS.md rows, decision 0006 wording and the `constraints.yaml` mirrors. Evidence: grep checks, `pnpm docs:check`, `pnpm decisions:check`, the gh api output.
- **Release / packaging — selected.** The stryker plugin resolves under pnpm isolated layout; no dependency changes. Evidence: the local mutation run, the CI weekly job, `install --frozen-lockfile`.
- **Schema; Resource limits — not selected.** No persisted data. The mutation runtime is bounded by the existing 30-minute job timeout, which this PR exercises.
