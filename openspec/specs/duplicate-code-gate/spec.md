# duplicate-code-gate Specification

## Purpose

Which files the duplicate-code gate (`pnpm duplicate-code`, `jscpd.json`) counts and where its threshold comes from (`constraints.yaml` `anti_drift.duplicate_code_threshold_percent`).

## Requirements

### Requirement: The duplicate-code gate counts production code only, at the canonical threshold

`pnpm duplicate-code` SHALL load `jscpd.json`, exclude test and spec files (`**/*.test.*`, `**/*.spec.*`) from both the clones and the line count, and fail when duplication under `src` exceeds the threshold. The threshold that runs SHALL equal `constraints.yaml` `anti_drift.duplicate_code_threshold_percent`.

#### Scenario: Clone between test files

- **WHEN** two `*.test.ts` files share a duplicated block and production code has none
- **THEN** the gate passes

#### Scenario: Clone between production files

- **WHEN** two production `.ts` files share a duplicated block above the threshold
- **THEN** the gate fails

#### Scenario: Threshold drift

- **WHEN** the `jscpd.json` threshold differs from `anti_drift.duplicate_code_threshold_percent`
- **THEN** the guardrail self-test reports the mismatch
