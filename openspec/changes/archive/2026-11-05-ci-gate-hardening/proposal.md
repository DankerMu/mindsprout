# Proposal: ci-gate-hardening

## Why

Eight open issues describe gates and gate documentation that do not do what AGENTS.md and `constraints.yaml` say they do. The owner asked for all eight to be fixed in one PR (2026-11-05):

- **#61** — The staged naming guard reads git's C-quoted path output. As a result, non-ASCII or newline names under `tmp/` pass the guard, extensionless forbidden suffixes pass, and archive files with Chinese names are wrongly rejected.
- **#59** — The write-time naming guard rejects paths outside the repository (for example `/tmp/x.md`). This contradicts AGENTS.md, which says scratch files go to `/tmp/`.
- **#37** — `no-framework-in-domain-or-application` matches import specifiers, but depcruise compares rules against resolved `node_modules/...` paths, so the rule never fires.
- **#47** — `pnpm duplicate-code` never loads `jscpd.json`. Its ignore list, reporters and settings are dead, test files are counted, and the threshold is hard-coded in two places.
- **#38** — Stryker's plugin glob cannot find `@stryker-mutator/vitest-runner` under pnpm's isolated layout, so `pnpm mutation` has never run.
- **#49** — `Lockfile–manifest consistency` decides the `lockfile-refresh` exemption from the event payload (the same defect #44 fixed for the diff guard). The `lockfile-refresh` label also does not exist yet.
- **#40** — Decision 0006 is filed under the wrong kind directory, and both it and `constraints.yaml` claim test files are exempt from all "layer rules". In fact only `domain-is-pure` exempts them.
- **#53** — AGENTS.md says branch protection is "not yet applied" and lives in "GitHub rulesets". In fact classic branch protection is applied: strict, linear history, three required checks, `enforce_admins: false`.

## What Changes

- **Naming guard (`.git-hooks/check-naming.sh`):**
  - Staged mode reads NUL-separated raw paths (#61).
  - Path mode resolves an absolute path physically. A path outside the repository is accepted, because it can never be committed; a path inside the repository gets its repo-relative verdict, symlinked access included (#59).
  - Decision 0008 records the #59 boundary.
- **Boundaries (`.dependency-cruiser.cjs`):** `no-framework-in-domain-or-application` matches resolved `node_modules` paths in both pnpm layouts (#37). `constraints.yaml` `forbidden_import_patterns` mirrors the full package list.
- **Duplicate code:** `pnpm duplicate-code` loads `jscpd.json`, which is the only runtime threshold. A guardrail checks it against `constraints.yaml` `anti_drift.duplicate_code_threshold_percent` (#47).
- **Mutation:** `stryker.config.mjs` names the vitest runner plugin explicitly (#38).
- **Lockfile guard:** the job moves to its own label-triggered workflow, `.github/workflows/lockfile-guard.yml`. It reads live labels, has no `if:`, and its check name is unchanged. Its logic lives in `scripts/check-lockfile-pairs.sh`, which fails closed. The `lockfile-refresh` label is created (#49).
- **Decision 0006:** moved to `decisions/implemented/testing/0006-test-files-exempt-from-domain-is-pure.md`, and its wording and the `constraints.yaml` mirror are narrowed to `domain-is-pure` (#40).
- **AGENTS.md:** the Branch model and the Enforcement Index rows for branch protection, the lockfile guard and duplicate code match reality (#53, #49, #47).
- **`scripts/test-guardrails.sh`:** gains cases that prove each machine-checked fix.

## Capabilities

### New Capabilities

- `ci-lockfile-guard`: when `Lockfile–manifest consistency` passes, and how `lockfile-refresh` exempts a PR.
- `module-boundaries`: the framework-import ban in `domain/` and `application/`.
- `duplicate-code-gate`: which files the duplicate-code gate counts, and where its threshold comes from.
- `mutation-testing`: `pnpm mutation` runs under the repository's pnpm layout.

### Modified Capabilities

- `naming-guard`: staged paths are judged verbatim; write-time checks ignore paths outside the repository.

## Impact

- **Critical Paths touched:** `.git-hooks/`, `.github/workflows/` and `constraints.yaml` (gate integrity). This needs a full cross-review plus `pnpm test:guardrails` evidence, and a live probe PR for the lockfile guard.
- **Other files:** `.dependency-cruiser.cjs`, `package.json` (one script), `stryker.config.mjs`, `scripts/check-lockfile-pairs.sh` (new), `scripts/test-guardrails.sh`, `AGENTS.md`, `decisions/` (0006 moved, 0008 new), and `openspec/changes/m1-canvas/design.md` (one path reference).
- **Unchanged:** no threshold is lowered and no rule is relaxed except the #59 boundary, which has decision 0008. Required check names are unchanged.
- **Diff size:** over 400 lines, so the PR carries `diff-limit-exempt`. Justification: the owner asked for one PR.

## Fixture triage — issues #61, #38, #37, #47, #49, #59, #40, #53

```text
Issue type: bugfix (8 gate and gate-doc defects, one PR at the owner's request)
Fixture level: expanded
Upstream suggested level: none given (issue-scribe issues, each size S) — expanded triggers: production CI and gate config on Critical Paths (gate integrity), path matching (path safety), a shared hook used by pre-commit and the write-time hook, workflow concurrency and live-label reads, and decision-record moves
Blast radius: a wrong naming change lets scratch or versioned files into commits, or blocks every commit; a wrong boundaries regex either still never fires or rejects the current tree; loading jscpd.json can turn CI red; a lockfile-guard workflow that is skipped or reads stale labels silently passes a required check; wrong docs mislead every agent about the merge gate
Selected risk packs: Config / project setup; File IO / path safety; Public API / CLI / script entry; Concurrency / ordering; Auth / permissions; Error handling; Legacy compatibility; Documentation; Release / packaging
Evidence floor: pnpm test:guardrails (every new case plus every existing one); bites per issue; /bin/bash 3.2 runs of the hook; pnpm boundaries, pnpm duplicate-code (prints "Using config from"), pnpm decisions:check, pnpm docs:check, pnpm fmt:check, pnpm lint, pnpm test:unit; a local pnpm mutation run that loads the vitest runner and writes reports/mutation/index.html; the CI weekly mutation job green on this PR; a live probe PR for the lockfile guard (label at creation passes once, removing it re-runs and fails, adding it back passes, never skipped); gh api branch-protection output for #53
```
