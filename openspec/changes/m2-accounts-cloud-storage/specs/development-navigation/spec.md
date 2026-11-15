# development-navigation Specification (delta)

## ADDED Requirements

### Requirement: Browser tests declare expected HTTP errors

A browser test SHALL declare each expected non-2xx response by URL pattern and status. The shared collector SHALL suppress a `Failed to load resource` console error only when the message's URL and status match an actual observed response satisfying a declaration. It SHALL retain all other errors, warnings and page errors, report declarations never observed, and leave undeclared specs' console behavior unchanged.

#### Scenario: Matched declaration versus mismatched or unused declaration

- **WHEN** a signed-out page receives `/api/auth/session` with status 401
- **THEN** a declaration for that URL with status 401 suppresses only its corresponding resource-load error, while an undeclared response or a status-404 declaration remains reported and the unused declaration is also reported

#### Scenario: Unrelated browser error beside a declared response

- **WHEN** a page emits a `console.error` next to an observed response that satisfies its declaration
- **THEN** the collector retains the page's unrelated error

### Requirement: Native browser probes use an isolated signed-in account

Each native HMR CI leg SHALL prepare a reachable job-local Postgres 16 database with `pnpm db:setup` and both application and migration URLs. Before creating its first page, the probe SHALL register a fresh user through its browser context and verify that `/api/auth/session` returns that username from the same context. It SHALL preserve both native navigation scenarios and their existing timing, console, cleanup and artifact gates.

#### Scenario: Linux and macOS database preparation

- **WHEN** either required native HMR leg starts
- **THEN** Linux uses a healthy Postgres 16 service container and macOS uses an owned ready Postgres 16 cluster, and both run `pnpm db:setup` before either browser scenario

#### Scenario: Session established before public map creation

- **WHEN** the probe creates its browser context
- **THEN** registration and a same-username session check succeed through that context before its first page opens, and the session remains usable across the existing restored-lifecycle restarts without re-registration or expected non-2xx browser noise
