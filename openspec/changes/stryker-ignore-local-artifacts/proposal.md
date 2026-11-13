# Proposal

## Why

Issue #135: Stryker 10.1.1 does not read `.gitignore`; its project reader walks the whole cwd and only skips `node_modules`, `.git`, `.next` and a few built-ins (`@stryker-mutator/core/dist/src/fs/project-reader.js:10-41`). `stryker.config.mjs` sets no `ignorePatterns`, so in a local working root the gitignored run-evidence directories `.run/` (~16k files, 6.6G) and `.workplans/` (~13k files, 1.5G) become project files. The sandbox copy then exhausts the 4 GB heap before any test runner starts (`.workplans/118/review/dryrun-info-workroot.log`: `Found 44 of 31574 file(s)`, then `FATAL ERROR: Reached heap limit`). CI uses a clean checkout and is unaffected.

## What Changes

- Add `ignorePatterns: ['/.run', '/.workplans']` to `stryker.config.mjs` with an inline comment naming the failure mode. Root-anchored entries only; no `.gitignore` mirroring (issue's rejected alternative: negation and trailing-slash semantics differ from Stryker's minimatch rules).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- mutation-testing: local mutation runs exclude gitignored run-artifact directories from the sandbox.

## Impact

`stryker.config.mjs` only. `mutate`, `thresholds`, `coverageAnalysis`, reporters, timeouts, concurrency and CI budgets are unchanged. Touching `stryker.config.mjs` triggers `.github/workflows/mutation.yml` on the PR; that run is the CI-side "scope unchanged" evidence. No decision record: a local-artifact exclusion with an inline motivating comment is a mechanical config edit (AGENTS.md decision-record exemption), stated in the PR. No changeset (no user-visible change). `design.md` omitted (compact).

## Fixture triage

```text
Issue type: bug fix / development configuration
Fixture level: compact
Upstream suggested level: absent; compact because one isolated dev-tool config key changes (not production config), with no entrypoint invocation, schema or file IO behavior change; the selected legacy pack is scope preservation only, not legacy callers or formats.
Blast radius: an overbroad pattern removes files tests need from the sandbox (dry run fails or test count drops), or mutation scope shifts.
Selected risk packs: Config / project setup; Resource limits / large input / discovery; Legacy compatibility / examples.
Evidence floor: RED dry run in the polluted working root recorded before the change (existing log) plus a fresh GREEN `pnpm exec stryker run --dryRunOnly` in the same root showing N ≈ the 1.1 `find` count minus the `.run/` and `.workplans/` counts (~2.2k; AC2 deviation recorded per task 1.6), 44 mutated files, mutant and initial-test counts equal to the PR mutation job's clean-checkout baseline (task 1.5), and a sandbox free of `.run`/`.workplans`; exact-head CI including the mutation workflow.
```
