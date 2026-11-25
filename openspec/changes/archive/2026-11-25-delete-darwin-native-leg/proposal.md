# Proposal: delete-darwin-native-leg

Issue type: test
Fixture level: expanded
Upstream suggested level: absent (expanded: `.github/workflows/` and `.github/actions/` are critical paths; changes which platform gates native merges; deletes CI-only diagnostic code)
Blast radius: a wrong edit could drop another required job, break the Linux installed-native leg the action still serves, leave dead Darwin-only code, or let native package/probe changes merge without any macOS proof.
Selected risk packs: Config / project setup; Error handling / rollback / partial outputs; Legacy compatibility / examples; Documentation / migration notes; Release / packaging / dependency compatibility.
Evidence floor: YAML audit (needs = every other CI job, no Darwin job, no `runner.os == 'macOS'`/`RUNNER_OS` macOS branch left in the action); `pnpm native:browser:test`, `pnpm test:guardrails`, `pnpm lint`, `pnpm typecheck`, `pnpm dead-code`, `pnpm decisions:check`, `pnpm docs:check`, `pnpm fmt:check`, strict OpenSpec validation; local macOS arm64 `pnpm native:browser restored-lifecycle` and `source-change` passing on the PR head (this PR is itself native-surface); PR CI green with the Linux native leg passing.

## Why

Issue #286. The Darwin installed-native leg failed ~47% of attempts on unrelated changes; two diagnosis rounds found no repair within decision 0031; decision 0037 quarantined it, but the 14-day flaky rule still requires fix or delete, and the quarantined red runs broke the installed agent workflow's CI gate (#292). The owner chose deletion with local macOS evidence on 2026-11-25 (transcribed: https://github.com/DankerMu/mindsprout/issues/286#issuecomment-7153701226).

## What Changes

- `.github/workflows/ci.yml`: delete the `native-installed-runtime-darwin` job and its quarantine comment.
- `.github/actions/native-installed-runtime/action.yml`: remove the macOS branches (`sw_vers`, non-Linux Chromium install) and the CI-only "Diagnose a failed Darwin browser qualification" step and its upload; keep `inputs.target`, the Linux steps and uploads unchanged.
- `scripts/native-hmr-profile.mjs`: delete `selectNativeDiagnostic`, helpers used only by it, and the `--select-diagnostic` CLI block; delete their tests and any fixture helpers used only by them. `parseNativeBrowserArgs` and `--profile` remain.
- Decision 0038 (new) fully supersedes 0037 (alternatives and ratchet folded in). 0037 moves to `decisions/archived/testing/` with its links fixed and its sha256 in `MANIFEST.json`. Back-links: 0021/0027/0030 replace their 0037 bullet with an exact-sentence 0038 bullet; 0031 and 0035 gain one; 0020's 0037 bullet is deleted.
- `.github/PULL_REQUEST_TEMPLATE.md`: one Runtime-evidence line for native-surface local macOS evidence.
- Diff: deletion-dominated, over 400 lines; `diff-limit-exempt` with justification (no split: selector must go with its only caller).
- Docs: `native-hmr.md` (aggregate paragraph, "Failure-scoped CI diagnosis" section, Known Limitations, any other Darwin-CI sentence), `enforcement-index.md` (`## Quarantined CI jobs` → local macOS evidence rule; line-3 sentence), `agent-operating-rules.md` CI protocol step 7 (→ local-evidence rule; no quarantined jobs remain).
- Specs: development-navigation ADDED local-evidence requirement; REMOVED quarantine requirement; replay scenarios removed by REMOVED+ADDED of two requirements under new names (OpenSpec forbids dropping scenarios via MODIFIED); database-preparation scenario rewritten; ci-e2e-results restores "complete needs set".
- Closes #286. #292 is closed separately after merge once main's run shows no non-required job.
