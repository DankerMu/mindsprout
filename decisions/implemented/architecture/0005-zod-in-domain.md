---
id: 0005
title: zod is the one package domain/ may import
kind: architecture
status: implemented
date: 2026-11-05
---

# zod is the one package domain/ may import

Status: active — refines the "domain is pure" consequence of 0003 (no framework imports still holds; zod is not a framework)

## Problem

The `TreeOp` schema is a domain contract: the map reducer validates every op against it, and M3 provider output is validated against the same schema before it is applied (`AGENTS.md ## Important Development Notes`, note 2; decision 0002). The schema is written in `zod`, so it must live in `src/contexts/map/domain/` beside the types it describes. The `.dependency-cruiser.cjs` rule `domain-is-pure` rejected every npm import from `domain/` (`dependencyTypesNot: ['core']`), so the schema could not live there.

## Decision

- `zod` is a schema language, not a framework: it has no runtime environment, no I/O and no lifecycle. `domain/` may import it (any subpath: `zod`, `zod/v4`, `zod/mini`).
- `domain-is-pure` excludes exactly the resolved zod paths `^node_modules/zod/` and `^node_modules/\.pnpm/[^/]+/node_modules/zod/` (two entries: the single optional-group form `^node_modules/(\.pnpm/[^/]+/node_modules/)?zod/` is refused by dependency-cruiser's safe-regex check), which cover both pnpm layouts (hoisted `node_modules/zod/` and `node_modules/.pnpm/zod@*/node_modules/zod/`) and no lookalike package (`zod-x`, `zodiac`). Every other npm package stays rejected.
- The allowance is mirrored in `constraints.yaml` `module_boundaries.allowed_dependency_directions`, `AGENTS.md ## Directory Map`, the Layering table in `docs/engineering/architecture-discipline.md`, and the rule's own `comment`.

## Alternatives considered

- **Re-export zod through `src/shared/`** — lost: it would satisfy the rule text while hiding the dependency the rule exists to make visible (rejected in change `m1-canvas` design D2).
- **Hand-written validators in `domain/`** — lost: duplicates what zod already does and drifts from the schema that provider output validation needs; a second validation implementation is the canonicality violation `AGENTS.md ## Code Canonicality` forbids.
- **Keep the schemas in `application/`** — lost: the contract would then live outside the aggregate it protects, and the domain reducer could not validate its own input without importing upward.

## Consequences

- The allowance is one package. Any further package imported from `domain/` needs its own decision record and the same four mirrors plus the rule change.
- `pnpm boundaries` still rejects any other npm import from `domain/`; `scripts/test-guardrails.sh` carries "boundaries guard" cases that prove it — zod in `domain/` is accepted, react in `domain/` is rejected as `domain-is-pure`.
- `zod` becomes part of the domain's public contract: a zod major upgrade (via Renovate) is a domain change and is reviewed as one.
