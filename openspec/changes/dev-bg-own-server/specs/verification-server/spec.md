# Spec Delta

## ADDED Requirements

### Requirement: dev:bg reports only a server it started

`pnpm dev:bg` SHALL report success only for a server on `:3000` that it started in the same run, with that run's environment.

- When something already answers `/api/healthz` before the script starts its server, the script SHALL exit non-zero without starting one and SHALL name `:3000`.
- A server recorded in `.run/dev.pid` from an earlier run SHALL be stopped and replaced, never reused.
- When the started process exits before it is ready, or the health probe answers while that process is no longer alive, the script SHALL exit non-zero and SHALL NOT report the server as ready.

#### Scenario: Foreign server on the port

- **WHEN** a server that `pnpm dev:bg` did not start answers `/api/healthz` on `:3000` and `pnpm dev:bg` runs
- **THEN** it exits non-zero, does not print `ready`, does not start `pnpm dev`, and its error names `:3000`

#### Scenario: Server from an earlier run

- **WHEN** `.run/dev.pid` names a live server from an earlier run and `pnpm dev:bg` runs
- **THEN** that server is stopped and a new one is started with the current environment

#### Scenario: Server fails to start

- **WHEN** the started `pnpm dev` exits before the health probe succeeds
- **THEN** `pnpm dev:bg` exits non-zero at once with `dev server exited before ready` and the tail of `.run/dev.log`

#### Scenario: Another server answers after start

- **WHEN** the health probe answers while the process started by `pnpm dev:bg` is no longer alive
- **THEN** `pnpm dev:bg` exits non-zero, does not print `ready`, names `:3000` and leaves no `.run/dev.pid`

#### Scenario: Earlier server does not stop

- **WHEN** the earlier server from `.run/dev.pid` still answers `/api/healthz` after the stop and the wait
- **THEN** `pnpm dev:bg` exits non-zero without starting a server and names `:3000`
