# Decision records

One file per non-trivial decision, classified by what it decides. The folder is the lifecycle:

```
decisions/
├── proposed/{kind}/      # drafts awaiting a decision
├── implemented/{kind}/   # accepted decisions, cited by later work
├── rejected/{kind}/      # explicitly declined — kept while they prevent a tempting fallacy
└── archived/{kind}/      # frozen — never edited (hashes in archived/MANIFEST.json)
```

Kinds: `architecture`, `process`, `testing`, `bug-fix`, `feature`, `simplification`.

Rules:

- **Note-required**: a non-trivial change ships its record in the same PR. Only mechanical or local edits are exempt; the PR template asks which.
- **`## Alternatives considered` is mandatory** — alternatives are recorded, never invented after the fact.
- **Supersession at write time**: search active records first; fold a fully superseded record into the new one, cross-link a partially superseded one. A record is never edited into a different decision.
- **Archive freeze**: archived records are frozen. Editing one re-classifies the edit as a new proposed note; the frozen original stays. `archived/MANIFEST.json` holds `path → sha256` and `pnpm decisions:check` fails on any drift.
- **GC by future decision value**, never by age or count. Keep anything whose alternatives, negative guarantees, ownership boundaries, or reintroduction conditions can still steer work.
- Procedure for adding, superseding, retiring: `.claude/skills/decision-record-lifecycle/SKILL.md`.

File name: `NNNN-short-slug.md`. Frontmatter:

```yaml
---
id: 0001
title: Short title
kind: process
status: implemented # must match the zone directory
date: 2026-11-05
---
```

Sections: `## Problem`, `## Decision`, `## Alternatives considered`, `## Consequences`.
