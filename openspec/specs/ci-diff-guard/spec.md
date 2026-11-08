# ci-diff-guard Specification

## Purpose

When the required `PR diff size guard` check passes or fails, and how the `diff-limit-exempt` label exempts a pull request from the 400-line limit (`scripts/check-diff-size.sh`, `.github/workflows/pr-diff-guard.yml`).

## Requirements

### Requirement: The diff size guard honours the PR's current exemption label

The `PR diff size guard` check SHALL pass when the pull request currently carries the label `diff-limit-exempt` (exact name). Otherwise it SHALL count changed lines exactly as before: `git diff --diff-filter=ACMR --ignore-all-space <base>...HEAD`, excluding lockfiles, snapshots, changesets and decision records, counting lines matching `^[+-][^+-]`. It SHALL fail when the count exceeds `constraints.yaml` `size_limits.max_pr_diff_lines`. "Currently" means the PR's labels at the time the check runs, not the labels in the triggering event's payload.

#### Scenario: Label added in the same command that opens the PR

- **WHEN** a PR with more than 400 counted lines is opened with `gh pr create --label diff-limit-exempt`
- **THEN** the latest `PR diff size guard` result for its head commit is success, with no close/reopen or new push

#### Scenario: Unlabelled oversize PR fails

- **WHEN** a PR with 401 counted lines carries no `diff-limit-exempt` label (any other labels may be present)
- **THEN** the check fails and names the 400-line limit

#### Scenario: A similarly named label does not exempt

- **WHEN** an oversize PR carries `not-diff-limit-exempt` but not `diff-limit-exempt`
- **THEN** the check fails

#### Scenario: Boundary is inclusive

- **WHEN** a PR has exactly 400 counted lines and no exemption label
- **THEN** the check passes

### Requirement: Label changes re-run the guard

Adding or removing any label on a pull request SHALL re-run the `PR diff size guard` check against the PR's current labels, without re-running the rest of CI. The check SHALL never be reported as skipped for a pull request event, because GitHub treats a skipped required check as passing.

#### Scenario: Exemption added after a failure

- **WHEN** an oversize PR's guard has failed and `diff-limit-exempt` is then added
- **THEN** the guard runs again and its latest result is success

#### Scenario: Exemption removed

- **WHEN** `diff-limit-exempt` is removed from an oversize PR
- **THEN** the guard runs again and its latest result is failure

#### Scenario: Unrelated label change

- **WHEN** an unrelated label is added to an oversize, unexempt PR
- **THEN** the guard runs again and fails; it is not skipped

### Requirement: The guard fails closed

The guard SHALL fail, naming the reason, when it cannot determine the count: a missing or unresolvable base ref, an unreadable limit, or a failed label lookup. It SHALL NOT treat an error as zero changed lines.

#### Scenario: Unresolvable base

- **WHEN** the guard runs with a base ref that does not exist in the checkout
- **THEN** it exits non-zero and names the base ref, instead of reporting 0 lines

### Requirement: The required check identity is stable

The check name SHALL remain `PR diff size guard`, so branch protection's required-check list in AGENTS.md needs no change.

#### Scenario: Check name

- **WHEN** the guard runs on any pull request event
- **THEN** the check run is named `PR diff size guard`

### Requirement: Generated-file exclusions apply at every path depth

The diff guard SHALL exclude `pnpm-lock.yaml` files, files within `__snapshots__` directories and `*.snapshot` files at both repository root and nested paths. Ordinary files with merely similar names SHALL remain counted. A paired `package.json` change SHALL contribute its ordinary changed-line count even when its lockfile is excluded. Existing diff filtering, whitespace handling, line-count expression, threshold, exemption and fail-closed semantics SHALL remain unchanged.

#### Scenario: Root lockfile alone

- **WHEN** an unexempt committed diff contains only more than400 counted lines in root pnpm-lock.yaml
- **THEN** the guard reports0 counted lines and exits successfully

#### Scenario: Root lockfile and paired manifest

- **WHEN** an unexempt diff changes root pnpm-lock.yaml by more than400 counted lines and changes package.json by a known ordinary delta below the limit
- **THEN** the guard reports exactly the manifest's counted delta and succeeds

#### Scenario: Generated siblings and ordinary near-misses

- **WHEN** a diff includes root and nested lockfiles or snapshots together with ordinarily counted files whose names only resemble those exclusions
- **THEN** only the ordinary files contribute to the count, independently of directory depth

#### Scenario: Ordinary oversize diff remains rejected

- **WHEN** an unexempt diff contains401 ordinarily counted changed lines
- **THEN** the guard reports401 and fails against the unchanged400-line limit

#### Scenario: Historical lockfile correction

- **WHEN** the guard measures ad97d5b^...ad97d5b with no exemption
- **THEN** it reports1684 counted lines, removing only the8 previously counted root-lockfile lines, and still fails the400-line limit
