# Proposal

## Why

Issue #119: `@stryker-mutator/util@10.1.1` `errorToString` returns `String(error)` for non-`Error` values (`dist/src/errors.js`). `String` throws `TypeError: Cannot convert object to primitive value` for values with no usable primitive conversion (for example a null-prototype error-like object rebuilt across a worker boundary). `VitestTestRunner.run` maps `ctx.state.errorsSet` through `errorToString`, so the formatter's own exception replaces the diagnostic and the runner crashes and restarts (15 of 3440 results in full run 42501453302; 8/895 in the earlier profile). Upstream candidate stryker-js#6226 is open and unreleased; 10.1.1 is the latest release. Owner decision 2026-11-11: deliver through a repository-side pnpm patch, using the mechanism of decision 0022.

## What Changes

- Add a pnpm `patchedDependencies` patch for `@stryker-mutator/util@10.1.1` whose `dist/src/errors.js` change mirrors stryker-js#6226: wrap the final `String(error)` in try/catch; on failure return `name: message` (+ `\n` + stack) when `message` is a string, else `Object.prototype.toString.call(error)`.
- Extend the installed-seam regression (`pnpm test:stryker-patch`) with formatter scenarios and a runner scenario through `VitestTestRunner` with an unstringifiable value in `errorsSet`.
- Add the patch to decision 0022's patch list and the dependency-patch instructions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- mutation-testing: Vitest runner error reporting never fails while formatting a collected error.

## Impact

`package.json` (`pnpm.patchedDependencies` entry), `pnpm-lock.yaml` (second patch entry, util snapshot key and its references under core/instrumenter/vitest-runner gain the patch hash; no version change), `patches/`, the existing regression file, decision 0022 (patch inventory), `docs/engineering/dependency-patches.md`. No `RuntimeError` reclassification, no mutation scope/budget/timeout change, no product change, no changeset.

## Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent
Blast radius: `errorToString` is shared by Stryker core (child-process workers, retry decorator, command runner, initializer) and the Vitest runner; a wrong patch changes error text everywhere Stryker reports errors, or breaks install.
Selected risk packs: Public API / CLI / script entry; Config / project setup; File IO / path safety / overwrite; Legacy compatibility / examples; Error handling / rollback / partial outputs; Release / packaging / dependency compatibility; Documentation / migration notes
Evidence floor: formatter + runner regression RED on unpatched util 10.1.1 then GREEN; existing `Error`/string/falsy outputs byte-identical; frozen install applies both patches; native install contract and #118 regression still pass.
