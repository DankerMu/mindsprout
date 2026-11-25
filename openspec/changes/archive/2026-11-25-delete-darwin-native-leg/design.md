# Design: delete-darwin-native-leg

Change surface: `.github/workflows/ci.yml`; `.github/PULL_REQUEST_TEMPLATE.md`; `.github/actions/native-installed-runtime/action.yml`; `scripts/native-hmr-profile.mjs` + `scripts/native-hmr-profile.test.mjs` (+ `scripts/native-hmr-profile-fixtures.mjs` only where exports become unused); decisions 0038 (new), 0037 (→ archived), back-links in 0020/0021/0027/0030; `docs/engineering/{native-hmr,enforcement-index,agent-operating-rules}.md`; OpenSpec deltas.

Must preserve:

- Linux job `native-installed-runtime` byte-identical in ci.yml; the composite action's Linux behavior: frozen install, `pnpm db:setup`, `native:installed`, integrity contract, Chromium `--with-deps`, `native:browser:test`, both browser modes, `pnpm build`, evidence upload (`native-installed-${{ github.sha }}-${{ inputs.target }}`, same paths, `if-no-files-found: error`).
- `all-checks-passed`: `if: always()`, the failed/cancelled/skipped grep, and `needs` = every other CI job.
- `parseNativeBrowserArgs`, the `--profile` opt-in, ambient-profiler refusal, profile collection/projection modules and their tests; decisions 0031/0035 deadlines and evidence attribution (their replay/CI-eligibility references gain 0038 back-links).
- Branch protection contexts unchanged (`All checks passed`, `Lockfile–manifest consistency`, `PR diff size guard`).

Must add/change: removals above; decision 0038; local macOS evidence rule in specs, decision, enforcement-index and CI protocol step 7.

Governing invariant: every CI job gates `All checks passed`; macOS native qualification exists only as cited local evidence on native-surface PRs; no Darwin-only CI code remains.

Sibling surfaces:

- Other workflows: `native-hmr.yml` (candidate, Linux-only, unchanged), `weekly.yml`, `lockfile-guard.yml`, `pr-diff-guard.yml`.
- Scripts reading platform or CI env: `scripts/native-hmr-profile.mjs` (selector), any other `process.platform === 'darwin'` logic in `scripts/native-*` (keep if used by local runs — e.g. macOS `/private/var` canonicalization, process-group handling).
- Specs: development-navigation (local-evidence ADDED; quarantine REMOVED; two requirements re-added without replay scenarios; DB preparation), ci-e2e-results (complete needs set).
- Decisions citing 0037, Darwin CI or replay: 0020 (0037 bullet deleted), 0021 `:25`, 0027 `:20/:22/:41`, 0030 `:23`, 0031 `:37`, 0035 (failure-scoped replay, replay eligibility); 0037 itself (archived with relinked paths).
- Evidence-selection surfaces agents read: `.github/PULL_REQUEST_TEMPLATE.md` `## Runtime evidence` (tracked) gains the native-surface line; `.claude/skills/pre-push-checks/SKILL.md` is untracked/gitignored (not editable here); root AGENTS.md has 13 bytes of headroom (not editable).
- Docs: native-hmr.md, enforcement-index.md, agent-operating-rules.md; README/CONTEXT/AGENTS (grep; root AGENTS.md untouched — at its 32 KiB local-guard budget).

Seams under test: the workflow/action YAML as parsed; `pnpm native:browser:test` (selector tests removed, remaining suites green); `pnpm dead-code` (no newly unreferenced exports); local `pnpm native:browser` both modes on macOS arm64.

Required evidence:

- YAML audit: list CI jobs; `all-checks-passed.needs` equals all others; no job named `native-installed-runtime-darwin`; `grep -rn -i 'macos\|darwin\|sw_vers' .github/workflows/ .github/actions/` returns nothing (the PR template legitimately names macOS arm64).
- `git grep -n -i 'darwin\|macos-26\|quarantin\|0037\|select-diagnostic\|selectNativeDiagnostic'` on the head with every hit dispositioned (allowed: archived 0037, 0038, historical archive/changes, package names like `@next/swc-darwin-arm64`, `patches/native/published/darwin-arm64.json`, local-run platform logic).
- Commands: `pnpm native:browser:test`, `pnpm test:guardrails`, `pnpm lint`, `pnpm typecheck`, `pnpm dead-code`, `pnpm duplicate-code`, `pnpm decisions:check`, `pnpm docs:check`, `pnpm fmt:check`, `openspec validate delete-darwin-native-leg --strict --no-interactive` exit 0.
- Local (orchestrator, PR head, clean tree): `pnpm native:browser restored-lifecycle` and `source-change` with owned `app_native` URLs → `status: passed`.
- PR CI: all jobs green, Linux native leg passed, aggregate `NEEDS` lists every job.

Non-goals: changing deadlines/profiling semantics; the Linux candidate workflow; branch protection; fixing the macOS runner latency; root AGENTS.md.

Review focus: (1) Linux leg unchanged; (2) dead-code closure complete and nothing still-used deleted (fixtures, helpers shared with `--profile`); (3) local-evidence rule consistent across spec, 0038, enforcement-index, step 7, native-hmr.md, and covers Renovate; (4) 0037 retirement folds its alternatives and fixes every link; (5) spec REMOVED+ADDED preserves every non-replay scenario verbatim.
