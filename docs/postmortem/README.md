# Postmortems

An incident write-up for a bug that reached where it should not have — a real
user, a merged PR, a release. The point is not the one-line fix; it is _why our
process let it through_. This is the only doc tier where war-story narrative
belongs; chronology records evidence, not a teaching sequence. A postmortem is
not a decision record: records capture deliberate choices and beaten
alternatives, postmortems capture failures in hindsight.

## When to write one

Write a postmortem when all three hold:

1. **Subtle** — the mechanism is non-obvious; a careful engineer would
   re-derive it the hard way.
2. **Systemic** — it escaped because of a gap in tests, tooling, or
   conventions, not a one-off typo.
3. **Costly to rediscover** — real debugging time was spent and would be
   spent again.

Every lesson lands in up to three layers, each present or explicitly `not applicable` with a reason: a prose rule (AGENTS.md), a policy (Verification Matrix implication), and a mechanical guard (a named test, gate, or config that fails on recurrence). A lesson landed only in prose is not landed.

Link every guardrail the postmortem produced (tests, rules, gates). Files are
`NNNN-short-slug.md`, numbered sequentially; register each in the table below.
A `docs/danger-patterns.md` is created only once two or more postmortems converge on one defect class.

| #   | Title |
| --- | ----- |

## Skeleton

```markdown
# Post-mortem NNNN: <one-line incident title>

Status: resolved (<fix reference>)

## Executive summary

## Impact

## Timeline

## Root cause

## Guardrails added

## Lessons
```
