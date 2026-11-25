---
id: 0037
title: Quarantine the Darwin installed-native leg from the required aggregate
kind: testing
status: archived
date: 2026-11-24
---

# Quarantine the Darwin installed-native leg from the required aggregate

## Problem

`Installed native HMR (darwin-arm64)` failed 20 of 43 counted attempts after #270 closed on 2026-11-23, on changes unrelated to the code under test, including docs-only PRs and 6 of 13 main pushes ([#286](https://github.com/DankerMu/mindsprout/issues/286)). The failures are fixed five-second readiness deadlines expiring on the `macos-26` runner: 13 at root Document commit, 5 at first editor readiness and 2 at post-reconnect readiness. The two diagnosis issues #199 and #270 delivered no repair. Because the leg is a dependency of `All checks passed`, the required status check produced by `ci.yml`, each such failure blocks merges and forces reruns. It also weakens the meaning of a red aggregate. The repository rule is to quarantine a flaky test with an issue, then fix or delete it within 14 days.

## Decision

The owner chose quarantine on 2026-11-24 ([transcribed on #286](https://github.com/DankerMu/mindsprout/issues/286#issuecomment-7151720196)). Remove `native-installed-runtime-darwin` from the `needs` of `all-checks-passed` in `.github/workflows/ci.yml`. Mark the job with a comment that links #286, names the exit condition and gives the deadline of 2026-12-08.

The job keeps its triggers, runner, steps, five-second deadlines, eligible Darwin diagnostic replay and always-uploaded evidence, so a failure still shows as a red job in the run. Nothing changes in the composite action, the probe scripts, the Linux leg, branch protection or the required contexts. Do not add `continue-on-error` at job or step level, because it would present a failed qualification as passing.

Exit condition: one of the following must land by 2026-12-08.

- **Restore.** A fix lands, and the leg then passes 10 consecutive first-attempt Darwin runs that include main pushes. Reruns do not count, and each run is recorded with a link. The same PR that cites this evidence puts the leg back in `needs`.
- **Delete.** The Darwin installed-native leg is removed by its own decision, which supersedes the macOS half of [decision 0021](../../implemented/bug-fix/0021-native-hmr-registration-maintenance.md)'s installed matrix.

#286 stays open and owns the obligation; PRs reference it without a closing keyword. The quarantine does not renew itself. If neither path has landed by 2026-12-08, the default is a PR that deletes the leg and references #286. Before that date the owner may instead record a new decision that sets a later deadline. Nothing else extends the quarantine.

Native-surface exception: a PR that changes native qualification surfaces still needs a passed `Installed native HMR (darwin-arm64)` job on its head before it merges. Those surfaces are:

- `scripts/native-*`
- the `native-installed-runtime-darwin` job in `.github/workflows/ci.yml`
- `.github/actions/native-installed-runtime/`
- `patches/native/`
- the `@next/swc-*` overrides in `package.json`, or their `pnpm-lock.yaml` entries

A pass on a rerun is accepted here: this is functional proof that the change works on macOS, not proof that the flake is fixed. The pass is cited in the PR's runtime evidence. This keeps [decision 0021](../../implemented/bug-fix/0021-native-hmr-registration-maintenance.md)'s requirement that both platforms pass before an upstream repair is adopted. It also keeps [decision 0027](../../implemented/testing/0027-signed-in-native-hmr-database.md)'s requirement that shared-probe changes pass on both installed platforms. The exception is review-only. It is recorded in [`docs/engineering/enforcement-index.md`](../../../docs/engineering/enforcement-index.md), and agents apply it through step 7 of the binding [CI protocol](../../../docs/engineering/agent-operating-rules.md#debugging-ci-failures). The root agent-rules index is unchanged: it is 32,755 bytes, and the owner's local instruction guard rejects edits that push it past 32 KiB. Growing it needs a separate repair of the root file.

## Alternatives considered

- **Measure only client readiness and exclude server cold compilation.** This rewrites the measured qualification that [decision 0031](../../implemented/testing/0031-public-create-readiness-evidence.md) fixes. It addresses only the 5 editor-readiness failures, not the 13 root Document commit timeouts, so the leg would remain flaky.
- **Extend the deadline, add retries or warm routes before timing.** [Decision 0031](../../implemented/testing/0031-public-create-readiness-evidence.md) rejects deadline extension and late evidence. Warm-up would hide real first-visit latency regressions. Both turn the original failed attempt into an apparent success.
- **`continue-on-error` on the job or the browser steps.** This would keep the non-flaky macOS checks required: `native:installed`, the integrity contract and `pnpm build`. The cost is that a failed browser step shows as a passed job, and the exit condition could no longer be counted from job conclusions.
- **Keep the stable macOS steps required and quarantine only the two browser steps.** The stable steps are `native:installed`, the integrity contract, native unit tests and `pnpm build`. Without `continue-on-error`, this needs a split: either the composite action is divided, or a second macOS job installs the tree again just for the browser steps. That means more workflow and action changes, a second macOS installation on every run, and a larger diff on a critical path. All of this would serve a quarantine meant to last at most two weeks. The native-surface exception above covers the main risk, which is regressions in native packaging.
- **Delete the Darwin leg now.** This removes the only installed macOS verification of the 0021 repair while a fix is still possible within the 14-day window.

## Consequences

- From this change until the exit, these macOS checks are advisory: installed-addon verification, the corrupt-artifact installation contract, native unit tests, both browser modes and the production build. A real macOS regression in any of them shows as a red job but no longer blocks a merge. The Linux leg remains required for the same steps.
- Agents merge on required checks (`gh pr checks <PR> --required`), not on a green workflow run, per step 7 of the CI protocol. The native-surface exception is the only case in which a Darwin result gates a merge.
- Partial supersession, limited to the sentences below. Each of those records links back here.
  - [Decision 0021](../../implemented/bug-fix/0021-native-hmr-registration-maintenance.md): "Both platforms require actual installed-package loading and browser proof ... before merge" and "Required `All checks passed` depends on the entire matrix". For Darwin this now holds only under the native-surface exception.
  - [Decision 0027](../../implemented/testing/0027-signed-in-native-hmr-database.md): "`All checks passed` requires both job IDs". It now requires the Linux job ID only.
  - [Decision 0020](../../implemented/testing/0020-native-e2e-runtime-results.md): "`All checks passed` retains its complete needs set". The set is complete except for the quarantined Darwin leg.
  - [Decision 0030](../../implemented/testing/0030-native-navigation-diagnostic-profiling.md): "The original step, job, and aggregate remain failed regardless of diagnostic success". The step and the job still remain failed. The aggregate no longer depends on Darwin.
- [Decision 0031](../../implemented/testing/0031-public-create-readiness-evidence.md) and [decision 0035](../../implemented/testing/0035-preserve-default-public-create-evidence.md) are unchanged: the same deadlines and the same evidence attribution apply. Decision 0027's database and sign-in topology is unchanged.
- Ratchet: the incident-to-constraint rule (`docs/engineering/agent-operating-rules.md`) asks that the third incident of the same class become a lint rule or a hook. It does not apply here. No recurring authoring mistake exists for a rule to reject; the failures are runner timing against a fixed qualification deadline. The deadline is not machine-enforced. It is owned by the open #286 and by the default deletion above. Reintroduction requires the 10-run evidence.
- Rollback restores the single `needs` entry. It restores the blocking behaviour this record removes.
