---
name: pre-push-checks
description: Use before pushing, marking ready for review, or claiming checks pass on a MindSprout branch — selects the smallest checks that cover the outgoing diff instead of reflexively running the full suite.
---

# Pre-Push Checks

Guidance, not a script. Hooks are intentionally narrow (naming guard, secret guard, TDD pairing, lint-staged, commitlint); CI owns exhaustive coverage. There is no universal local baseline: every change runs the narrowest evidence that would fail for its regression, once.

## Inspect the outgoing change

1. `git status --short --branch` — confirm checkout and branch.
2. `pnpm change-scope <verified-base-ref>` — explicit base, never guessed; re-run after any retarget or base merge.

## Select evidence by surface

| Change touches | Run |
|---|---|
| One context's domain/application code | `pnpm vitest related --run <changed files>` then `pnpm boundaries` |
| A route handler or provider adapter | the owning unit tests + `pnpm test:integration` + `pnpm dev:bg && pnpm smoke && pnpm dev:stop` |
| UI under `src/app` or `src/components` | `pnpm verify-ui "<route title>"` (screenshot lands in `.run/ui-evidence/`) |
| `schemas/openapi.yaml` | `pnpm test:contract` (update the snapshot in the same change, hunk by hunk) |
| Docs / `decisions/` | `pnpm docs:check`, `pnpm decisions:check` |
| Build/packaging/config | `pnpm build`, then `pnpm check` only if the change is genuinely repo-wide |

Do not repeat a check that already passed for this change. Full `pnpm check` only on explicit request, while diagnosing CI, or for an irreducibly repo-wide change.

## Failures and reporting

A relevant failure stops the push — never push and hope CI differs. Suspected environment-specific failures need proof: exact command, failing case, platform mismatch, plus passing non-platform evidence. Report only commands actually run; report pending CI as pending. A green `pnpm smoke` proves the health route answers, not that a feature works — say what the evidence does not prove.
