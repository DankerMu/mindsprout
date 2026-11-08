# required-check-sources Specification

## Purpose

Authenticate the required-check producers for the main branch while retaining the repository's existing merge prerequisites and administrator policy.

## Requirements

### Requirement: Required checks have an explicit trusted producer

Main branch protection SHALL require `All checks passed`, `Lockfile–manifest consistency` and `PR diff size guard` from GitHub Actions app 15368. Strict up-to-date checking SHALL remain enabled; administrator enforcement SHALL remain disabled. Changing the aggregate check's source SHALL preserve every unrelated protection setting and SHALL NOT introduce additional required contexts.

#### Scenario: Pin the aggregate source without changing policy

- **WHEN** the owner-approved aggregate-source update is applied to the existing main protection
- **THEN** all three required contexts have app_id 15368, strict remains true, enforce_admins remains false and every unrelated protection field is unchanged

#### Scenario: Genuine Actions checks remain compatible

- **WHEN** the change PR's final head receives successful required check runs from GitHub Actions app 15368
- **THEN** all three required checks are satisfied and the PR can merge without an administrator bypass or a fabricated status
