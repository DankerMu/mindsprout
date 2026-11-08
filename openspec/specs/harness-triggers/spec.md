# harness-triggers Specification

## Purpose

Ensure repository guardrail self-tests are discovered for every pull request independently of the more expensive, scoped mutation-testing workflow.

## Requirements

### Requirement: Guardrail self-tests run for every pull request

Every pull request SHALL trigger the existing Guardrail self-test and AGENTS command-table liveness checks without a changed-path allowlist. Their existing weekly schedule and manual entrypoints SHALL remain available. Guardrail contents, thresholds and enforcement severity SHALL remain unchanged.

#### Scenario: Gate configuration alone changes

- **WHEN** a PR changes only jscpd.json, constraints.yaml, .dependency-cruiser.cjs or a workflow file
- **THEN** Guardrail self-test appears in its actual checks and executes the repository self-test command

#### Scenario: Duplicate-code threshold parity is violated

- **WHEN** a temporary unmerged PR changes only jscpd.json threshold to5 while constraints.yaml retains2
- **THEN** Guardrail self-test runs and fails the existing d4 threshold-parity assertion

### Requirement: Mutation discovery is separate and bounded

Mutation testing SHALL run weekly and remain manually invocable in its own workflow. Pull requests changing stryker.config.mjs, vitest.config.ts, package.json, pnpm-lock.yaml, .tool-versions or the mutation workflow SHALL trigger it. Unrelated PR paths SHALL NOT trigger mutation solely because guardrail or liveness checks run. The mutation command, advisory status,30-minute timeout and report upload behavior SHALL remain unchanged.

#### Scenario: Mutation configuration alone changes

- **WHEN** a PR changes only stryker.config.mjs
- **THEN** the genuine mutation job is dispatched by the dedicated mutation workflow for that PR

#### Scenario: Gate-only change does not require mutation

- **WHEN** a PR changes only jscpd.json
- **THEN** guardrail and liveness checks run independently without dispatching the mutation workflow for that PR
