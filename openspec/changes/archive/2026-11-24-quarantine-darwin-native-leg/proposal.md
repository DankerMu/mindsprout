# Proposal: quarantine-darwin-native-leg

Issue type: test
Fixture level: expanded
Upstream suggested level: absent (expanded: `.github/workflows/` is a critical path and the change alters which jobs gate merges; owner decision recorded below)
Blast radius: a wrong edit either leaves the 47%-flaky Darwin leg blocking merges, or silently drops another required job (or Linux) from `All checks passed`, or hides Darwin failures behind a green job.
Selected risk packs: Config / project setup; Error handling / rollback / partial outputs; Legacy compatibility / examples; Documentation / migration notes; Release / packaging / dependency compatibility.
Evidence floor: `pnpm test:guardrails` and `pnpm decisions:check`/`docs:check`/`fmt:check` green; YAML diff audit showing exactly one `needs` entry removed; on the PR's own CI run, the aggregate's echoed `NEEDS` lacks `native-installed-runtime-darwin` while the Darwin job still ran and uploaded `native-installed-<sha>-darwin-arm64`.

## Why

Issue #286. `Installed native HMR (darwin-arm64)` failed 20 of 43 counted attempts after #270 closed (fixed 5 s readiness deadlines on `macos-26`: 13 root Document commit, 5 first editor readiness, 2 reconnect), on unrelated changes including main pushes. It is a dependency of `All checks passed`, the required status check produced by `ci.yml`, so every flake blocks merges and forces reruns. AGENTS.md: a flaky test is quarantined with an issue, then fixed or deleted within 14 days. The owner chose quarantine (2026-11-24; transcribed at https://github.com/DankerMu/mindsprout/issues/286#issuecomment-7151720196).

## What Changes

- `.github/workflows/ci.yml`: remove `native-installed-runtime-darwin` from `all-checks-passed.needs`; add a quarantine comment on the Darwin job linking #286 with exit condition and 2026-12-08 deadline. Nothing else in the workflow, composite action, probe scripts or branch protection changes.
- New decision record `decisions/implemented/testing/0037-quarantine-darwin-native-leg.md`.
  - It partially supersedes single sentences in 0021 (two), 0027, 0020 and 0030, and each of those records gets a back-link line. 0031 and 0035 are unchanged.
  - Its native-surface exception keeps macOS proof mandatory for native package, override, lockfile and shared-probe changes.
  - The exit defaults to deleting the leg on 2026-12-08, and the quarantine never renews itself.
  - It records the ratchet reasoning and the step-split alternative.
- Docs: four sentences in `docs/engineering/native-hmr.md`. `docs/engineering/enforcement-index.md` gains a review-only "Quarantined CI jobs" entry for the native-surface exception. Root AGENTS.md is unchanged: it is 32,755 bytes, and the owner's local instruction guard rejects growing it past 32 KiB. Agents reach the entry through a new step 7 in the binding CI protocol (`docs/engineering/agent-operating-rules.md`). Branch protection contexts (`constraints.yaml`, `docs/engineering/enforcement-index.md`) are unchanged.
- #286 stays open after merge and owns the fix-or-delete obligation until the exit lands. Commits and the PR use `Refs #286`, never a closing keyword.
