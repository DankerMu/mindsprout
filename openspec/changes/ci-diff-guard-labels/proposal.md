# Proposal: ci-diff-guard-labels

## Why

The `PR diff size guard` decides exemption from `github.event.pull_request.labels`, a snapshot of the triggering event, and `ci.yml` does not subscribe to `labeled` / `unlabeled` (issue #44). Two failures follow:

- `gh pr create --label diff-limit-exempt` adds the label in a second API call, so the `opened` payload can lack it and an exempt PR is blocked (PRs #43, #46, #48 needed close/reopen).
- Adding the label to a failed PR re-runs nothing.

AGENTS.md's "split or add `diff-limit-exempt`" path is therefore unreliable on a required check. While extracting the guard we also found it fails open: `git diff … | grep -c … || true` turns a failed `git diff` (bad base SHA) into a count of 0 and a pass.

## What Changes

- The guard moves out of `ci.yml` into its own workflow, `.github/workflows/pr-diff-guard.yml`. It triggers on `pull_request` types `opened, synchronize, reopened, labeled, unlabeled`, keeps job id `layer6-diff-size-guard` and check name `PR diff size guard`, and uses a per-PR concurrency group. Label changes re-run only this light job, not the whole CI (whose `cancel-in-progress` would otherwise restart).
- Exemption is decided from the PR's **live** labels, read from the GitHub API at run time, with exact name match. The event payload is no longer read.
- The counting logic moves verbatim into `scripts/check-diff-size.sh` so the guard can be red/green tested locally. The only behavioural change is that it fails closed: a missing or unresolvable base ref, or an unreadable limit, exits non-zero naming the reason.
- `scripts/test-guardrails.sh` gains diff-guard cases.
- `constraints.yaml` `enforced_by` and AGENTS.md's enforcement index point at the new file. `docs/engineering/agent-operating-rules.md` names only the unchanged job id and stays as is.

## Capabilities

### New Capabilities

- `ci-diff-guard`: when the PR diff size check passes or fails, and how the `diff-limit-exempt` label is honoured.

### Modified Capabilities

None.

## Impact

- `.github/workflows/ci.yml` (job removed), `.github/workflows/pr-diff-guard.yml` (new), `scripts/check-diff-size.sh` (new), `scripts/test-guardrails.sh`, `constraints.yaml` (`enforced_by` text only), `AGENTS.md`.
- Critical Path (gate integrity): full cross-review plus `pnpm test:guardrails` evidence plus a live probe PR.
- No change to the 400-line threshold, the exclusion pathspecs, or any other job.

## Fixture triage — issue #44

- Issue type: bug (CI gate defect). Upstream suggested level: none given (issue-scribe issue, size S).
- Fixture level: **expanded**. Triggers: production CI config on a required gate (gate integrity, Critical Path); concurrency between event runs.
- Blast radius: every PR that needs the exemption is blocked until close/reopen. A wrong fix could make the required check pass without running (skipped) or fail open, which silently removes the 400-line gate.
- Evidence floor: offline guardrail cases for the script, plus a live probe PR for triggers, concurrency and the check rollup.
- Risk packs:
  - Public API / script entry: new `scripts/check-diff-size.sh` interface.
  - Config / project setup: workflow triggers, permissions, `constraints.yaml`.
  - Auth / permissions / secrets: the token scope used to read labels.
  - Concurrency / ordering: racing runs per PR.
  - Legacy compatibility: check name, job id, output and error text.
  - Error handling: fail closed.
  - Documentation: references to the guard's location.
- Not fixed here (follow-up issues): `lockfile-consistency` has the same payload-label race; the root `pnpm-lock.yaml` is counted by the diff guard.
