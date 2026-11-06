# Enforcement index — detail

Detail relocated from `AGENTS.md ## Enforcement Index`, which keeps one row per rule and links here.

## Branch protection (applied)

- Where it lives: GitHub classic branch protection on `main` (rulesets unused).
- Inspect: `gh api repos/DankerMu/mindsprout/branches/main/protection`.
- Required checks: `All checks passed`, `Lockfile–manifest consistency`, `PR diff size guard`.
- Level: gate (applied: strict up-to-date, three required checks, linear history, no force-push or deletion; `enforce_admins: false` — admins can bypass).

## Agent write-time deny list

- `.claude/settings.json` `permissions.deny` blocks force-push (`git push --force*`, `git push -f*`), `--no-verify`, and `.env` reads (`.env`, `.env.local`, `.env.development`, `.env.test`, `.env.production`).
- Checked in Claude Code sessions only; pre-commit + CI remain the floor.
