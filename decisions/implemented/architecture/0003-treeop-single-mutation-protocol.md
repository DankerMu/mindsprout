---
id: 0003
title: TreeOp is the only way to mutate a MindMap
kind: architecture
status: implemented
date: 2026-11-05
---

# TreeOp is the only way to mutate a MindMap

Status: active — op list extended by 0004 (forest; `add_root`, `set_root_position`, `move_node` detach)

## Problem

Three AI interaction modes (one-shot generation, node-level Grow, conversational editing) plus manual editing all change the same tree. If each path mutates state directly, undo/redo, streaming rendering and provider portability each need bespoke handling.

## Decision

- A `MindMap` is a JSON forest with one primary root (0004); the canvas is a projection of it.
- Every mutation — human or AI — is a `TreeOp` (`add_children`, `add_root`, `update_node`, `delete_node`, `move_node`, `set_root_position`, `replace_children`; see 0004) applied by one reducer in the `map` context's domain layer.
- An AI session groups its ops into one undo unit; streaming renders ops as they arrive.
- Providers emit `TreeOp`s and nothing else (decision 0002).

## Alternatives considered

- **AI rewrites the whole tree, diffed on the client** — lost: diffing trees for undo is lossy and streaming becomes all-or-nothing.
- **Separate reducers per interaction mode** — lost: three implementations of the same invariants is the canonicality violation `AGENTS.md ## Code Canonicality` forbids.
- **Markdown as the exchange format** — lost: parsing is ambiguous for node identity and moves; JSON ops carry ids.

## Consequences

- `src/contexts/map/domain/` owns `TreeOp` + reducer and is pure (no framework imports — enforced by `pnpm boundaries`).
- The Zustand editor store lives in `src/contexts/map/application/editor-store` and only dispatches ops; `src/app` (the composition root) injects the repository into it and registers browser listeners. Direct state mutation is a review rejection (`AGENTS.md ## Important Development Notes`). (Location revised by change `m1-canvas`: `src/components` must import the store, and nothing may import from `src/app`.)
