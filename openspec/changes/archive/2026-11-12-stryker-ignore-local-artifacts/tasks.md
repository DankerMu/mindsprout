# Tasks

## 1. Sandbox input scope

- [x] 1.1 Confirm the RED baseline from the recorded working-root dry run (`.workplans/118/review/dryrun-info-workroot.log`: `Found 44 of 31574`, heap OOM); do not rerun the 7 GB failure solely to confirm it. Record the current counts in `.workplans/135/baseline-counts.txt`: `find` of files outside Stryker's built-in ignores, `.run/` and `.workplans/` file counts, `git ls-files -co --exclude-standard`.
- [x] 1.2 Add `ignorePatterns: ['/.run', '/.workplans']` to `stryker.config.mjs` with a one-line inline comment naming the OOM failure mode. No other key changes.
- [x] 1.3 In the working root with `.run/` and `.workplans/` present, run `pnpm exec stryker run --dryRunOnly --logLevel info`, saving the log under `.workplans/135/`. Require each of:
  - exit 0, no heap OOM;
  - `Found 44 of N file(s)` with N equal (± files created between counts) to the 1.1 `find` count minus the `.run/` and `.workplans/` counts — about 2.2k at fixture time (31665 − 16042 − 13437 = 2186), not ~31k;
  - 44 mutated source files;
  - mutant count M equal to the clean-checkout number from 1.5;
  - initial test count equal to the clean-checkout number from 1.5.
- [x] 1.4 While the sandbox exists (or from a `--cleanTempDir false` run), assert `.stryker-tmp/sandbox-*` contains no `.run` or `.workplans` entry; then remove the temp dir.
- [x] 1.5 `pnpm fmt:check`, `pnpm lint`, and exact-head CI. From the PR's `Mutation testing (stryker, advisory)` job log (also `reports/mutation/console.log`, `.github/workflows/mutation.yml:308`), read `Instrumented 44 source file(s) with <M> mutant(s)` and the initial-test count. CI is a clean checkout where the new patterns match nothing, so it is the clean baseline that 1.3 must equal exactly.
- [x] 1.6 State the AC2 deviation in the PR `偏离记录`: N is ~2.2k, not "close to" the 420 `git ls-files` count, because gitignored local agent tooling under `.omp/` (880 files) and `.claude/` (~850 files), 24 MB in total, stays in Stryker's input set. It cannot change the test set: `vitest.config.ts` includes only `src/**/*.test.ts(x)`, and those trees hold no such files. The issue limits the list to confirmed artifact directories.

## Risk packs

- Config / project setup — selected: Stryker project-file discovery changes (dev-tool config, not production config). Evidence: exact one-key diff; 1.3 counts.
- Resource limits / large input / discovery — selected: the defect is unbounded sandbox copy of local artifacts. Evidence: 1.3 dry run without OOM and N per the 1.3 formula; 1.4 sandbox listing.
- Legacy compatibility / examples — selected, scope preservation only (no legacy callers, formats or examples are involved, so this does not trigger `expanded`): mutation scope and initial tests must not shrink. Evidence: 1.3 counts equal the 1.5 CI clean-checkout counts.
- Public API / CLI / script entry — not selected: `pnpm mutation` and `stryker run` invocations are unchanged; only their config file changes.
- File IO / path safety / overwrite — not selected: Stryker's own copy mechanism is unchanged; no new paths are written.
- Schema; Auth / secrets; Concurrency; Release / packaging; Documentation — not selected: no schema, credentials, shared state, dependency or documented-behavior change.
- Non-goals: cleaning or relocating `.run/`/`.workplans/`; mirroring `.gitignore`; other tools' ignore lists; excluding the small gitignored `.omp/`/`.claude/` tooling trees (not a measured OOM contributor; see 1.6).
