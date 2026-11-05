# Review Briefs

Seat plan and briefs for Phase 3. Lens ids, per-lens checklists, cross-cutting lenses, and the finding contract are canonical in `risk-adaptive-cross-review` (`reviewer-packages.md`, `finding-contract.md`); this file only binds them to the OpenSpec fixture and the subagent scaffolding.

## Seat Plan

A seat is one parallel `reviewer` subagent carrying one lens or two paired lenses (`a+b`, both checklists inlined). Spawn all seats of a round in one batch.

| Fixture level | Round 1 seats |
| --- | --- |
| `none` | skip; one `correctness+test-evidence` seat only if the Phase 2 audit found risk |
| `compact` | `correctness+test-evidence`; add `integration` or `security-perf` only when a selected risk pack names that surface |
| `expanded` | `correctness`; `test-evidence+spec-compliance`; plus one of `integration`, `security-perf`, `invariant-state` per the selected risk packs (cap 3) |
| re-review after a fix pass | one `correctness+test-evidence` seat, full diff, fix-delta focus |

Report files: `<REVIEW_DIR>/<leading lens>.md`. Verdict tables: `<REVIEW_DIR>/verify-<class>.md`.

## Fixture Review Brief

One read-only `reviewer`, Phase 0, before implementation. It checks only whether the fixture is sufficient, not the design.

```text
# Fixture Review: issue #<N>

Subagent boundary: <from SKILL.md>
Rules: read-only; no edits, commits, or test runs. Return the verdict as your final message.

Inputs: issue body and comments; openspec/changes/<change>/ (proposal.md, tasks.md, spec deltas, design.md at expanded); nearby tests and docs.

Check:
- Fixture level is not under-classified against the expanded triggers in issue-risk-contract.md.
- Every risk pack that plausibly applies is marked selected/not selected with a defensible reason.
- Every selected pack maps to a test, a verification command, or an explicit non-goal in tasks.md.
- Must-preserve behavior and downstream consumers are concrete, not generic.
- Required evidence has explicit input and expected output.
- At expanded: governing invariant and sibling surfaces are named.

Output:
Fixture review: pass|revise
Required additions:
- <only on revise; one line each, or "None.">
```

## Reviewer Brief

```text
# Code Review: <seat lenses>

Review PR #<N> on branch <branch>, head <FULL_SHA>, <round 1 | re-review after fixes>.
Return the complete report as your final message; the orchestrator persists it.

Subagent boundary: <from SKILL.md>
Rules:
- Read-only: no edits, commits, or state changes. Do not run test suites, single tests, or CI-equivalent commands; Phase 2 already ran them and the results are in your inputs. When the evidence cannot settle a finding, name the exact command or test that would.
- Output only the structured report below.

Inputs:
- Changed files: <path list>
- Phase 2 verification: <commands and results>
- Fixture: <level, selected risk packs, OpenSpec change path>
- PR 偏离记录: <deviations; review attention goes there first>
- Fix summary (re-review only): <what changed and which findings it claims to close>

Checklist:
- <inline the checklist of each lens this seat carries from reviewer-packages.md, plus any diff-triggered cross-cutting lens>
- At expanded: check every sibling surface named in design.md, not only touched lines.
- Re-review: confirm each prior finding is closed or still failing, with evidence, then look for regressions the fix introduced.

Output:
Reviewer: <seat lenses> | Round: <round> | Head: <FULL_SHA>
Summary: <one line>
Findings:
- <one per finding, every finding-contract.md field, including Lens: <single lens id>>
- ...or "None."
Non-blocking notes:
- <items without a concrete scenario or test, or "None.">
```

## Verifier Brief

Spawn only for P0/P1 candidates the orchestrator could not settle from the code, one `verifier` per failure class, at most five candidates per batch. A verifier never adjudicates a batch that contains its own reviewer output; that cannot happen here because verifiers are separate subagents.

```text
# Finding Verification: <class>

Adjudicate the candidate findings below for PR #<N>, head <FULL_SHA>.
Return the verdict table as your final message.

Subagent boundary: <from SKILL.md>
Rules:
- Read-only; no test runs. Adjudicate from the diff, code, tests, fixture, and the Phase 2 evidence. When that cannot settle a candidate, name the exact command or test that would.
- One verdict per candidate; a batch-level verdict is invalid. Do not search for new findings.

Inputs:
- Candidates: <full candidate texts, each with an id>
- Changed files: <path list>
- Phase 2 verification: <commands and results>
- Fixture: <level, selected risk packs, OpenSpec change path>

Verdicts:
- CONFIRMED: the failing scenario is constructible from the diff, fixture, or contracts; cite the evidence.
- PLAUSIBLE: reachable in a realistic runtime state but not fully constructible; explain reachability.
- REFUTED: factually wrong (quote the line), provably impossible (cite the type or invariant), or already handled (cite the guard).
- For CONFIRMED/PLAUSIBLE add a disposition FIX_NOW | DEFER | DISCARD with the decisive reason; a CONFIRMED P0 is never DISCARD; when inconclusive, prefer FIX_NOW or DEFER.

Output:
Verdicts for <class> | Head: <FULL_SHA>
- <id>: CONFIRMED|PLAUSIBLE|REFUTED | Disposition: <...> | Evidence: <...> | Note: <one line or "None.">
```
