#!/usr/bin/env bash
# scripts/dev-bg.sh — start the dev server detached in its own process group and poll the
# health endpoint until ready. `set -m` enables job control so the background job gets a
# fresh pgid that dev-stop.sh can kill as a whole (forked workers included).
# Success means the server on :3000 was started by this run, with this run's environment (#333):
# a server that predates this run, ours or not, would hide the mock forcing below.
set -euo pipefail -m
HEALTH_URL="http://localhost:3000/api/healthz"
TIMEOUT_SECONDS=90
# 10 s for an earlier server's group to exit; one still answering after that is refused as foreign.
STOP_WAIT_TENTHS=100
FOREIGN_MSG="something else is serving :3000 (not started by dev:bg); stop it first"
stop_script="$(dirname "$0")/dev-stop.sh"
# --max-time: a hung listener on :3000 must fail the probe, not stall the script.
probe() { curl -fsS --max-time 2 "$HEALTH_URL" > /dev/null 2>&1; }
mkdir -p .run
# Restart, never reuse (#333): a live earlier server may predate the current environment (the
# pre-#306 scenario). Only a pid that leads its own process group is ours to stop; any other
# pidfile (dead pid, reused pid, garbage) is stale and removed without signalling anything.
if [ -f .run/dev.pid ]; then
  old_pid="$(cat .run/dev.pid)"
  old_pgid="$(ps -o pgid= -p "$old_pid" 2>/dev/null | tr -d ' ')" || old_pgid=""
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && [ "$old_pgid" = "$old_pid" ]; then
    echo "stopping the earlier dev:bg server (pid $old_pid) to restart it"
    bash "$stop_script"
    for _ in $(seq 1 "$STOP_WAIT_TENTHS"); do
      kill -0 -- "-$old_pid" 2>/dev/null || break
      sleep 0.1
    done
  fi
  rm -f .run/dev.pid
fi
# Foreign server (#333): anything answering before we start (a foreground `pnpm dev` with a real
# provider, another worktree, an earlier server that did not stop) would pass every later probe,
# while our `next dev --port 3000` dies on EADDRINUSE.
if probe; then
  echo "$FOREIGN_MSG" >&2
  exit 1
fi
# Verification server: force the mock provider (decision 0039, design D7). Process env wins over
# .env, so pnpm smoke and CI layer3 never call a real provider; foreground `pnpm dev` reads .env.
export AI_PROVIDER=mock
pnpm dev > .run/dev.log 2>&1 &
child=$!
echo "$child" > .run/dev.pid
# Every non-zero exit from here on stops our child, so no failed run leaves a pidfile behind.
trap '[ "$?" -eq 0 ] || bash "$stop_script" > /dev/null 2>&1 || true' EXIT
for _ in $(seq 1 "$TIMEOUT_SECONDS"); do
  if probe; then
    # Ownership at ready (#333): a success while our child is dead came from someone else.
    if ! kill -0 "$child" 2>/dev/null; then
      echo "$FOREIGN_MSG" >&2
      exit 1
    fi
    echo "dev server ready (pid $child) — $HEALTH_URL"
    exit 0
  fi
  # Exited before ready (#333): fail at once with the log instead of waiting out the timeout.
  if ! kill -0 "$child" 2>/dev/null; then
    echo "dev server exited before ready — last log lines:" >&2
    tail -n 20 .run/dev.log >&2 || true
    exit 1
  fi
  sleep 1
done
echo "dev server not ready after ${TIMEOUT_SECONDS}s — last log lines:" >&2
tail -n 20 .run/dev.log >&2 || true
exit 1
