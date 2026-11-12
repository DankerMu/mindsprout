# Proposal

## Why

Issue #118: with Stryker debug logging enabled, `@stryker-mutator/vitest-runner@10.1.1` `VitestTestRunner.init` runs `JSON.stringify(this.ctx.config, null, 2)` (`dist/src/vitest-test-runner.js:153`). The resolved Vitest config is circular (`resolvedProjects[0].viteConfig.test`), so init throws before the initial test run (hosted run 42492687516). Upstream fix stryker-js#6261 is open and unreleased; 10.1.1 is the latest release. Owner decision 2026-11-11: deliver a repository-maintained pnpm patch.

## What Changes

- Add a pnpm `patchedDependencies` patch for `@stryker-mutator/vitest-runner@10.1.1` that logs the final Vitest config without throwing on circular structures, mirroring the upstream candidate (logger `%O` formatting) so removal is a clean revert once a fixed version ships.
- Add a regression that loads the installed (patched) runner and proves debug-enabled init with a circular Vitest-style config does not throw from config logging, still emits useful config content, and leaves the non-debug path unchanged.
- Add a decision record establishing the repo-maintained dependency patch mechanism: patch location, exact-version pinning, failure on non-applying patch, review obligations, and removal condition (upstream release via Renovate).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- mutation-testing: debug-level mutation runs reach the initial test run with the repository's Vitest config.

## Impact

`package.json` (`pnpm.patchedDependencies`), `pnpm-lock.yaml` (patch hash only, no version change), `patches/`, one regression test plus its script/CI wiring, a decision record, docs. No mutation scope, thresholds, timeouts, budgets or `stryker.config.mjs` change. No product behavior change; no changeset.

## Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent
Blast radius: every `pnpm install` applies the patch; a bad patch breaks install or mutation runs; a silently stale patch could mask an upstream fix.
Selected risk packs: Public API / CLI / script entry; Config / project setup; File IO / path safety / overwrite; Legacy compatibility / examples; Error handling / rollback / partial outputs; Release / packaging / dependency compatibility; Documentation / migration notes
Evidence floor: patched-runner regression RED on unpatched 10.1.1 then GREEN; real `stryker run --dryRunOnly` at debug level reaches and completes the initial test run; `pnpm install --frozen-lockfile` applies the patch; lockfile guard, guardrails, anti-drift green.
