## ADDED Requirements

### Requirement: Debug-level mutation runs initialize with the repository Vitest config

Enabling Stryker debug logging SHALL NOT change whether the Vitest runner initializes or which tests run. Logging the resolved Vitest configuration MUST tolerate circular and non-JSON values while still emitting the configuration content for diagnosis.

#### Scenario: Circular resolved Vitest config at debug level

- **WHEN** a mutation run starts with debug logging and the resolved Vitest config contains a circular reference such as `resolvedProjects[0].viteConfig.test`
- **THEN** runner initialization completes and the initial test run starts
- **AND** the debug log contains a `vitest final config:` message naming the top-level keys `root`, `include` and `resolvedProjects`
- **AND** an info-level run executes the same number of initial tests and logs no `vitest final config:` message
