#!/usr/bin/env bash
# .claude/hooks/pre-write-naming.sh — write-time naming guard for Claude Code.
# Catches _v2 files at write time, before commit time. Delegates the actual
# check to .git-hooks/check-naming.sh so there is exactly one regex source.
set -u
payload="$(cat)"
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"
else
  # Dependency-free fallback: first "file_path":"..." value in the payload.
  file_path="$(printf '%s' "$payload" \
    | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi
[ -z "$file_path" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
exec bash "$root/.git-hooks/check-naming.sh" "$file_path"
