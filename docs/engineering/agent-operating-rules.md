# Agent operating rules — full protocols

Relocated from `AGENTS.md ## Agent Operating Rules`, which keeps the hard rules and links here. These protocols are binding; `AGENTS.md` is the hot path, this file the procedure.

## Debugging CI failures

1. Classify the failing layer: `layer1-fast-checks` (fmt/lint/typecheck/boundaries), `layer2-unit-tests` (coverage, contract), `layer3-integration-tests` (DB, smoke), `layer4-anti-drift` (duplicate/dead/docs/decisions), `layer5-secret-scan`, `layer6-diff-size-guard`, `layer7-e2e`, `layer8-sast`, `lockfile-consistency`.
2. Read the logs first; extract the _first_ actionable error and the exact command CI ran.
3. Reproduce locally with the same `pnpm` script from `AGENTS.md ## Development Workflow` — never "something close".
4. Fix the root cause, not the symptom (correct a flaky test; do not raise timeouts).
5. Re-run that layer locally, then the scoped checks (`.claude/skills/pre-push-checks/SKILL.md`), before pushing.
6. If the failure is environment parity (OS/version/service), record the mismatch in `AGENTS.md ## Important Development Notes`.

Hurl download-transport failures use the incident-scoped authorization, same-head recovery and evidence rules in [decision 0019](../../decisions/implemented/process/0019-incident-scoped-hurl-recovery.md). Recovery never substitutes local results for required CI or retries an application-test failure under a transport authorization.

## Environment tiers

| Tier    | Agents may                                                       |
| ------- | ---------------------------------------------------------------- |
| Local   | Everything within the rules                                      |
| Staging | Deploy only via CI; read logs                                    |
| Prod    | Nothing — no access (`constraints.yaml environments.prod: none`) |

## Concurrency model

- Parallel agents use separate git worktrees (`git-worktree-workflows` skill; the `worktree-guard` hook denies writes outside a declared worktree root when `.worktree-guard.json` is present). Never share a working tree.
- Feature branches `agent/<issue>-<slug>`; one task = one branch. Rebase onto `main` before opening or updating a PR — no merge commits from `main` into the feature branch.
- Lockfile conflicts: re-run `pnpm install` from the merged `package.json` and commit the result ([regenerate the lockfile](dependency-patches.md#regenerate-the-lockfile)); never hand-merge `pnpm-lock.yaml`.

## Generated artifacts

- A lockfile change accompanies a manifest change (CI `lockfile-consistency`; the `lockfile-refresh` label is the documented exception and needs a justification in the PR).
- Snapshot updates (`schemas/snapshots/`, Playwright traces, Stryker reports) are reviewed hunk by hunk; CI only compares, never writes.
- Generated code is changed only via its generator.

## Incident-to-constraint ratchet

- Any non-obvious lesson costing more than 30 minutes becomes a dated entry in `AGENTS.md ## Important Development Notes` immediately (cap 10, pruned at milestones).
- An escaped defect that is subtle, systemic and costly to rediscover gets a postmortem (`../postmortem/README.md`); every lesson lands as prose + policy + a named mechanical guard, or says `not applicable` with a reason.
- The third same-class incident becomes a lint rule or hook — write the check, not more prose.

## Secrets handling

- Never read, cat, or print `.env*` files; `.env.example` is the only secrets-adjacent file agents open. Claude Code denies `.env`, `.env.local`, `.env.development`, `.env.test`, `.env.production` by name (`.claude/settings.json`) so the example stays readable.
- Need a variable's existence confirmed? Check key names in `.env.example`, never values. Never paste secret values into PRs, commits, logs, or chat; reference secrets by variable name only.
