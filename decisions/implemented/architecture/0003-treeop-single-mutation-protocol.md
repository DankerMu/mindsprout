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
- Node-drag positions are temporary controlled canvas state, not map mutations. A gesture freezes the selected top-most subtrees and their visual y/x order (tree-order ties); every visible descendant follows the grabbed node's delta exactly once, including when the grab is a selected descendant. The application drop planner uses original layout boxes for pointer hit-testing and the grabbed top-left plus frozen member offsets for placement. An accepted stop rechecks live map, selection membership and editing, then dispatches the complete existing-TreeOp list inside one `runGrouped('move')`; selection pruning during dispatch cannot change that list. A set containing the primary root, or a drop targeting a member or its descendant, refuses the whole set. Refusal, cancellation and stale map/layout/selection discard every preview without history or persistence writes. React Flow owns neither final geometry nor tree state.
- A drag stop must match its source node and owning mouse or touch contact. Native input collisions cancel the preview and remain ineligible until held inputs end; library aborts must not leave temporary geometry behind or create a TreeOp.
- Node-drag autopan is enabled only for a live gesture. Cancellation keeps it disabled through one animation-frame boundary so queued library callbacks cannot attach to a replacement gesture. Replacement preview and drop remain immediate; edge autopan resumes on native movement after that boundary.
- Context-menu entries are ordered application registrations over an explicit target, selection, layout positions and existing editor actions; rendering has no operation-specific branches. Creation, naming and deletion retain the store's grouping rules. Collapse and detach affect only the target, and detach uses its laid-out flow position rather than pointer or preview coordinates. Menu activation rechecks live map/layout and target ownership; dismissal or stale ownership cannot dispatch or steal a replacement edit's focus.
