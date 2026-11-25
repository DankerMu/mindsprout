# Enforcement index — detail

Detail relocated from `AGENTS.md ## Enforcement Index`, which keeps one row per rule and links here. `## Native-surface local macOS evidence` has no root row; agents reach it through the binding CI protocol in [agent-operating-rules.md](agent-operating-rules.md#debugging-ci-failures) and the PR template's `## Runtime evidence` section.

## Branch protection (applied)

- Where it lives: GitHub classic branch protection on `main` (rulesets unused).
- Inspect: `gh api repos/DankerMu/mindsprout/branches/main/protection`; confirm `required_status_checks.checks` contains exactly the three context/`app_id` pairs below, `required_status_checks.strict: true`, and `enforce_admins.enabled: false`.
- Required checks: `All checks passed`, `Lockfile–manifest consistency`, `PR diff size guard` — all pinned to GitHub Actions (`app_id: 15368`; [decision 0013](../../decisions/implemented/process/0013-pin-required-checks-to-github-actions.md)).
- Level: gate (applied: strict up-to-date, three required checks, linear history, no force-push or deletion; `enforce_admins: false` — admins can bypass).

## Agent write-time deny list

- `.claude/settings.json` `permissions.deny` blocks force-push (`git push --force*`, `git push -f*`), `--no-verify`, and `.env` reads (`.env`, `.env.local`, `.env.development`, `.env.test`, `.env.production`).
- Checked in Claude Code sessions only; pre-commit + CI remain the floor.

## Native-surface local macOS evidence

- CI qualifies the installed native package and both browser modes on Linux x64 GNU only, as a dependency of `All checks passed`. [Decision 0038](../../decisions/implemented/testing/0038-delete-darwin-native-ci-leg.md) deleted the Darwin CI leg ([#286](https://github.com/DankerMu/mindsprout/issues/286)); no CI job is quarantined.
- A PR, including a Renovate update, that changes any of the following needs local macOS arm64 evidence before merge:
  - `scripts/native-*`
  - `.github/actions/native-installed-runtime/`
  - the native jobs in `.github/workflows/ci.yml`
  - `patches/native/`
  - the `@next/swc-*` overrides or their lockfile entries
- Evidence: its `## Runtime evidence` cites, for the PR head, a passed local macOS arm64 run of `pnpm native:browser restored-lifecycle` and `pnpm native:browser source-change` against the frozen installed tree, with head SHA, command, exit code and `result.json` status. Each run uses an owned Postgres 16 database prepared with `pnpm db:setup`, never a shared developer database.
- Without a macOS arm64 machine the PR is blocked, not exempt. A green `All checks passed` does not replace the evidence.
- Checked by the reviewer agent and by the merging agent before merge, using step 7 of the [CI protocol](agent-operating-rules.md#debugging-ci-failures). No machine check enforces it. Level: review-only.
