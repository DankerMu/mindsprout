---
name: prose-contract
description: Use when writing, reviewing, trimming, or auditing prose in MindSprout — comments, doc pages, commit/PR text, error messages, AGENTS.md — to keep contracts and delete transcripts.
---

# Prose Contract

Guidance, not a template library. Scope is required input — without a named file set, stop and ask.

## Keep vs. delete

Keep what code cannot express and affects correct use: behavior, timing/modality, failure conditions and resulting state, consequences, ownership, safe-use constraints, non-obvious placement rationale (one line + link to the owning decision record). Delete reasoning transcripts: implementation narration, proofs of obvious branches, test walkthroughs, review history, rejected local alternatives (those belong in `decisions/`), code restatement.

## Current state only

No "previously/now/no longer", no PR numbers or commit hashes in durable prose — name the live mechanism; change stories live in commits, PRs, and decision records. Rationale lives once at the owning seam, not copied beside each sibling.

## AGENTS.md budget

`AGENTS.md` stays under 320 lines (`check_rendered_harness.py --max-agents-lines`). When over budget: relocate (to `docs/engineering/`, `CONTEXT.md`, `constraints.yaml`), then condense, then — only with a stated reason — raise. Never reorder sections and never drop a rule to fit.

## Slop audit checklist

Same rule in >1 home · narrated history · implementation-status annotations · hand-copied inventories where a generator is authoritative · reasoning transcripts · paragraph walls · emphasis inflation · empty "TBD" sections. Borderline trims (both versions preserve the full proposition): present 2–3 candidates with a recommendation; do not decide silently.
