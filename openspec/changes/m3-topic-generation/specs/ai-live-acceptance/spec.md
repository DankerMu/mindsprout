# Spec Delta

## Purpose

Allow the owner's real provider key to verify M3's latency acceptance in exactly one opt-in local Playwright run, while every other test, check and CI job stays on the mock provider.

## ADDED Requirements

### Requirement: Default verification never calls a real provider

The following SHALL never call a real provider, whatever the local `.env` contains: unit, integration and contract tests; `pnpm smoke` against the `pnpm dev:bg` verification server; and the default `pnpm e2e` run. Servers started for verification SHALL run with the mock provider. The live spec SHALL NOT be collected by the default e2e run, so the run reports no skipped test.

#### Scenario: Default e2e

- **WHEN** `pnpm e2e` runs without `E2E_AI_LIVE`
- **THEN** the e2e server uses the mock provider, the live spec is not in the run's test list, and no test is reported as skipped

#### Scenario: Verification server ignores the configured provider

- **WHEN** `.env` configures a real provider and `pnpm dev:bg` starts the verification server
- **THEN** the server runs with the mock provider

### Requirement: Live mode is opt-in and local only

The live spec SHALL be collected and run only when `E2E_AI_LIVE=1`. In that mode, the e2e server SHALL use the AI configuration from the local `.env`. When `E2E_AI_LIVE=1` and `CI=true` are both set, the e2e server SHALL refuse to start and exit non-zero before any server or provider starts. A guardrail test SHALL prove this refusal on every pull request.

#### Scenario: Live under CI refused

- **WHEN** `E2E_AI_LIVE=1` and `CI=true`
- **THEN** the e2e server exits non-zero before starting and no provider is called

### Requirement: Live spec checks the M3 latency acceptance

The live spec SHALL generate once from a fixed topic on a new map and SHALL assert all of the following:

- the first generated node is visible within 6 seconds of submitting;
- the generation completes without an error notice within 10 seconds of submitting;
- at least one node lies two levels below the primary root;
- no node lies deeper than two levels below the primary root.

#### Scenario: Live run with the platform default

- **WHEN** the live spec runs with `AI_PROVIDER=anthropic`, dmxapi's Anthropic-native base URL and `deepseek-v4.1-flash-1017`
- **THEN** it passes only if the first node appears in under 6 seconds and the three-layer generation completes in under 10 seconds

#### Scenario: Live run with each adapter

- **WHEN** the live spec runs once with `AI_PROVIDER=openai-compatible` and once with a Claude model through the Anthropic-native endpoint
- **THEN** each run's pass or fail and its timings are recorded as acceptance evidence
