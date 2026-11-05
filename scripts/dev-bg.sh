#!/usr/bin/env bash
# scripts/dev-bg.sh — start the dev server detached in its own process group and poll the
# health endpoint until ready. `set -m` enables job control so the background job gets a
# fresh pgid that dev-stop.sh can kill as a whole (forked workers included).
set -euo pipefail -m
HEALTH_URL="http://localhost:3000/api/healthz"
TIMEOUT_SECONDS=90
mkdir -p .run
if [ -f .run/dev.pid ] && kill -0 "$(cat .run/dev.pid)" 2>/dev/null; then
  echo "dev server already running (pid $(cat .run/dev.pid))"
  exit 0
fi
pnpm dev > .run/dev.log 2>&1 &
echo $! > .run/dev.pid
for _ in $(seq 1 "$TIMEOUT_SECONDS"); do
  if curl -fsS "$HEALTH_URL" > /dev/null 2>&1; then
    echo "dev server ready (pid $(cat .run/dev.pid)) — $HEALTH_URL"
    exit 0
  fi
  sleep 1
done
echo "dev server not ready after ${TIMEOUT_SECONDS}s — last log lines:" >&2
tail -n 20 .run/dev.log >&2 || true
bash "$(dirname "$0")/dev-stop.sh" >/dev/null 2>&1 || true
exit 1
