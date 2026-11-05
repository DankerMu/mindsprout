# CONTEXT.md Template

Use this template when Stage 3/4 creates or repairs `CONTEXT.md`. Keep it concise: this file anchors project identity, bounded contexts, and invariants. Domain-term **definitions** do not live here — they live in `openspec/glossary.md` (the repo-wide glossary home shared with `grill-me` docs mode, `architecture-design`, `improve-codebase-architecture`, and `review`; format in `grill-me`'s `references/GLOSSARY-FORMAT.md`). `CONTEXT.md` links to it.

## File header

```markdown
# CONTEXT.md

> Project identity, bounded contexts, and business invariants for this repository.
> `AGENTS.md` is the operating contract; `openspec/glossary.md` defines the domain vocabulary; this file defines the domain boundaries and invariants that agents must respect when applying both.
```

## Project identity

```markdown
## Project Identity

{{ONE_PARAGRAPH_DESCRIPTION_VERBATIM_FROM_USER}}

- **Primary users / consumers**: {{CONSUMERS}}
- **Business goal**: {{BUSINESS_GOAL}}
- **Lifecycle**: {{LIFECYCLE}}
```

## Domain language (link only)

```markdown
## Domain Language

Canonical terms and their prohibited aliases live in `openspec/glossary.md`. Read it before naming a domain concept; never define a term here.
```

Rules:

- The confirmed terms from Q1.6 render into `openspec/glossary.md` (`## Language`; one `## Context Map` plus per-context sections when the repo has several bounded contexts — one file, never one per context). Capture the user's wording verbatim when they define a term; list the other names under `_Avoid_:`.
- Create `openspec/glossary.md` only when at least one term is confirmed. With no terms yet, this section says so ("no domain glossary needed yet") and the file is not created.
- If two names appear to mean the same thing, list them under "Open terminology questions" below instead of choosing silently.
- Prefer domain terms over technical synonyms in business logic.

## Bounded contexts

Use this section for DDD systems, monorepos with multiple domains, or any repo where the same term can mean different things in different areas.

```markdown
## Bounded Contexts

| Context | Owns | Key terms (defined in `openspec/glossary.md`) | Forbidden logic | Integration boundary |
|---------|------|-----------|-----------------|----------------------|
| {{CTX_1}} | {{RESPONSIBILITY_1}} | {{TERMS_1}} | {{FORBIDDEN_1}} | {{BOUNDARY_1}} |
| {{CTX_2}} | {{RESPONSIBILITY_2}} | {{TERMS_2}} | {{FORBIDDEN_2}} | {{BOUNDARY_2}} |
```

## Core invariants

```markdown
## Core Invariants

- {{INVARIANT_1}}
- {{INVARIANT_2}}
- {{INVARIANT_3}}
```

Good invariants are testable or reviewable. Examples:

- Paid orders are never physically deleted.
- Permission changes must be auditable.
- Refunds must preserve the original payment record.

## Public interfaces and contracts

```markdown
## Public Interfaces and Contracts

| Interface | Contract source | Backward compatibility rule | Test seam |
|-----------|-----------------|-----------------------------|-----------|
| {{INTERFACE_1}} | {{SCHEMA_OR_DOC_1}} | {{COMPAT_RULE_1}} | {{TEST_1}} |
```

## Forbidden logic and irreversible operations

```markdown
## Forbidden Logic & Irreversible Operations

Captured verbatim from grilling (Q6.6 out-of-bounds operations and architecture answers); agents must check this section before writing code that deletes data, mutates schemas, or crosses a listed boundary.

| Rule | Scope | Why |
|------|-------|-----|
| {{FORBIDDEN_RULE_1}} | {{SCOPE_1}} | {{REASON_1}} |
| {{FORBIDDEN_RULE_2}} | {{SCOPE_2}} | {{REASON_2}} |
```

## Open terminology questions

```markdown
## Open Terminology Questions

| Question | Why it matters | Candidate terms | Owner |
|----------|----------------|-----------------|-------|
| {{QUESTION_1}} | {{IMPACT_1}} | {{CANDIDATES_1}} | {{OWNER_1}} |
```

## Rendering rules

- Do not invent domain facts. If unsure, write an open question.
- Keep term definitions out of `CONTEXT.md`; they belong in `openspec/glossary.md`. Keep implementation rules out of `CONTEXT.md`; they belong in `AGENTS.md`.
- Keep setup commands out of `CONTEXT.md`; they belong in `AGENTS.md` and the command entry point.
- Link from `AGENTS.md` to this file anywhere terminology, bounded contexts, or invariants affect implementation.
