#!/usr/bin/env bash
# scripts/dev-stop.sh — stop the dev server and its forked workers via process group.
set -euo pipefail
if [ -f .run/dev.pid ]; then
  pid="$(cat .run/dev.pid)"
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" || pgid=""
  if [ -n "$pgid" ] && [ "$pgid" != "0" ]; then
    kill -- "-$pgid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  else
    kill "$pid" 2>/dev/null || true
  fi
  rm -f .run/dev.pid
  echo "dev server stopped"
else
  echo "no pidfile — dev server not running (or started outside dev:bg)"
fi
