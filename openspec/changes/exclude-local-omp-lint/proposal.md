# Proposal

## Why

Default lint scans local `.omp/` hooks and workflow DSL that are not tracked project code, making the result depend on installed agent tooling. Issue #74 records the real default-command failure and the passing narrowly scoped override; this blocks the M1 epic's default-check closure.

## What Changes

- Add only root `.omp/**` to the existing ESLint global ignore list beside the other agent-tool directories.
- Record the tooling/source boundary without changing lint rules, typed checks, warning thresholds or package scripts.

## Capabilities

### New Capabilities

- `lint-scope`: default project lint excludes local OMP tooling while retaining project-source enforcement.

### Modified Capabilities

None.

## Impact

`eslint.config.mjs`, one process decision record, and this fixture. No application code, tests, dependencies, CI/hook implementation or local tooling files change.

## Fixture triage

```text
Issue type: bug fix / development configuration
Fixture level: expanded
Upstream suggested level: absent; expanded because the shared lint entrypoint's file-discovery boundary changes.
Blast radius: an overbroad ignore hides project violations, or only the pnpm wrapper works while direct ESLint still scans tooling.
Selected risk packs: Config / project setup; Public API / CLI / script entry; Resource limits / large input / discovery; Error handling / rollback / partial outputs; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: real scope-query RED→GREEN, default pnpm lint with actual local tooling present, deliberate source violation rejected through the unchanged lint rules, typecheck/format/docs/decisions and exact-head CI.
```
