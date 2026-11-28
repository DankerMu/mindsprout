# Design: dev-bg-own-server

## Context

`scripts/dev-bg.sh` starts `pnpm dev` (`next dev --port 3000`) in its own process group, records the wrapper pid in `.run/dev.pid`, and polls `http://localhost:3000/api/healthz`.

On a taken port, Next exits instead of moving to another port:

- `--port` is explicit (`next-dev.js:301-302`);
- `EADDRINUSE` calls `process.exit(1)` (`start-server.js:248-256`).

So "our child is alive and the health probe answers" is a sound ownership signal. One race remains: a foreign server could start between our pre-check and our probe.

## Goals / Non-Goals

- Goal: a successful `pnpm dev:bg` means the server on `:3000` was started by this run, with this run's environment, which includes `AI_PROVIDER=mock` (#306).
- Non-goals:
  - changing the port;
  - a healthz nonce, which would change `src/app/api/healthz`, a Critical Path with OpenAPI and smoke, and is too heavy for a local script;
  - `dev-status.sh` reporting a foreign server, which the issue marks optional;
  - multi-worktree discovery.

## Decisions

- **Restart instead of reuse.** A live pidfile is stopped with `dev-stop.sh`, but only when the pid leads its own process group. The script then waits up to 10 s for that process group to disappear. Whether or not the group is gone, it then runs the pre-start probe, so the state machine has one decision point.
  - This beats refusing a live pidfile. The reused server may predate the current environment (the pre-#306 scenario), and only a restart guarantees the environment. Refusing would also make a second `dev:bg` always fail, so callers would chain `dev:stop` in front, which is a restart done outside the script.
  - It costs one server start, about 10 s locally. CI starts fresh.
  - An environment marker in `.run/` was rejected: it would have to stay in sync with every exported variable.
- **One clean exit.** Every non-zero exit after start runs `dev-stop.sh`, so no failed run leaves a pidfile behind. The pgid-leader check means a pidfile left by a crash or reboot, whose pid the OS has since reused, is treated as stale and never signalled.
- **The pre-start probe is the main defence.** Scenario 1 (owner's server) answers on the very first probe, before our child has reached `EADDRINUSE`. Only a check before starting catches it deterministically.
- **Alive-gated readiness covers the remaining race.** A probe success with our child dead means someone else answered. A dead child with no success means we failed to start, so the script exits at once with the log tail.
- **Deterministic stubs.** f4's `curl` stub blocks until our child is dead. Serve stubs live until they are stopped, so no case depends on how long a stub happens to live.
- **Stubs instead of a real Next in guardrails.** Section 9b already stubs `pnpm` and `curl`. A marker file in each case directory stands in for "something is listening". This keeps the fixtures fast, needs no network, and never risks a real provider.

## Risks / Trade-offs

- **Narrow race.** A foreign server that starts after our pre-check and answers while our child is still starting is reported as ours, until our child dies on `EADDRINUSE` before the next probe. Ownership is re-checked on every probe, so the window is one probe interval. This is accepted for a local script and is a declared limit.
- **Killing an unrelated process.** Restart runs the stop path automatically. A reused pid is stopped only if it leads its own process group, and an unrelated process group leader with a reused pid is still possible. Before, a reused pid only printed `already running`. Clean failure exits make a stale pidfile rarer, and `pnpm dev:stop` run by hand is unchanged.

## Not yet specified

None.
