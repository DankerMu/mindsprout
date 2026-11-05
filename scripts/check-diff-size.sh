#!/usr/bin/env bash
# scripts/check-diff-size.sh — PR diff size guard (block), run by .github/workflows/pr-diff-guard.yml.
# Counts changed lines between <base-ref> and HEAD (lockfiles, snapshots, changesets and decision
# records excluded) against constraints.yaml size_limits.max_pr_diff_lines. PR_LABELS holds the
# PR's live labels, one per line; an exact `diff-limit-exempt` line passes the guard.
# Fails closed: an unresolvable base, an unreadable limit or a failing git diff exits non-zero
# instead of counting 0. Exit 1 = over the limit or cannot count, 2 = usage error.
# Self-proof: scripts/test-guardrails.sh builds fixture PR diffs and expects each verdict.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: check-diff-size.sh <base-ref>" >&2
  exit 2
fi
base="$1"

if grep -qxF 'diff-limit-exempt' <<<"${PR_LABELS:-}"; then
  echo "diff-limit-exempt label present: PR diff size guard passes"
  exit 0
fi

MAX_DIFF_LINES=$(python3 - <<'PY'
import pathlib
import re

text = pathlib.Path("constraints.yaml").read_text()
match = re.search(r"(?ms)^  max_pr_diff_lines:\n    value: (\d+)\n", text)
if not match:
    raise SystemExit("Could not read size_limits.max_pr_diff_lines from constraints.yaml")
print(match.group(1))
PY
)

if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "::error::base ref '$base' does not resolve to a commit in this checkout; cannot count the PR diff."
  exit 1
fi

# Captured first so a failing git diff aborts under set -e instead of counting as 0 lines.
DIFF=$(git diff --diff-filter=ACMR --ignore-all-space "$base"...HEAD -- . \
  ':(exclude)*.lock' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/__snapshots__/**' \
  ':(exclude)**/*.snapshot' ':(exclude).changeset/**' ':(exclude)decisions/**')
# grep -c exits 1 when nothing matches (count 0); that is the only failure tolerated.
LINES=$(grep -c '^[+-][^+-]' <<<"$DIFF") || [ "$?" -eq 1 ]

echo "Changed lines (excluding lockfiles/snapshots/records): $LINES (limit: $MAX_DIFF_LINES)"
if [ "$LINES" -gt "$MAX_DIFF_LINES" ]; then
  echo "::error::PR exceeds the ${MAX_DIFF_LINES}-line diff limit. Split it, or add the 'diff-limit-exempt' label with a justification in the PR description."
  exit 1
fi
