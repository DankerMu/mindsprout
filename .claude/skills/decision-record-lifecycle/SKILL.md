---
name: decision-record-lifecycle
description: Use when adding, updating, superseding, or retiring decision records in MindSprout — enforces the supersession check on write and semantic (never quota-based) retirement.
---

# Decision Record Lifecycle

Guidance, not a script. Contract: `decisions/README.md`. Gate: `pnpm decisions:check` (frontmatter, kinds, zone/status match, unique ids, archive freeze).

## On every new record

1. Classify: which kind (`architecture`, `process`, `testing`, `bug-fix`, `feature`, `simplification`) and which zone (`proposed` while undecided, `implemented` when it ships in this PR).
2. Run the supersession check **at write time** (the author holds the freshest evidence): `grep -ril "<mechanism>" decisions/implemented decisions/proposed`. Fully superseded → fold every unique rationale/alternative/consequence into the new record, then retire the old one; partially superseded → keep both, cross-link, update the stale facts. A record is never edited into a different decision.
3. Next id = highest existing id + 1 across all zones. `## Alternatives considered` is mandatory.
4. Run `pnpm decisions:check` before committing.

## Moving between zones

- `proposed → implemented | rejected`: `git mv` the file, update `status:` to match the zone. Never leave status and zone disagreeing.
- `→ archived`: `git mv`, set `status: archived`, then add the file's sha256 to `decisions/archived/MANIFEST.json` (`sha256sum decisions/archived/<kind>/<file>.md`). Archived records are frozen; a correction is a new proposed record.

## Retirement is semantic, never quota

Word count and age are discovery aids, never criteria; do not retire toward a target. Keep any record whose alternatives, negative guarantees, ownership boundaries, security rules, or reintroduction conditions can still steer future work. A rejected record stays while it blocks a tempting mistake. Genuinely borderline records: list them with a recommendation instead of deciding silently.

What a green `pnpm decisions:check` does not prove: that the decision is still right, or that superseded records were folded — that judgment is this skill's reason to exist.
