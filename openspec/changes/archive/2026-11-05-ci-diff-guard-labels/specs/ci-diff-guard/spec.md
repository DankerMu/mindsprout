# Spec Delta

## ADDED Requirements

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
