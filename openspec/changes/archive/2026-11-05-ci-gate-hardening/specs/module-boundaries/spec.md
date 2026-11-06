# Spec Delta

## ADDED Requirements

### Requirement: Framework packages are banned from domain and application

`pnpm boundaries` SHALL fail when a file under `src/contexts/<ctx>/domain/` or `src/contexts/<ctx>/application/` imports `next`, `react`, `react-dom`, `drizzle-orm`, `postgres` or `@supabase/*`, and SHALL report the rule `no-framework-in-domain-or-application`. This holds in both pnpm layouts (hoisted and isolated).

#### Scenario: React in application

- **WHEN** a file under `src/contexts/map/application/` imports `react`
- **THEN** `pnpm boundaries` fails with `no-framework-in-domain-or-application`

#### Scenario: Postgres in application

- **WHEN** a file under `src/contexts/map/application/` imports `postgres`
- **THEN** `pnpm boundaries` fails with `no-framework-in-domain-or-application`

#### Scenario: React in domain

- **WHEN** a file under `src/contexts/map/domain/` imports `react`
- **THEN** `pnpm boundaries` reports both `domain-is-pure` and `no-framework-in-domain-or-application`
