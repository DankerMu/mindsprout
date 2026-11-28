# Tasks

## 1. dev:bg owns the server it reports

- [ ] 1.1 `scripts/dev-bg.sh`:
  - Restart a live `.run/dev.pid` that leads its own process group through `dev-stop.sh`, then wait up to 10 s for that group to disappear. A stale pidfile is removed and never signalled.
  - Exit 1 without starting `pnpm dev` when healthz answers before start. The stderr message names `:3000`.
  - While polling, count a probe success only while our child pid is alive. A dead child exits 1 at once, with `dev server exited before ready` and the tail of `.run/dev.log`.
  - Run `dev-stop.sh` on every non-zero exit after start. Probe with `curl --max-time 2`.
  - Comments name each failure mode (#333).
- [ ] 1.2 `scripts/test-guardrails.sh` section 9b:
  - Mode-selected stubs: a serve `pnpm` that records, creates the marker and sleeps until stopped; a marker-gated `curl`; f4's blocking `curl`. Accept cases stop their server and confirm the group is gone.
  - Keep m1 and m2.
  - Add f1 (foreign; no pidfile, no record), f2 (`spawn_fixture` old server replaced; old group dead, new pid, `mock`), f3 (reason `dev server exited before ready`) and f4 (health answers, child dead).
  - Prove each case bites by removing its check, then restore.
- [ ] 1.3 Verify:
  - `pnpm test:guardrails`;
  - `bash -n` and `shellcheck`;
  - live `pnpm dev:bg`, `pnpm dev:status`, `pnpm smoke`, a second `pnpm dev:bg` that restarts, and `pnpm dev:stop`;
  - a live refusal against a `node -e` healthz stub only;
  - PR CI layer3.

Suggested fixture level: expanded - gate integrity (`scripts/test-guardrails.sh`) and the verification server in front of smoke
Minimal mergeable slice: atomic - the script checks and their guardrail cases must land together, or the fixtures either fail or prove nothing
