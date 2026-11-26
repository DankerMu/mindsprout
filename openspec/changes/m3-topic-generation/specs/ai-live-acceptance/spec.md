# Spec Delta

## Purpose

Allow the owner's real provider key to verify M3's latency acceptance in exactly one opt-in local Playwright run, while every other test, check and CI job stays on the mock provider.

## ADDED Requirements

### Requirement: Default verification never calls a real provider

Unit, integration, contract tests and the default `pnpm e2e` run SHALL use only the mock provider or injected transport fixtures. They SHALL NOT read provider keys. The e2e server SHALL force the mock provider unless live mode is explicitly enabled.

#### Scenario: Default e2e

- **WHEN** `pnpm e2e` runs without `E2E_AI_LIVE`
- **THEN** the e2e server runs with the mock provider and the live spec is skipped with a printed reason

### Requirement: Live mode is opt-in and local only

The live spec SHALL run only when `E2E_AI_LIVE=1`. In that mode, the e2e server SHALL use the AI configuration from the local `.env`. When `E2E_AI_LIVE=1` and `CI=true` are both set, the e2e server SHALL refuse to start and exit non-zero.

#### Scenario: Live under CI refused

- **WHEN** `E2E_AI_LIVE=1` and `CI=true`
- **THEN** the e2e server exits non-zero before starting and no provider is called

### Requirement: Live spec checks the M3 latency acceptance

The live spec SHALL generate once from a fixed topic on a new map. It SHALL assert that the first generated node is visible within 3 seconds of submitting. It SHALL assert that the generation completes without an error notice within 10 seconds of submitting, with at least one node two levels below the primary root. It SHALL also assert that no node lies deeper than two levels below the primary root.

#### Scenario: Live run with the platform provider

- **WHEN** the owner runs the live spec with the dmxapi configuration and `deepseek-v4.1-flash-1017`
- **THEN** the spec passes only if the first node appears in under 3 seconds and the three-layer generation completes in under 10 seconds
