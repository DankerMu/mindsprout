#!/usr/bin/env bash
# scripts/check-fast.sh — changed-scope checks for the iterate loop. Full `pnpm check` before PR.
# Full `tsc --noEmit` stays in `pnpm check` — it cannot be file-scoped soundly.
set -euo pipefail
changed=$(git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' || true)
if [ -z "$changed" ]; then
  echo "check-fast: no changed source files"
  exit 0
fi
# shellcheck disable=SC2086
pnpm eslint --max-warnings 0 $changed
# shellcheck disable=SC2086
pnpm prettier --check $changed
ts_changed=$(printf '%s\n' "$changed" | grep -E '\.(ts|tsx)$' || true)
if [ -n "$ts_changed" ]; then
  # shellcheck disable=SC2086
  pnpm vitest related --run $ts_changed
fi
