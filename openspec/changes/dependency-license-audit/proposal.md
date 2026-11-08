# Proposal

## Why

Issue #68 exposes an unenforced, ambiguous license allowlist. The current installed tree contains licenses outside its six entries, including direct-runtime postgres. The owner approved a blocking metadata audit over each platform's complete installed dependency tree, six additional general licenses, and exact-version exceptions for existing MPL/LGPL packages (issue comment6718121355).

## What Changes

- Make dependencies.allowed_licenses in constraints.yaml the single policy source: explicit installed-all scope, approved IDs, two exact-name/version/license exception groups with rationale and exit conditions, and blocking enforcement.
- Add pnpm licenses:check and focused Node contract tests. Audit native pnpm licenses list --json without prod/dev/optional filters; fail closed on unknown licenses, malformed policy/inventory or inventory-command failure.
- Wire the tests and audit into local anti-drift/check and the existing CI anti-drift job. Retain all current required-check identities and thresholds.
- Use yaml2.9.1 as a direct dev dependency to parse the YAML policy, reusing its already-locked version (ISC; published2026-09-11). No dependency upgrades or hand-edited lockfile.
- Align the existing stack rules, AGENTS command/enforcement/verification rows and constraints verification surface; record the accepted policy before replacing the old rule.

## Capabilities

### New Capabilities

- `dependency-licenses`: declared-license enforcement for the full installed project dependency tree on the running platform.

### Modified Capabilities

None.

## Impact

scripts/check-licenses.mjs and its Node test file, package.json/pnpm-lock.yaml, constraints.yaml, the existing CI anti-drift job, AGENTS.md, docs/engineering/typescript-rules.md and a process decision. No application, provider, database or production dependency change.

## Fixture triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: absent; new CLI, policy schema and CI gate require expanded.
Blast radius: a fail-open checker admits unapproved dependencies; an overbroad exception or missed version misrepresents policy compliance.
Selected risk packs: Public API / CLI / script entry; Config / project setup; File IO / path safety / overwrite; Schema / columns / units / field names; Auth / permissions / secrets; Concurrency / shared state / ordering; Resource limits / large input / discovery; Legacy compatibility / examples; Error handling / rollback / partial outputs; Release / packaging / dependency compatibility; Documentation / migration notes.
Evidence floor: semantic RED at the callable native-inventory boundary before enforcement, incremental CLI contract tests, real installed-tree audit on macOS/Linux CI, unmerged forbidden-license dependency probe rejected by the CI audit step, guardrails/docs/decisions/lint/typecheck/frozen-install checks, full-depth review and owner policy approval.
