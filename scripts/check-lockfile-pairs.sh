#!/usr/bin/env bash
# scripts/check-lockfile-pairs.sh — lockfile–manifest consistency (block), run by
# .github/workflows/lockfile-guard.yml. Fails when pnpm-lock.yaml changed between <base-ref> and
# HEAD but package.json did not: a lockfile-only change is unreviewed dependency-resolution drift.
# PR_LABELS holds the PR's live labels, one per line; an exact `lockfile-refresh` line passes.
# Fails closed: an unresolvable base or a failing git diff exits non-zero instead of reading as
# "nothing changed". Exit 1 = lockfile-only change or cannot list changes, 2 = usage error.
# Self-proof: scripts/test-guardrails.sh builds fixture PR diffs and expects each verdict.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: check-lockfile-pairs.sh <base-ref>" >&2
  exit 2
fi
base="$1"

if grep -qxF 'lockfile-refresh' <<<"${PR_LABELS:-}"; then
  echo "lockfile-refresh label present: lockfile guard passes"
  exit 0
fi

if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "::error::base ref '$base' does not resolve to a commit in this checkout; cannot list the PR's changed files."
  exit 1
fi

# Captured first so a failing git diff aborts under set -e instead of reading as no changes.
changed=$(git diff --name-only "$base"...HEAD)

if grep -qxF 'pnpm-lock.yaml' <<<"$changed" && ! grep -qxF 'package.json' <<<"$changed"; then
  echo "::error::pnpm-lock.yaml changed but package.json did not. Lockfile-only changes are unreviewed dependency-resolution drift. Revert the lockfile, or add the 'lockfile-refresh' label with a justification."
  exit 1
fi
