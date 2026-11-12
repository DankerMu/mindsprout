# Tasks

## 1. Patch and regression

- [x] 1.1 Extend the installed-seam regression with the five formatter inputs and runner `dryRun` + `mutantRun` scenarios; parent records RED on unpatched `@stryker-mutator/util@10.1.1` with each input's listed unpatched error message.
- [x] 1.2 Create the util pnpm patch mirroring stryker-js#6226; regression GREEN; existing `errorToString` outputs unchanged; frozen install applies both patches; lockfile delta matches the measured list in design.md; measured negative path.
- [x] 1.3 Coexistence: #118 scenarios, `pnpm native:installed`, `pnpm native:install:test` pass.

## 2. Docs and merge

- [x] 2.1 Decision 0022 patch inventory and `docs/engineering/dependency-patches.md` (current patches, Known Limitations: unguarded exotic property access); docs/decisions gates; `pnpm test:guardrails` if any workflow/hook changes.
- [x] 2.2 Scoped checks, cross-review, exact-head CI, merge, archive.

## Risk packs

- Public API / CLI / script entry — selected: `errorToString` is an exported util function used across Stryker; existing-output table asserted (1.1–1.2); `pnpm test:stryker-patch` keeps its name.
- Config / project setup — selected: second `patchedDependencies` entry and lockfile (1.2).
- File IO / path safety / overwrite — selected: runner scenario reuses temp cwd + env restore; tree clean afterwards (1.1).
- Schema / columns / units / field names — not selected: no data/artifact schema change; error text format only, covered by Public API.
- Auth / permissions / secrets — not selected: no credentials or permissions.
- Concurrency / shared state / ordering — not selected: pure function; runner path is sequential.
- Resource limits / large input / discovery — not selected: no new allocation beyond one string; stack text passed through unchanged.
- Legacy compatibility / examples — selected: byte-identical outputs for non-throwing inputs (1.2); #118 patch coexistence (1.3).
- Error handling / rollback / partial outputs — selected: the fix itself; runner returns the original error result with all messages (1.1); rollback = revert patch + entry + lockfile (2.1).
- Release / packaging / dependency compatibility — selected: exact-version pin, measured negative path, native contract coexistence (1.2–1.3).
- Documentation / migration notes — selected: decision inventory + doc (2.1).
