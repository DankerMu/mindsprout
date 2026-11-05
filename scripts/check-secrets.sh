#!/usr/bin/env bash
# scripts/check-secrets.sh — pre-commit secret guard (block). Scans ADDED lines of the staged
# diff for credential shapes. CI runs gitleaks as the stronger second layer; this guard exists
# so a key never reaches a commit in the first place. Exit 1 = violation, 2 = usage error.
# Self-proof: scripts/test-guardrails.sh stages a fake key and expects rejection.
set -u

mode="${1:-staged}"
case "$mode" in
  staged) diff_cmd=(git diff --cached --unified=0 --no-color) ;;
  file)
    [ -n "${2:-}" ] || { echo "check-secrets.sh: usage: check-secrets.sh file <path>" >&2; exit 2; }
    diff_cmd=(sed 's/^/+/' "$2") ;;
  *) echo "check-secrets.sh: unknown mode '$mode' (staged|file)" >&2; exit 2 ;;
esac

patterns='sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|eyJhbGciOi[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}'

hits="$("${diff_cmd[@]}" 2>/dev/null | grep -E '^\+' | grep -Ev '^\+\+\+' | grep -En "$patterns" || true)"

if [ -n "$hits" ]; then
  echo "check-secrets.sh: possible secret in staged changes:" >&2
  printf '%s\n' "$hits" | sed -E 's/^/  /; s/(sk-ant-|sk-|AKIA|ghp_|eyJhbGciOi)[A-Za-z0-9_.-]{6}[A-Za-z0-9_.-]*/\1******/g' >&2
  echo "  expected no credential-shaped tokens; move the value to .env (gitignored) and reference it by name" >&2
  echo "  see AGENTS.md § Secrets handling" >&2
  exit 1
fi

echo "check-secrets.sh: staged additions checked, no secret shapes found." >&2
exit 0
