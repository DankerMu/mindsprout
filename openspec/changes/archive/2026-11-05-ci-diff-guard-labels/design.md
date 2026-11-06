# Design: ci-diff-guard-labels

## Context

`ci.yml` job `layer6-diff-size-guard` (check `PR diff size guard`) uses a step-level `if: !contains(github.event.pull_request.labels.*.name, 'diff-limit-exempt')` and triggers on the default `pull_request` types. The guard sits outside the `All checks passed` aggregator because it runs only on PRs. It is a required check: branch protection on `main` is live (`required_status_checks.contexts` = `All checks passed`, `Lockfile–manifest consistency`, `PR diff size guard`; `strict: true`; linear history), although AGENTS.md still says "not yet applied" (doc drift found in review, filed separately).

## Decisions

- D1 Separate workflow. Label events re-run one cheap job instead of cancelling and restarting the whole CI (`ci.yml` concurrency has `cancel-in-progress`).
- D2 Live labels. Read `gh api repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER --jq '.labels[].name'` at run time. The payload is stale for the `opened` race and is replayed verbatim by `gh run rerun`.
- D3 No job-level or step-level `if` on the guard. A skipped job is a passing required check, so filtering label events by name would turn "add any label" into a bypass. Every PR event runs the job to completion.
- D4 Per-PR concurrency group with `cancel-in-progress: true`. Only the newest run per PR completes, so an older run cannot finish later with a stale answer.
- D5 Counting logic lives in a script, so the guardrail self-test can run it offline. The workflow only fetches labels and calls the script.

## Fixture — issue #44

Change surface:

- `.github/workflows/pr-diff-guard.yml` (new)
- `.github/workflows/ci.yml` (remove `layer6-diff-size-guard` and its comment; nothing else)
- `scripts/check-diff-size.sh` (new)
- `scripts/test-guardrails.sh` (new section before the residue sweep)
- `constraints.yaml` (`size_limits.max_pr_diff_lines.enforced_by` text)
- `AGENTS.md` (enforcement index row "PR diff size")
- `docs/engineering/agent-operating-rules.md` (only if it names the file)

Must preserve:

- Check name `PR diff size guard` and job id `layer6-diff-size-guard`.
- The limit is read from `constraints.yaml` with the same regex.
- The count is `git diff --diff-filter=ACMR --ignore-all-space "$BASE"...HEAD` with the same exclusion pathspecs (`*.lock`, `**/pnpm-lock.yaml`, `**/__snapshots__/**`, `**/*.snapshot`, `.changeset/**`, `decisions/**`) and `grep -c '^[+-][^+-]'`.
- Output line: `Changed lines (excluding lockfiles/snapshots/records): N (limit: M)`.
- `::error::` message on excess: "PR exceeds the M-line diff limit. Split it, or add the 'diff-limit-exempt' label …".
- Exit 1 on excess. Inclusive boundary (N == M passes).
- Exact label-name match (`contains` on an array is element equality).
- The base is the PR base SHA from the event (`github.event.pull_request.base.sha`), diffed against the checked-out merge commit with `fetch-depth: 0`.
- The checkout action stays pinned to the same SHA.
- Every other `ci.yml` job, trigger, concurrency setting and the `All checks passed` aggregator stay byte-identical.

Must add/change:

- Workflow `name: PR diff guard`.
- `on: pull_request: types: [opened, synchronize, reopened, labeled, unlabeled]`.
- `permissions: contents: read, pull-requests: read`.
- `concurrency: group: pr-diff-guard-${{ github.event.pull_request.number }}, cancel-in-progress: true`.
- One job (`layer6-diff-size-guard`, name `PR diff size guard`, `runs-on: ubuntu-latest`, `timeout-minutes: 3`) with no `if:` at job or step level. Steps:
  1. checkout with `fetch-depth: 0`
  2. A step with `shell: bash` (bash `-eo pipefail`) and env `GH_TOKEN: ${{ github.token }}`, `PR_NUMBER`, `BASE_SHA` that runs `labels=$(gh api …)`; a failed lookup fails the step, and the variable is `export PR_LABELS="$labels"`. Then `bash scripts/check-diff-size.sh "$BASE_SHA"`. No `continue-on-error` on the job or any step.
- `scripts/check-diff-size.sh <base-ref>`:
  - `set -euo pipefail`.
  - Labels come from env `PR_LABELS`: newline-separated, unset or empty means none.
  - On an exact line `diff-limit-exempt`, print `diff-limit-exempt label present: PR diff size guard passes` and exit 0.
  - Otherwise read the limit; if it is unreadable, exit non-zero naming `max_pr_diff_lines`.
  - Verify the base with `git rev-parse --verify --quiet "$base^{commit}"`. If it is unresolvable, exit non-zero naming the base ref.
  - Capture the diff into a variable so a failing `git diff` aborts, then count (grep's no-match exit 1 is the only status tolerated).
  - Print and compare exactly as before.
  - A missing argument prints `usage: check-diff-size.sh <base-ref>` and exits 2.

Governing invariant: for every pull request event, the latest completed `PR diff size guard` run on the head commit fails iff (counted lines > limit AND the PR's labels at run time lack `diff-limit-exempt`) OR the count could not be determined. It is never skipped.

Sibling surfaces:

- `ci.yml` aggregator: does not list the guard, unchanged.
- `weekly.yml` runs `pnpm test:guardrails` on PRs and will exercise the new cases.
- AGENTS.md required-check list (name unchanged).
- AGENTS.md line on "split or add `diff-limit-exempt`" (unchanged; now true).
- `docs/engineering/agent-operating-rules.md` layer list (job id unchanged).
- `release.yml`: none, no diff guard.
- `ci.yml` `lockfile-consistency` (required check `Lockfile–manifest consistency`) has the **same defect**: its step reads `github.event.pull_request.labels` for `lockfile-refresh`. The issue body's "only reader" claim is wrong. It is out of scope here (the issue excludes other CI jobs, and `ci.yml` must otherwise stay byte-identical), so it is filed as a follow-up issue that reuses this pattern.
- Root `pnpm-lock.yaml` is counted: neither `*.lock` nor `**/pnpm-lock.yaml` excludes it. This is an existing counting bug, out of scope (counting semantics are preserved verbatim) and filed as a follow-up.

Seams under test:

- `scripts/check-diff-size.sh` via `scripts/test-guardrails.sh` in a throwaway worktree. Fixture commits are made with plumbing (`git add` → `git write-tree` → `git commit-tree -p HEAD` → `git checkout --quiet --detach <sha>`), so no hook runs and no hook-bypass flag is used. The worktree is reset to its starting commit afterwards.
- The workflow itself, by a live probe PR (orchestrator, Phase 4).

Required evidence:

- `pnpm test:guardrails` exit 0 with these new PASS lines:
  - (a) reject: 401 counted lines, `PR_LABELS` unset → output contains the full line `Changed lines (excluding lockfiles/snapshots/records): 401 (limit: 400)` and names "diff limit"
  - (b) reject: 401 lines, `PR_LABELS=$'bug\nnot-diff-limit-exempt'` → names "diff limit"
  - (c) accept: 401 lines, `PR_LABELS=$'bug\ndiff-limit-exempt'`
  - (d) accept: exactly 400 lines, no label
  - (e) accept: 401+ lines all inside `sub/pnpm-lock.yaml`, `x.lock` and `decisions/` (exclusions preserved; the root `pnpm-lock.yaml` is deliberately not used because it is counted today, see Sibling surfaces)
  - (f) reject: base ref `deadbeef…` (unresolvable) → names the ref, and the output does not contain "Changed lines" (no zero count)
  - (g) reject: no argument → names "usage"
  - (h) reject: `max_pr_diff_lines` value corrupted in the worktree's `constraints.yaml` → non-zero, names `max_pr_diff_lines`, output lacks "Changed lines" (the worktree's `constraints.yaml` is restored afterwards)
  - Review-only (not testable offline): a failed `gh api` label lookup fails the step under `bash -eo pipefail` before the script runs
- A red run of the new cases against a stub or absent script before implementation.
- A bite check: replace the `-x` exact match with a substring match and show (b) failing; remove the base verification and show (f) failing.
- `grep -rn "pull_request.labels" .github/`: the only hit is `ci.yml` `lockfile-consistency` (follow-up), with none in the diff guard.
- `git diff origin/main -- .github/workflows/ci.yml` shows only the removed job and comment.
- Live probe PR (orchestrator), a throwaway branch `agent/44-guard-probe` off the fix branch, adding a 450-line text file, not merged:
  1. `gh pr create --label diff-limit-exempt` → latest guard run success with no manual step.
  2. Remove the label → a new run fails.
  3. Add an unrelated label (`bug`) → a new run fails, not skipped.
  4. Add `diff-limit-exempt` → a new run succeeds.

  After each step, record:
  - every check run on the probe head SHA, via `gh api repos/DankerMu/mindsprout/commits/<head>/check-runs?check_name=PR%20diff%20size%20guard` (status, conclusion, started_at, and the app/workflow it came from)
  - the `PR diff size guard` entry in `gh pr view <probe> --json statusCheckRollup`

  Expected:
  - The newest run's conclusion matches the step; older runs are `cancelled` or superseded.
  - The rollup shows the same conclusion.
  - No run is ever `skipped`.
  - Every run comes from the `PR diff guard` workflow (no copy from CI).
  - `gh run list --workflow=ci.yml --branch agent/44-guard-probe` shows the same run count before step 2 and after step 4 (label events do not re-run CI).

  Branch protection is live (found in round-1 review), so the probe also records `gh pr view <probe> --json mergeStateStatus`: `BLOCKED` while and after the newest run fails, and not blocked by the guard when the newest run succeeds despite older failed/cancelled runs on the same SHA. It also replays an old success run with `gh run rerun` while the label is absent, and expects failure because labels are read live. Run URLs go in the PR body. Then close the probe PR and delete the branch.

- `pnpm docs:check`, `pnpm fmt:check` exit 0.

Non-goals:

- The 400 threshold.
- The exclusion list and counting semantics.
- The `edited` (base-branch change) trigger: pre-existing, not requested.
- Applying branch protection.
- Other workflows and jobs.
- Stryker (#38).

Residual risk: a run from an older head that is queued late, or a `gh run rerun` of an old-head run, joins the per-PR group and can cancel the newer head's run. That head is then left with a `cancelled` check, or with no check at all ("Expected") if the run was still pending. Both fail closed, because neither is success, and any new event recovers it. Between an `unlabeled` event and the new run, the probe observed `BLOCKED` immediately, so it found no window where the old success counted.

Review focus:

- No `if:` and no `continue-on-error` anywhere on the guard job or steps.
- Fail-closed paths: label lookup, base, limit, git diff under pipefail.
- Byte-identical counting and messages.
- `ci.yml` diff limited to the removal.
- Token permissions: least privilege, no secrets beyond `github.token`.
