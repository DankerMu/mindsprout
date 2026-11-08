# Spec Delta

## ADDED Requirements

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
