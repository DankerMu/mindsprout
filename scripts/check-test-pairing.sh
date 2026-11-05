#!/usr/bin/env bash
# scripts/check-test-pairing.sh — TDD required (L4): every staged NEW production source file
# under src/ needs a paired *.test.ts(x) sibling in the same commit. Exemptions mirror
# constraints.yaml `exemptions` (Next.js route components are verified by the e2e tier).
# Exit 1 = violation, 2 = usage error. Self-proof: scripts/test-guardrails.sh.
set -u

if [ "${1:-}" = "--file" ]; then
  [ -n "${2:-}" ] || { echo "check-test-pairing.sh: usage: --file <path>" >&2; exit 2; }
  files="$2"
else
  files="$(git diff --cached --name-only --diff-filter=A -- 'src/*.ts' 'src/*.tsx' 2>/dev/null || true)"
fi

exempt_re='(\.test\.tsx?$|\.d\.ts$|/(page|layout|loading|error|not-found|template|global-error)\.tsx$|\.gitkeep$)'
missing=""
checked=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if printf '%s' "$f" | grep -Eq "$exempt_re"; then continue; fi
  checked=$((checked + 1))
  base="${f%.*}"
  ext="${f##*.}"
  if [ ! -e "$base.test.$ext" ] && ! git ls-files --cached --error-unmatch "$base.test.$ext" >/dev/null 2>&1; then
    missing="$missing  $f -> expected $base.test.$ext\n"
  fi
done <<EOF2
$files
EOF2

if [ -n "$missing" ]; then
  echo "check-test-pairing.sh: missing paired test for new production file(s):" >&2
  printf "$missing" >&2
  echo "  TDD is required here (AGENTS.md § Architecture Discipline → Test-Driven Development): write the failing test first, commit both together" >&2
  exit 1
fi

echo "check-test-pairing.sh: $checked new source file(s) checked, all paired." >&2
exit 0
