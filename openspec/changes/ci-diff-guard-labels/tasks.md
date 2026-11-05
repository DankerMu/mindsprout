# Tasks: ci-diff-guard-labels

## 1. Guard (issue #44)

- [x] 1.1 Red: add the diff-guard cases (a)–(h) from design "Fixture — issue #44" to `scripts/test-guardrails.sh` and show them failing before the script exists
- [x] 1.2 `scripts/check-diff-size.sh`: verbatim counting, exact-label exemption from `PR_LABELS`, fail closed (usage, base, limit, git diff)
- [x] 1.3 `.github/workflows/pr-diff-guard.yml` with label triggers, per-PR concurrency, least-privilege token, live label lookup, no `if:`; remove the job from `ci.yml`
- [x] 1.4 Point `constraints.yaml` `enforced_by`, AGENTS.md enforcement index and any doc naming the guard's file at `pr-diff-guard.yml`
- [x] 1.5 Evidence: `pnpm test:guardrails`, bite checks, `pnpm docs:check`, `pnpm fmt:check`, live probe PR

## Risk packs — issue #44

- Public API / script entry — selected: `check-diff-size.sh` argument, env and exit codes → guardrail cases (a)–(h).
- Config / project setup — selected: workflow triggers, concurrency, `ci.yml` removal → probe PR steps 1–4 (check-runs + statusCheckRollup + CI run count unchanged) and the `ci.yml` diff check.
- File IO / path safety — not selected: read-only git diff in the CI checkout.
- Schema / field names — not selected: `constraints.yaml` changes only the `enforced_by` text; the parsed key is untouched.
- Auth / permissions / secrets — selected: `GH_TOKEN` is `github.token` with `pull-requests: read` and `contents: read` only → review focus; no secret is printed.
- Concurrency / ordering — selected: racing opened/labeled runs → per-PR `cancel-in-progress` group and probe PR step 1.
- Resource limits — not selected: one diff per run, as before.
- Legacy compatibility — selected: check name, job id, output and error text preserved → `ci.yml` diff check and review.
- Error handling — selected: fail closed → cases (f), (g), (h); the label-lookup failure exits the step under `shell: bash` (`-eo pipefail`), review-only.
- Release / dependency — not selected: no new dependency; the checkout action stays pinned to the same SHA.
- Documentation — selected: `constraints.yaml`, AGENTS.md and agent-operating-rules references → `pnpm docs:check`.
