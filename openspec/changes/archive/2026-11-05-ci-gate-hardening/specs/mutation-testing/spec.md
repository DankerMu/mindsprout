# Spec Delta

## ADDED Requirements

### Requirement: Mutation testing runs under the repository's pnpm layout

`pnpm mutation` SHALL load the vitest test runner under pnpm's default isolated layout and write the HTML report to `reports/mutation/index.html`. Survivors are advisory and never fail the run.

#### Scenario: Weekly mutation job

- **WHEN** the weekly `Mutation testing (stryker, advisory)` job runs
- **THEN** it completes without "Cannot find TestRunner plugin" and uploads the `mutation-report` artifact
