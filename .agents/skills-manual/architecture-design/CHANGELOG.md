# Changelog

## [0.2.0] - 2026-09-05

### Fixed

- Dangling routes from the import: `codebase-design` and `prototype` do not exist in this repo — removed. The upstream `/wayfinder` slot ("huge or foggy multi-session effort") had been remapped to `/implementation-planning`, a single-session deep plan for a settled direction — the opposite case. It now routes to `stage-change-pipeline`, whose design.md `## Not yet specified` / Non-Goals sections (0.20.0) are this repo's answer to fog, and says plainly that no multi-session navigator exists here yet.

### Changed

- Glossary home aligned with this repo: domain terms are read from and sharpened in `openspec/glossary.md` (the file `grill-me` docs mode maintains — step 4 previously named `CONTEXT.md` while delegating to a mode that writes the other file). Upstream's `CONTEXT-MAP.md` multi-file rule becomes GLOSSARY-FORMAT's single-file `## Context Map`. `CONTEXT.md` is still read when present, for bounded contexts and invariants (`eng-init`'s file).

## [0.1.0] - 2026-08-28

- Imported from stellarlink-skills into the my-agents monorepo as part of the `stellarlink` pack.
- Cross-skill references remapped to this repo's skills where the original target is not bundled.
