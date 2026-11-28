# Proposal: dev-bg-own-server

Issue type: bug
Fixture level: expanded
Upstream suggested level: absent. Expanded: `scripts/test-guardrails.sh` is a Critical Path (gate integrity), and `pnpm dev:bg` sits in front of `pnpm smoke`, the Verification Matrix and CI layer3. Once #305 adds a generation entry to smoke, a wrong server on `:3000` is a billing incident.
Blast radius: a wrong edit could

- keep reporting another process's server as ready;
- kill a process that is not ours;
- break the normal `pnpm dev:bg && pnpm smoke && pnpm dev:stop` path, locally or in CI layer3;
- leave guardrail stubs running.
  Selected risk packs:
- State transitions: pidfile, start, ready, and exit paths.
- Resource limits: every stub and fake server is reaped; no stray process.
- Auth/secrets: verification never reaches a real provider.
  Not selected: Public API (healthz is unchanged), Schema, Config, File IO, Legacy, Release, Docs (no AGENTS edit).
  Evidence floor:
- `pnpm test:guardrails` exits 0. Its output has PASS lines for m1, m2 (updated from #306) and f1–f4, and ends `0 failed`.
- Each case bites. Remove its check, re-run, and the named case FAILs. Then restore the script and confirm with `cmp`.
  - No pre-start check: f1 fails.
  - Reuse instead of restart, which is the old code: f2 fails.
  - No exited-before-ready check: f3 fails on its reason. A plain non-zero exit is not enough, because the timeout path also exits 1.
  - No alive check after a successful probe: f4 fails.
- Live, with `:3000` confirmed free first, run in sequence:
  - `pnpm dev:bg`
  - `pnpm dev:status` reports health OK
  - `pnpm smoke` passes. Smoke has no generation entry yet, and the server forces the mock.
  - A second `pnpm dev:bg` restarts the server: the pid changes and health is OK again.
  - `pnpm dev:stop`, after which the port is free.
- Live foreign server: only a `node -e` HTTP server that answers `/api/healthz`, never a `pnpm dev`, because that reads `.env` and may configure a real provider.
  - Confirm `:3000` is free first, then start the stub in the background and record its pid.
  - `pnpm dev:bg` exits non-zero, never prints `ready` and names `:3000`.
  - Kill the stub and confirm the port is free.
- `bash -n` passes on the changed scripts, and `shellcheck` reports no new finding.
- PR CI passes, including "Integration tests + API smoke" (layer3).

Review round 1, deferred P2s, filed as a follow-up:

- No guardrail case yet covers the spec scenario "Earlier server does not stop". In that scenario the old group ignores TERM and still answers, and the expected result is a refusal that names `:3000`. Until the follow-up lands, this path is covered only by code structure: the pre-start probe is unconditional.
- No guardrail case covers the pid-leader guard, which leaves a live pidfile pid that does not lead its own group unsignalled.
- The `dev-bg.sh` comment "removed without signalling anything" overstates the guarantee. A reused pid that leads its own group is still stopped.

## Why

Issue #333. `scripts/dev-bg.sh` declares the server ready as soon as anything on `:3000` answers `/api/healthz`. It also reuses any live `.run/dev.pid` as is.

Two scenarios defeat #306's `export AI_PROVIDER=mock`:

- The owner runs a foreground real-provider `pnpm dev`. The new `next dev --port 3000` then exits with `EADDRINUSE` or on the dev lock, but curl reaches the owner's server and dev-bg reports ready.
- A dev:bg server started before #306 is still alive, and dev-bg reuses it.

Today smoke has no generation entry. #305 adds one, after which a local `pnpm smoke` could bill a real provider (AGENTS Important Note 5). The owner decided to fix this before #305.

## What Changes

`scripts/dev-bg.sh` has one exit for each state:

- **Restart, never reuse.**
  - A `.run/dev.pid` whose pid is alive and leads its own process group is stopped through `dev-stop.sh` (`ps -o pgid= -p $pid` must equal `$pid`). Our child always leads its group under `set -m`.
  - The script then waits up to 10 s for that process group to disappear, with `kill -0 -- -$pid` failing.
  - A pidfile that fails the group check, or whose pid is dead, is stale. It is removed and never signalled.
  - Every path then reaches the pre-start probe. Every successful `dev:bg` therefore returns a server started by this run, with this run's environment.
- **Refuse a foreign server.**
  - If `/api/healthz` answers before our server starts, the script exits 1 and never starts `pnpm dev`. The probe uses `curl --max-time 2`.
  - The stderr message reads `something else is serving :3000 (not started by dev:bg); stop it first`. This includes an earlier server that did not stop within 10 s.
- **Ownership at ready.** Each poll probes first. A success counts only if our child pid is still alive afterwards. Otherwise the script exits 1 with the same `:3000` message.
- **Exited before ready.** A failed probe with our child dead exits 1 at once with `dev server exited before ready` and the tail of `.run/dev.log`, without waiting out the 90 s timeout.
- **Every non-zero exit after start runs `dev-stop.sh`, so no failed run leaves a pidfile.** This covers exited-before-ready, foreign-at-ready and timeout.

`scripts/test-guardrails.sh` section 9b:

- **Stubs.** `$tmp/bin` holds the stubs. Each case directory holds a mode file that selects the stub behaviour.
  - A **serve** `pnpm` stub records `${AI_PROVIDER-<unset>}`, creates the `healthz` marker, then `exec sleep 60` until it is stopped. The `curl` stub answers only while the marker exists.
  - Every accepting case (m1, m2, f2) ends by running `bash "$repo_root/scripts/dev-stop.sh"` in its directory. It then confirms within 5 s that the stub's process group is gone. `dev_bg_sees_mock` stops before it asserts, and no longer waits for the child to exit by itself.
- **m1 and m2** keep their meaning: an inherited `anthropic`, and an unset value with a `.env`.
- **f1, foreign.** The marker exists before the run, and there is no pidfile.
  - `expect_reject --absent ready`, with the `:3000` reason.
  - Neither `provider-seen` nor `.run/dev.pid` exists afterwards, which proves `pnpm dev` never started.
  - If a mutant starts a stub, it is stopped.
- **f2, earlier server.**
  - `spawn_fixture f2-old sleep 60` gives it its own process group and lets `reap_fixtures` back it up. That pid goes into `$dir/.run/dev.pid`. There is no marker at start.
  - The run must:
    - exit 0;
    - leave the old process group dead;
    - write a new `.run/dev.pid` that differs from the old pid;
    - record `mock` in `provider-seen`.
- **f3, exits before ready.** The `pnpm` stub prints a log line and exits 1 without creating the marker. `expect_reject`, with reason `dev server exited before ready` and that log line.
- **f4, health answers while our child is dead.**
  - The `curl` stub blocks deterministically. While `.run/dev.pid` is absent, which is the pre-start probe, it exits 7. Otherwise it waits up to 5 s for that pid to die and then exits 0.
  - The `pnpm` stub only records the provider and exits 0.
  - `expect_reject --absent ready`, with the `:3000` reason.
  - Bash reaps the background child while it waits on curl in the foreground, so the probe succeeds only after the child is dead. This also catches an implementation that checks liveness only before the probe.

`scripts/dev-status.sh` and `dev-stop.sh` are unchanged.

## Impact

Local verification scripts and the guardrail self-test only. There is no product code change and no decision record, because this is a mechanical hardening of a local script behind decision 0039. There is no changeset, because nothing is user-visible.

The visible behavior change: a second `pnpm dev:bg` restarts the server instead of reporting `already running`. The AGENTS Runtime Lifecycle line is unaffected ("Start (background)"). Closes #333; unblocks #305.
