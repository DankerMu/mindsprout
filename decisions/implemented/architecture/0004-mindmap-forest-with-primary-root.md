---
id: 0004
title: MindMap is a forest with one primary root
kind: architecture
status: implemented
date: 2026-11-05
---

# MindMap is a forest with one primary root

Status: active — partially supersedes 0003 (op list extended; the "only TreeOp mutates" rule is unchanged)

## Problem

Brainstorming needs nodes that are not yet attached anywhere ("先敲一堆再组织"). The single-root tree model (CONTEXT.md invariant, glossary `MindMap`, TECH §3) cannot express a floating idea without inventing a fake parent, which leaks into layout, export and AI context. Decided by the owner during the M1 stress-test (grill Q4–Q6).

## Decision

- `MindMap.roots: MindNode[]`; `roots[0]` is the **primary root** (central topic; never deleted or moved; default target of AI generation and export). Every further root is a **floating root** carrying `position: { x, y }` and an ordinary subtree laid out relative to it.
- The TreeOp protocol gains `add_root` and `set_root_position`; `move_node` accepts `newParentId: null` (detach to floating root) and attaches a floating root when given a parent. `replace_children` stays. Seven ops total.
- The aggregate for consistency is still the `MindMap`; one op touches one map.

## Alternatives considered

- **Keep single root, model floating nodes as children of a hidden pseudo-root** — lost: the pseudo-root would appear in layout, export and the AI path context; every consumer would need a special case.
- **Equal multi-root forest (no primary root)** — lost (owner's choice): AI generation, export and the map title would each need a "which tree" interaction.
- **Floating nodes without children (sticky notes)** — lost: blocks the brainstorm-then-organise flow the feature exists for.

## Consequences

- `CONTEXT.md` invariant "single-root aggregate" is replaced by "forest with one primary root"; `openspec/glossary.md` gains a `Floating root` term and revises `MindMap`; `docs/TECH.md` §3/§4 updated — all in the `m1-canvas` change.
- Export (M6) and AI prompt assembly (M3) must decide how floating subtrees are included; both default to "primary tree first, floating subtrees appended" until a later record says otherwise.
- Reintroduction condition for single-root: if floating roots see no use after M1 ships, a new record may remove `add_root`/`set_root_position`; this record is then superseded, not edited.
