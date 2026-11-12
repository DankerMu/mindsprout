# Tasks

## 1. Patch and regression

- [x] 1.1 Add the patched-runner regression first; parent records RED on unpatched installed `@stryker-mutator/vitest-runner@10.1.1` (circular JSON from debug config logging).
- [x] 1.2 Create the pnpm patch (`pnpm patch` / `patch-commit`) mirroring upstream stryker-js#6261 debug config formatting; regression GREEN; frozen install applies the patch; lockfile changes only by patch metadata.
- [x] 1.3 Real `stryker run --dryRunOnly` at debug level prints `vitest final config:` and `Initial test run succeeded. Ran N tests`; at info level the same N and no config line.

## 2. Mechanism, docs, merge

- [x] 2.1 Decision record for repo-maintained dependency patches (location, exact-version pin, loud failure on non-applying patch, removal via Renovate once upstream releases); developer doc; AGENTS.md command row and CI step for the regression; `pnpm test:guardrails`, docs/decisions gates.
- [ ] 2.2 Scoped checks, cross-review, exact-head CI, merge, archive.

## Risk packs

- Public API / CLI / script entry — selected: new `package.json` script + AGENTS.md row (command-table check) in 2.1; `stryker run` CLI behavior at debug/info in 1.3.
- Config / project setup — selected: `pnpm.patchedDependencies` and lockfile in 1.2; frozen install evidence; `stryker.config.mjs` unchanged.
- File IO / path safety / overwrite — selected: `init()` writes `stryker-setup-<worker>.js` into cwd and mutates env; regression uses a temp cwd, restores env, leaves the tree clean (1.1).
- Schema / columns / units / field names — not selected: no data or artifact schema change.
- Auth / permissions / secrets — not selected: no credentials; CI step uses existing job permissions.
- Concurrency / shared state / ordering — not selected: logging call only.
- Resource limits / large input / discovery — not selected: `%O` formatting depth is bounded by Node util.inspect defaults; noted for review, no new limits.
- Legacy compatibility / examples — selected: info path unchanged (1.3); installed versions unchanged (1.2).
- Error handling / rollback / partial outputs — selected: regression error-path scenario (stubbed `createVitest` throws → same rejection) in 1.1; non-applying patch fails frozen install (1.2); rollback is reverting patch + lockfile (2.1).
- Release / packaging / dependency compatibility — selected: exact-version patch; measured loud failure for a mismatched/non-applying patch (1.2); coexistence with `patches/native` overrides — `pnpm native:installed` and `pnpm native:install:test` still pass (1.2); Renovate interaction in the decision (2.1).
- Documentation / migration notes — selected: decision + doc in 2.1.
