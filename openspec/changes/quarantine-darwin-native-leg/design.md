# Design: quarantine-darwin-native-leg

Change surface: `.github/workflows/ci.yml` job `all-checks-passed` (`needs`) and a comment on job `native-installed-runtime-darwin`; decision 0037; `docs/engineering/native-hmr.md` (aggregate topology paragraph, "Neither job ... may fail or be skipped", candidate "either required installed-package check", Darwin diagnosis "The original failed qualification, job, and required aggregate remain red", Known Limitations "Required installed qualification targets `macos-26` arm64"); back-link lines in decisions 0020, 0021, 0027, 0030; `docs/engineering/enforcement-index.md` review-only entry for the native-surface exception.

Must preserve:

- Darwin job: name `Installed native HMR (darwin-arm64)`, `needs: layer1-fast-checks`, `runs-on: macos-26`, timeout, Postgres start/stop steps, composite action call with `target: darwin-arm64`; no `continue-on-error` anywhere; failure still concludes the job failed.
- Composite action `.github/actions/native-installed-runtime/action.yml` byte-identical: 5 s deadlines, Darwin diagnostic replay (`steps.*.outcome == 'failure'`), evidence uploads with `if: always()`.
- `all-checks-passed`: `if: always()`, the failure/cancelled/skipped grep, and every other `needs` entry (`layer1-fast-checks`, `layer2-unit-tests`, `layer3-integration-tests`, `layer4-anti-drift`, `layer5-secret-scan`, `layer7-e2e`, `layer8-sast`, `native-installed-runtime`).
- Branch protection contexts (`constraints.yaml` `required_checks`, `docs/engineering/enforcement-index.md`, `required-check-sources` spec): unchanged.
- Decisions 0031/0035 (deadline, evidence attribution), 0027 (database/sign-in topology): unchanged.

Must add/change: removal of one `needs` entry; quarantine comment (issue link, exit condition, deadline); decision 0037; doc statements naming Darwin as required.

Governing invariant: every CI job other than the quarantined Darwin leg gates `All checks passed`, and the Darwin leg still runs and reports its true result.

Sibling surfaces:

- Other workflows referencing the Darwin job or aggregate: `.github/workflows/native-hmr.yml` (candidate, not an aggregate dependency - unchanged), `weekly.yml`, `pr-diff-guard.yml`, `lockfile-guard.yml` (separate required contexts - unchanged).
- Guardrail self-test `scripts/test-guardrails.sh`: must still pass; it does not parse `needs` (verify).
- Specs: development-navigation (diagnosis scenario "Failed Darwin qualification", "CI evidence does not become qualification" in the public-create timing requirement, database-preparation scenario), ci-e2e-results (complete needs set), required-check-sources (contexts - unchanged).
- Decisions stating Darwin gates merges: 0021 (two sentences), 0027 ("requires both job IDs"), 0020 ("complete needs set"), 0030 ("aggregate remain failed") - partially superseded by 0037, each gains a back-link line.
- Native-surface PRs (`scripts/native-*`, the `native-installed-runtime-darwin` job in ci.yml — including this PR — `.github/actions/native-installed-runtime/`, `patches/native/`, `@next/swc-*` overrides/lockfile): still need a passed Darwin job (0037 exception, review-only).
- Docs: native-hmr.md, enforcement-index.md, AGENTS.md unchanged (byte budget); `docs/engineering/enforcement-index.md` gains the native-surface exception entry (task 1.4).

Seams under test: the workflow file as parsed by GitHub on the PR run (aggregate `NEEDS` echo), `pnpm test:guardrails`.

Required evidence:

- `git diff origin/main -- .github/` shows only the `needs` line removed plus comment lines.
- A YAML parse (`node -e` with the repo's yaml dependency, or `python3 -c 'import yaml'` if available) lists `all-checks-passed.needs` = the 8 jobs above and confirms no `continue-on-error` key exists in ci.yml or the composite action.
- PR CI run: aggregate log `NEEDS` JSON lacks `native-installed-runtime-darwin`; Darwin job passed on the head (rerun pass accepted; this PR is native-surface) and uploaded its evidence artifact.
- `pnpm test:guardrails`, `pnpm decisions:check`, `pnpm docs:check`, `pnpm fmt:check`, `openspec validate quarantine-darwin-native-leg --strict --no-interactive` exit 0.

Non-goals: fixing Darwin readiness; changing deadlines, retries, warm-up, profiling or the composite action; deleting the Darwin leg; changing branch protection; closing #286.

Review focus: (0) native-surface exception keeps 0021:44 / 0027:41 intact and is wired in the Enforcement Index; (1) exactly one `needs` entry removed, Linux kept; (2) no `continue-on-error`; (3) decision 0037 supersession statements accurate against 0020/0021/0027/0030 text; (4) every doc/spec sentence that says Darwin is required is updated, none missed; (5) exit condition is measurable and owned by an open issue.
