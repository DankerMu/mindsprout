# Tasks

## 1. CI and action

- [x] 1.1 `.github/workflows/ci.yml`: delete the `native-installed-runtime-darwin` job and its quarantine comment; nothing else changes.
- [x] 1.2 `.github/actions/native-installed-runtime/action.yml`: drop the macOS branch of runtime logging (`sw_vers`) and the non-Linux Chromium branch (keep the Linux commands as they run today); delete the "Diagnose a failed Darwin browser qualification" step and "Upload safe native diagnostic summary"; remove `id:`s only if nothing references them.

## 2. Dead diagnostic selector

- [x] 2.1 `scripts/native-hmr-profile.mjs`: delete `selectNativeDiagnostic`, every helper reachable only from it, and the `--select-diagnostic` main block, plus imports that become unused. Keep `parseNativeBrowserArgs` and everything `--profile` uses.
- [x] 2.2 `scripts/native-hmr-profile.test.mjs`: delete the selector tests; keep argument/ambient-refusal tests. Trim `scripts/native-hmr-profile-fixtures.mjs` exports only if no remaining file imports them (grep every `scripts/*.mjs`).
- [x] 2.3 `pnpm native:browser:test`, `pnpm dead-code`, `pnpm lint`, `pnpm typecheck`, `pnpm duplicate-code` green.

## 3. Decisions

- [x] 3.1 Add `decisions/implemented/testing/0038-delete-darwin-native-ci-leg.md` from the orchestrator draft (provided path).
- [x] 3.2 Retire 0037. Order matters because archived files are hash-frozen:
  - (a) `git mv decisions/implemented/testing/0037-quarantine-darwin-native-leg.md decisions/archived/testing/`.
  - (b) Set `status: archived`.
  - (c) Rewrite every relative link in it so it resolves from `decisions/archived/testing/`:
    - same-directory `00xx-*.md` → `../../implemented/testing/00xx-*.md`;
    - `../bug-fix/0021-*` → `../../implemented/bug-fix/0021-*`;
    - `../../../docs/...` stays the same depth.
  - (d) Check that every link resolves by script.
  - (e) Only then compute `shasum -a 256` and add `"decisions/archived/testing/0037-quarantine-darwin-native-leg.md": "<sha>"` to `decisions/archived/MANIFEST.json`.
  - (f) `pnpm decisions:check`.
- [x] 3.3 Back-links. Use a bullet of the form "[Decision 0038](rel) partially supersedes only <quoted sentence>: <effect>.", quoting exactly the sentences listed in the 0038 draft's Consequences:
  - 0021: replace its 0037 bullet with a 0038 bullet quoting `:25` "One installed-native CI matrix covers Ubuntu 24.04 Linux x64 GNU and `macos-26` arm64"; `:21` is kept, not superseded.
  - 0027: replace its 0037 bullet with a 0038 bullet citing the `:20` Darwin job bullet, `:22` "requires both job IDs" and `:41` "both installed CI platforms".
  - 0030: replace its 0037 bullet with a 0038 bullet citing the `:23` replay bullet.
  - 0031 and 0035: add a 0038 bullet each (0031 `:37` "CI eligibility"; 0035 "failure-scoped replay" / "replay eligibility").
  - 0020: **delete** its 0037 bullet; 0020 is no longer superseded.
  - No other edits.

## 4. Docs

- [x] 4.1 `docs/engineering/native-hmr.md`: aggregate paragraph (Linux-only CI job; macOS via local evidence), remove/replace "Failure-scoped CI diagnosis" (diagnosis is an explicit `--profile` run), Known Limitations (macOS qualified locally per 0038), and every other Darwin-CI/0037 sentence.
- [x] 4.2 `docs/engineering/enforcement-index.md`: replace `## Quarantined CI jobs` with `## Native-surface local macOS evidence` (paths, evidence fields, blocked-not-exempt, Renovate included, review-only, checked by reviewer and merging agent); update the line-3 sentence and anchor references.
- [x] 4.3 `docs/engineering/agent-operating-rules.md` CI protocol step 7: replace with the local-evidence rule (link the new anchor); no quarantined CI jobs remain.
- [x] 4.4 `.github/PULL_REQUEST_TEMPLATE.md` `## Runtime evidence` comment: add one line. A native-surface PR (paths per the enforcement detail) cites passed local macOS arm64 runs of `pnpm native:browser restored-lifecycle` and `source-change` for the head (SHA, command, exit code, `result.json` status); with no macOS arm64 machine it is blocked. The template is the tracked surface every PR author reads. `.claude/skills/pre-push-checks/SKILL.md` is an untracked, gitignored install and cannot carry the rule.
- [x] 4.5 `git grep` audit per design.md with per-hit disposition in the report.

## 5. Qualification

- [x] 5.1 `pnpm test:guardrails`, `pnpm decisions:check`, `pnpm docs:check`, `pnpm fmt:check`, `openspec validate delete-darwin-native-leg --strict --no-interactive`; YAML audit.
- [ ] 5.2 (orchestrator) Local macOS arm64 `pnpm native:browser restored-lifecycle` and `source-change` on the PR head with owned `app_native`; cite in PR runtime evidence.
- [ ] 5.3 (orchestrator) PR closes #286 with a closing keyword; CI green; aggregate `NEEDS` lists every job.
- [ ] 5.4 (orchestrator) Diff size: the change is deletion-dominated. The selector must go with its only caller, and the REMOVED+ADDED spec deltas copy two whole requirements, so the 400-line guard (`scripts/check-diff-size.sh`, which excludes only `decisions/**` and lockfiles/snapshots/changesets) will be exceeded. Apply the existing `diff-limit-exempt` label with this justification in the PR body. Do not split, because a split would leave dead CI-only code or a dangling action step on main between the two PRs.

## Risk packs

- Selected: Config / project setup - CI job deletion and aggregate wiring; tasks 1.1, 5.1, 5.3.
- Selected: Error handling / rollback / partial outputs - Linux evidence upload and failure behavior unchanged; rollback restores job+action+selector together (0038); tasks 1.2, 2.3.
- Selected: Legacy compatibility / examples - Linux leg and `--profile` keep working; supersession of 0020/0021/0027/0030/0037 explicit; tasks 2.1-2.3, 3.2, 3.3.
- Selected: Documentation / migration notes - docs, specs, enforcement detail, CI protocol, PR template; tasks 4.1-4.5.
- Selected: Release / packaging / dependency compatibility - macOS proof for native package/override/lockfile changes moves to local evidence incl. Renovate; tasks 3.1, 4.2-4.4, 5.2.
- Not selected: Public API / CLI / script entry - only the CI-internal `--select-diagnostic` mode is removed; `pnpm native:browser` CLI unchanged (task 2.1 keeps `parseNativeBrowserArgs`).
- Not selected: File IO / path safety / overwrite - no output path or cleanup changes.
- Not selected: Schema / columns / units / field names - none.
- Not selected: Auth / permissions / secrets - workflow permissions unchanged.
- Not selected: Concurrency / shared state / ordering - remaining job order unchanged.
- Not selected: Resource limits / large input / discovery - removes a job; no new limits.

## Non-goals

- Fixing macOS runner latency; changing deadlines, profiling or the Linux candidate workflow; branch protection; root AGENTS.md (local 32 KiB guard).
- Updating the installed agent-workflow pack (#292 closes as not applicable once no non-required job remains).
