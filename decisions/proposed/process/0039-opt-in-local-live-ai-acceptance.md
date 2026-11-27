---
id: 0039
title: Opt-in local live AI acceptance is the only real-key exception
kind: process
status: proposed
date: 2026-11-26
---

# Opt-in local live AI acceptance is the only real-key exception

## Problem

M3's acceptance has two latency limits that only a real model can show: the first node within 6 s (PRD §6, relaxed from 3 s by the owner on 2026-11-26 after provider probes) and a three-layer map within 10 s (PRD §8). AGENTS.md ("What agents may not do"), CONTEXT.md (Forbidden Logic) and decision 0002 (Consequences) forbid calling a real paid key from tests, CI or local verification. With that rule, no agent-run check can prove the acceptance. In the M3 Stage 1 grill (2026-11-26), the owner chose to verify with their own dmxapi.cn key and `deepseek-v4.1-flash-1017`, including from local e2e.

## Decision

- Exactly one surface may call a real provider: the Playwright spec `e2e/ai-live.spec.ts`, run by `pnpm e2e:live`. The default run does not collect it (`testIgnore` unless `E2E_AI_LIVE=1`), so the CI zero-skip gate is untouched.
- In live mode the e2e server takes the AI configuration from the local `.env`. In every other run it forces `AI_PROVIDER=mock`.
- When both `E2E_AI_LIVE=1` and `CI=true` are set, the e2e server refuses to start and exits non-zero. CI therefore never runs live.
- Vitest (unit, integration, contract), `pnpm smoke` and the default `pnpm e2e` never call a real provider: the verification servers (`scripts/dev-bg.sh`, `scripts/e2e-server.mjs`) export `AI_PROVIDER=mock`, and unit tests inject wire fixtures.
- Agents may run the live spec only for M3-class acceptance evidence, one generation per run, and never in a retry loop. Each live run's timings go in the PR or Epic.

## Alternatives considered

- **Keep the rule absolute; the owner verifies by hand**: this is offered and declined. The latency claims would have no repeatable command, and the evidence rule wants fresh command output.
- **A standalone live script outside Playwright**: this measures only the server path, not "first node visible" in the editor, which is what the acceptance states.
- **Local e2e uses the real key by default**: every routine local e2e would bill, and results would depend on network conditions. It is rejected in favour of the explicit switch.
- **Allow live runs in CI with a secret**: this adds a CI secret and a billing path on every PR. It conflicts with "Tests and CI never call a real paid AI key".

## Consequences

- When this record moves to `implemented` (M3 task 7.2), the following change in the same PR:
  - AGENTS.md Important Development Note 5, its Critical Paths `providers/` row and its "What agents may not do" bullet, and the CONTEXT.md forbidden-logic row, cite this exception.
  - Decision 0002's Consequences line is cross-linked as partially superseded on this point only.
- The CI guard is a script check in `scripts/e2e-server.mjs`, proven on every pull request by a fixture in `scripts/test-guardrails.sh`. Without that check, this exception would be only a written rule.
- Live results are evidence for latency only. Correctness stays proven by the mock and fixture tests.
- A rehearsal `AI_PROVIDER=mock E2E_AI_LIVE=1 pnpm e2e:live` uses no real key (process environment wins over `.env`) and is not a real-key run.
