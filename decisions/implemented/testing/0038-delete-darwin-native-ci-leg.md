---
id: 0038
title: Replace the Darwin installed-native CI leg with local macOS evidence
kind: testing
status: implemented
date: 2026-11-25
---

# Replace the Darwin installed-native CI leg with local macOS evidence

## Problem

`Installed native HMR (darwin-arm64)` failed 20 of 43 counted attempts after #270 closed. Every one of those failures was on a change unrelated to the probe. They were fixed five-second readiness deadlines expiring on the `macos-26` runner: 13 at root Document commit, 5 at first editor readiness and 2 at post-reconnect readiness ([#286](https://github.com/DankerMu/mindsprout/issues/286)).

Two diagnosis rounds, #199 and #270, found no repair that stays inside [decision 0031](0031-public-create-readiness-evidence.md)'s measurement contract. A quarantine, decision 0037, stopped the leg from blocking merges. The repository's flaky-test rule still required a fix or a deletion within 14 days. While quarantined, the leg also kept main's workflow runs red about half the time, and the installed agent workflow pack read that as a CI failure ([#292](https://github.com/DankerMu/mindsprout/issues/292)).

## Decision

The owner chose deletion on 2026-11-25 ([transcribed on #286](https://github.com/DankerMu/mindsprout/issues/286#issuecomment-7153701226)). Local evidence replaces the leg: a macOS arm64 developer machine qualifies the native surface.

- **CI.** Delete the `native-installed-runtime-darwin` job from `.github/workflows/ci.yml`. `All checks passed` again requires every CI job. The installed-native composite action becomes Linux-only: its macOS branches go, and so does the CI-only Darwin diagnostic replay step together with its upload.
- **Replay selector.** The selector existed only for that step. `selectNativeDiagnostic` and its helpers, the `--select-diagnostic` entry point and their tests are deleted with it. The opt-in `--profile` mode and its fixed projections remain unchanged, and they remain the way to diagnose a failure.
- **Local macOS evidence.** Some pull requests still need macOS proof. This covers any change to:
  - `scripts/native-*`
  - `.github/actions/native-installed-runtime/`
  - the native jobs in `ci.yml`
  - `patches/native/`
  - the `@next/swc-*` overrides or their lockfile entries

  It includes Renovate updates. Such a PR cites in `## Runtime evidence` a passed local macOS arm64 run of `pnpm native:browser restored-lifecycle` and `pnpm native:browser source-change` for its head, against the frozen installed tree. The citation gives the head SHA, command, exit code and the `result.json` status. Each run uses an owned Postgres 16 database prepared with `pnpm db:setup`, never a shared developer database. Without a macOS arm64 machine the PR is blocked, not exempt.

  This keeps [decision 0021](../bug-fix/0021-native-hmr-registration-maintenance.md)'s requirement that both platforms pass before merge or adoption, and [decision 0027](0027-signed-in-native-hmr-database.md)'s requirement that both platforms pass for shared-probe changes. The macOS half becomes local evidence instead of a CI job. Normal `postinstall` continues to run the installed-only guard on every macOS installation.

This decision fully supersedes decision 0037 (quarantine), which is retired to `archived/`. Its alternatives are folded in below.

## Alternatives considered

- **Keep the quarantine and fix the leg later.** The flaky-test rule allows quarantine only for 14 days. The leg kept main red and broke the installed workflow's CI gate. It never gave a merge decision that the Linux leg and local runs could not give.
- **Measure only client readiness and exclude server cold compilation.** This rewrites the measured qualification that [decision 0031](0031-public-create-readiness-evidence.md) fixes. It addresses only the 5 editor-readiness failures, not the 13 root Document commit timeouts.
- **Extend the deadline, add retries or warm routes before timing.** Decision 0031 rejects deadline extension and late evidence. Warm-up would hide real first-visit latency regressions. Both turn a failed attempt into an apparent success.
- **`continue-on-error`, or a separate required job for the stable macOS steps.** The stable steps are `native:installed`, the integrity contract, native unit tests and `pnpm build`. `continue-on-error` presents failures as passes. A second macOS job adds a full macOS installation per run and keeps the leg's cost. Only the installed guard also runs locally, in every macOS `postinstall`. The others no longer run on macOS anywhere; see Consequences.
- **Delete with no replacement evidence.** Native package, override or probe changes could then merge with no macOS browser proof. That would silently drop 0021's two-platform obligation.

## Consequences

- No CI job qualifies macOS. A macOS regression in native packaging or HMR behaviour is caught only by the local-evidence rule or by a developer's normal installation. Reviewers enforce the rule. It is review-only, listed in [the enforcement detail](../../../docs/engineering/enforcement-index.md), and prompted by the PR template's `## Runtime evidence` section.
- Dropped macOS coverage: the macOS corrupt-artifact installation contract (`pnpm native:install:test`), native unit tests (`pnpm native:browser:test`) and the production build with the installed addon no longer run on macOS anywhere. `postinstall` runs only the installed guard, and the local-evidence rule covers only the two browser modes. A macOS-only regression in those three is caught only when someone runs them by hand. This is an accepted cost of the owner's chosen scope.
- Local evidence is weaker than CI evidence. It depends on one developer machine and its toolchain, and the PR records it rather than reproducing it. In exchange, the 5 s budget is measured on hardware that represents the people the repair serves.
- `All checks passed` again depends on every CI job, so a workflow run's conclusion matches the required checks.
- Partial supersession, limited to the sentences quoted below. Each affected record gets a back-link.
  - [Decision 0021](../bug-fix/0021-native-hmr-registration-maintenance.md): "One installed-native CI matrix covers Ubuntu 24.04 Linux x64 GNU and `macos-26` arm64; each target exercises the guard, corrupt-artifact frozen installation, both browser modes and a production build."
    - Linux keeps all four.
    - macOS keeps the guard, through `postinstall`, and both browser modes, through local evidence.
    - The macOS corrupt-artifact installation contract, native unit tests and production build are dropped.
    - Its requirement of browser proof on both platforms before merge still holds, met through the local-evidence rule.
  - [Decision 0027](0027-signed-in-native-hmr-database.md): the `native-installed-runtime-darwin` job bullet, "`All checks passed` requires both job IDs" and "both installed CI platforms". There is now one CI job; macOS runs locally against an owned database.
  - [Decision 0030](0030-native-navigation-diagnostic-profiling.md): the bullet that allows one CI diagnostic execution after an eligible Darwin browser-step failure. The replay and its selector are deleted. Opt-in profiling, signal ownership and publication safety remain.
  - [Decision 0031](0031-public-create-readiness-evidence.md): "0030 retains ... CI eligibility". No CI eligibility remains.
  - [Decision 0035](0035-preserve-default-public-create-evidence.md): 0030's "failure-scoped replay" and "replay eligibility". No replay remains. Default evidence and its attribution are unchanged.
- [Decision 0020](0020-native-e2e-runtime-results.md) is no longer superseded: the complete needs set is restored, and the 0037 bullet in it is removed. 0031's and 0035's deadlines and evidence attribution are unchanged.
- Ratchet: the incident-to-constraint rule asks that the third same-class incident become a lint rule or hook. Here the deletion itself is the mechanical disposition: the flaky gate no longer exists, so no recurring authoring mistake remains for a rule to reject. The local-evidence rule is review-only. It is surfaced in the PR template and in the CI protocol, because no machine can check where a PR author's local run came from.
- Reintroducing a macOS CI leg needs its own decision. It must show 10 consecutive first-attempt passes on the candidate runner, including main pushes. Until then, the local-evidence rule stands.
- Rollback restores the job, the action's macOS branches, the replay step and the selector together from git history. Restoring them reopens #286.
