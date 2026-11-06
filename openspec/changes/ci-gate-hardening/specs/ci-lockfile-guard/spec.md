# Spec Delta

## ADDED Requirements

### Requirement: Lockfile-only changes need the current exemption label

The `Lockfile–manifest consistency` check SHALL fail when the pull request changes `pnpm-lock.yaml` without changing `package.json`, unless the pull request carries the label `lockfile-refresh` (exact name) at the time the check runs. It SHALL pass otherwise. It SHALL fail when the changed files cannot be determined.

#### Scenario: Label added when the PR is opened

- **WHEN** a lockfile-only PR is opened with `gh pr create --label lockfile-refresh`
- **THEN** the latest `Lockfile–manifest consistency` result for its head commit is success, with no close/reopen

#### Scenario: Unlabelled lockfile-only change fails

- **WHEN** a PR changes only `pnpm-lock.yaml` and carries no `lockfile-refresh` label
- **THEN** the check fails and names the `lockfile-refresh` label

#### Scenario: Manifest and lockfile together pass

- **WHEN** a PR changes both `package.json` and `pnpm-lock.yaml`
- **THEN** the check passes

#### Scenario: A similar label does not exempt

- **WHEN** a lockfile-only PR carries `not-lockfile-refresh`
- **THEN** the check fails

### Requirement: Label changes re-run the lockfile check and it is never skipped

Adding or removing a label on a pull request SHALL re-run `Lockfile–manifest consistency` against the PR's current labels, without re-running the rest of CI. The check SHALL never be reported as skipped for a pull request event.

#### Scenario: Exemption removed and restored

- **WHEN** `lockfile-refresh` is removed from a lockfile-only PR and then added back
- **THEN** the check re-runs and fails, then re-runs and passes
