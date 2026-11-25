# Tasks

## 1. Quarantine

- [x] 1.1 `.github/workflows/ci.yml`: delete `- native-installed-runtime-darwin` from `all-checks-passed.needs`; add a comment above the `native-installed-runtime-darwin` job: `flaky: quarantined from All checks passed (decision 0037, #286); exit by 2026-12-08: restore to needs after 10 consecutive first-attempt Darwin passes incl. main pushes, or delete the leg`. No other workflow or action edits.
- [x] 1.2 Add `decisions/implemented/testing/0037-quarantine-darwin-native-leg.md` from the orchestrator draft (provided path); keep Problem/Decision/Alternatives considered/Consequences.
- [x] 1.3 Back-links (decision-record-lifecycle: partial supersession keeps both and cross-links): append one Consequences bullet to each of 0020, 0021, 0027, 0030: "[Decision 0037](<rel path>) partially supersedes only <the quoted sentence>: <one-clause effect>." Do not otherwise edit those records.
- [x] 1.4 `docs/engineering/enforcement-index.md`: add a `## Quarantined CI jobs` entry (rule, where it lives, where it is checked, level review-only) for the native-surface exception: native-surface PRs (`scripts/native-*`, the ci.yml Darwin job, `.github/actions/native-installed-runtime/`, `patches/native/`, `@next/swc-*` overrides/lockfile) need a passed Darwin job (decision 0037). Root AGENTS.md is not edited: it is 32,755 bytes, and the owner's local instruction guard rejects growth past 32 KiB. Agents reach the entry through step 7 of the binding CI protocol in `docs/engineering/agent-operating-rules.md`: merge on `gh pr checks --required`; quarantined failures do not trigger a fix loop; native-surface PRs wait for a Darwin pass.

## 2. Docs

- [x] 2.1 `docs/engineering/native-hmr.md`: (a) replace "The required **All checks passed** aggregate includes two independent jobs" / "Neither job cancels the other; neither may fail or be skipped." with the quarantined topology (Linux required; Darwin runs, reports its real result, not in the aggregate, decision 0037, #286); (b) fix "either required installed-package check" in the candidate paragraph; (c) Darwin diagnosis section "The original failed qualification, job, and required aggregate remain red" → qualification and job remain red, aggregate does not depend on Darwin while quarantined; (d) Known Limitations "Required installed qualification targets `macos-26` arm64 and Ubuntu 24.04 respectively" → Linux required, macOS quarantined (decision 0037, #286); state the native-surface exception once. Then grep (`grep -rn -i "required\|aggregate\|both platforms\|macos\|darwin"`) `docs/ AGENTS.md README.md CONTEXT.md` for any other sentence claiming Darwin gates merges and update it; list each hit and its disposition in the report.

## 3. Evidence

- [x] 3.1 YAML audit: parse ci.yml and print `all-checks-passed.needs` (8 entries, Linux included, Darwin absent); assert no `continue-on-error` key in ci.yml or `.github/actions/native-installed-runtime/action.yml`; `git diff origin/main -- .github/` shows only the removed line and comment lines.
- [x] 3.2 `pnpm test:guardrails`, `pnpm decisions:check`, `pnpm docs:check`, `pnpm fmt:check`, `openspec validate quarantine-darwin-native-leg --strict --no-interactive` exit 0.
- [x] 3.3 Commit messages and PR body reference `Refs #286` only — no closing keyword (#286 stays open owning the exit).
- [ ] 3.4 PR CI run (orchestrator): aggregate `NEEDS` echo lacks Darwin; Darwin job passed on the head (this PR is itself a native-surface PR; rerun pass accepted) and uploaded `native-installed-<sha>-darwin-arm64`.

## Risk packs

- Selected: Config / project setup - CI aggregate wiring; tasks 1.1, 3.1, 3.4.
- Selected: Error handling / rollback / partial outputs - Darwin failure must stay visible (no continue-on-error), evidence upload and diagnostic replay preserved; rollback = restore one line; tasks 1.1, 3.1, 3.4, decision 0037 Consequences.
- Selected: Legacy compatibility / examples - every other required job and branch-protection contexts preserved; decisions 0021/0030 partially superseded explicitly; tasks 1.2, 3.1.
- Selected: Documentation / migration notes - native-hmr.md, spec deltas, decision back-links, enforcement-index entry; tasks 1.3, 1.4, 2.1.
- Selected: Release / packaging / dependency compatibility - quarantine must not let native package/override/lockfile or shared-probe changes merge without macOS proof (0021:44, 0027:41); 0037 native-surface exception + Enforcement Index row, tasks 1.2, 1.4.
- Not selected: Public API / CLI / script entry - no scripts or routes change.
- Not selected: File IO / path safety / overwrite - artifact paths unchanged.
- Not selected: Schema / columns / units / field names - none.
- Not selected: Auth / permissions / secrets - workflow permissions untouched.
- Not selected: Concurrency / shared state / ordering - job ordering unchanged (Darwin still `needs: layer1-fast-checks`); the aggregate no longer waits for Darwin, which is the intent.
- Not selected: Resource limits / large input / discovery - runner and timeout unchanged.

## Non-goals

- Fixing Darwin readiness, changing deadlines/retries/warm-up, editing the composite action or probe scripts.
- Deleting the Darwin leg; changing branch protection or required contexts.
- Closing #286: it stays open owning the 2026-12-08 fix-or-delete exit.
