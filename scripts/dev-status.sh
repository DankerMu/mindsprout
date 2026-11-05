#!/usr/bin/env bash
# scripts/dev-status.sh — pid + health probe. Exit 1 when the health check fails so the
# Verification Matrix liveness row has a real pass/fail signal.
HEALTH_URL="http://localhost:3000/api/healthz"
if [ -f .run/dev.pid ] && kill -0 "$(cat .run/dev.pid)" 2>/dev/null; then
  echo "pid:    $(cat .run/dev.pid) (running)"
else
  echo "pid:    not running"
fi
if body="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
  echo "health: OK ($HEALTH_URL) $body"
  exit 0
fi
echo "health: UNREACHABLE ($HEALTH_URL)"
exit 1
