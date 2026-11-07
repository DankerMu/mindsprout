---
id: 0003
title: TreeOp is the only way to mutate a MindMap
kind: architecture
status: implemented
date: 2026-11-05
---

# TreeOp is the only way to mutate a MindMap

Status: active — op list extended by 0004 (forest; `add_root`, `set_root_position`, `move_node` detach); domain purity refined by 0005 (zod is the one permitted package)

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
- The Zustand editor store lives in `src/contexts/map/application/editor-store`; tree changes dispatch ops, while selection stays in its session-only UI slice. `src/app` supplies the session `MapRepository`; `src/components/editor/EditorSession` owns store creation, repository injection, and pagehide/unmount listeners. Direct state mutation is a review rejection (`AGENTS.md ## Important Development Notes`).
- `EditorView` supplies controlled selection state and actions to the canvas. Click, rubber-band and navigation use those actions without changing map identity, history or persistence. React Flow's native selection, positional keyboard edits and deletion are disabled so gestures have one selection authority.
- Inline titles keep drafts local and finish through the session's `commitTitle` / `cancelEdit` actions. Terminal events are idempotent; the UI checks live edit identity and visibility before committing and cancels hidden rename targets. Canvas selection and pan shortcuts stay inert during text entry.
- Tab/Enter creation calls the store's `createNode` action; expansion and naming share its group, and cancellation restores the group and prior selection. The existing title input waits for a new React Flow node's measurement if its initial hidden wrapper rejects focus. Open creation groups remain excluded from autosave; the canvas does not dispatch independent add/expand operations.
- Single-node drag positions are temporary controlled canvas state, not map mutations. The application drop planner uses the original layout for pointer hit-testing and the dragged top-left for placement; only an accepted stop dispatches an existing TreeOp. Refusal, cancellation and stale map/layout identity discard the preview without history or persistence writes. React Flow owns neither final geometry nor tree state; layout remains authoritative even when the map is unchanged.
