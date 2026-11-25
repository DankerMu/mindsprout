# Enforcement index — detail

Detail relocated from `AGENTS.md ## Enforcement Index`, which keeps one row per rule and links here. `## Quarantined CI jobs` has no root row; agents reach it through the binding CI protocol in [agent-operating-rules.md](agent-operating-rules.md#debugging-ci-failures).

## Branch protection (applied)

- Where it lives: GitHub classic branch protection on `main` (rulesets unused).
- Inspect: `gh api repos/DankerMu/mindsprout/branches/main/protection`; confirm `required_status_checks.checks` contains exactly the three context/`app_id` pairs below, `required_status_checks.strict: true`, and `enforce_admins.enabled: false`.
- Required checks: `All checks passed`, `Lockfile–manifest consistency`, `PR diff size guard` — all pinned to GitHub Actions (`app_id: 15368`; [decision 0013](../../decisions/implemented/process/0013-pin-required-checks-to-github-actions.md)).
- Level: gate (applied: strict up-to-date, three required checks, linear history, no force-push or deletion; `enforce_admins: false` — admins can bypass).

## Agent write-time deny list

- `.claude/settings.json` `permissions.deny` blocks force-push (`git push --force*`, `git push -f*`), `--no-verify`, and `.env` reads (`.env`, `.env.local`, `.env.development`, `.env.test`, `.env.production`).
- Checked in Claude Code sessions only; pre-commit + CI remain the floor.

## Quarantined CI jobs

- `Installed native HMR (darwin-arm64)` is quarantined from `All checks passed` by [decision 0037](../../decisions/implemented/testing/0037-quarantine-darwin-native-leg.md). Issue [#286](https://github.com/DankerMu/mindsprout/issues/286) owns the exit, which is due 2026-12-08. The flaky marker is the comment on the job in `.github/workflows/ci.yml`.
- Native-surface exception: a PR that changes any of the following still needs a passed Darwin job on its head before merge, and cites that run in its runtime evidence. A rerun pass is accepted.
  - `scripts/native-*`
  - the Darwin job in `ci.yml`
  - `.github/actions/native-installed-runtime/`
  - `patches/native/`
  - the `@next/swc-*` overrides or their lockfile entries
- Checked by the reviewer agent and by the merging agent before merge, using step 7 of the [CI protocol](agent-operating-rules.md#debugging-ci-failures). No machine check enforces it. Level: review-only.
