# Tasks

Module boundaries follow `AGENTS.md ## Directory Map`; every task lands its own tests (TDD required, 90% per-file coverage) and the docs its work calls for. Dependencies are added by the task that first uses them (`knip` fails on an unused dependency).

## 1. Map domain — model, TreeOp schemas, reducer

- [ ] 1.1 Define `MindMap` (forest, `roots[0]` primary), `MindNode`, `ColorToken` and the seven `TreeOp` Zod schemas in `src/contexts/map/domain`; verify schema unit tests reject a malformed op before traversal and accept every op shape (spec map-tree-ops "Ops are validated").
- [ ] 1.2 Implement `applyOp` with exact inverses for `add_children`, `add_root`, `update_node`, `delete_node` plus the `unknown-node`, duplicate-id and `primary-root-protected` rules; verify unit tests cover each scenario in spec map-tree-ops for those ops and the apply→inverse round-trip property.
- [ ] 1.3 Implement `move_node` (reparent, detach to floating root, attach from floating root, cycle refusal, primary-root refusal), `set_root_position` and `replace_children` with inverses; verify unit tests cover the detach/attach/cycle scenarios and the round-trip property across all seven ops; verify `pnpm boundaries` still passes (domain imports only `zod`).

Suggested fixture level: expanded - the reducer is the persisted data shape and the protocol M3 providers will emit; schema and shared-state triggers apply.
Minimal mergeable slice: 1.1 + 1.2 (schemas and the four structural ops) - merge green on their own unit tests; `move_node` and the positional ops are a second, independently testable PR.

## 2. Undo history

- [ ] 2.1 Implement `History` (push / undo / redo / redo-clear / 200-entry cap) over `{ ops, inverses }` entries in `src/contexts/map/application/history`; verify unit tests cover spec map-undo-history scenarios "Undo a rename", "Redo after undo", "Branching history", "Cap at 200".
- [ ] 2.2 Add `beginGroup` / `endGroup` collapsing dispatches into one entry, including nested-call rejection; verify unit tests cover "Multi-select delete is one step" and "Undo a detach".

Suggested fixture level: compact - pure application module, no shared entrypoint or persisted shape.
Minimal mergeable slice: 2.1 - the ungrouped history is complete and green by itself; groups are additive.

## 3. Layout engine

- [ ] 3.1 Implement `layoutForest(map, options)` for the primary tree with `d3-hierarchy` `tree()` and LR axis swap, measured `nodeSize` input with text-length estimate fallback, collapsed subtrees skipped; add `d3-hierarchy` + `@types/d3-hierarchy`; verify unit tests cover "Three-level tree renders without overlap", "Adding a child reflows siblings", "Collapse and expand" (positions only) and "Layout is deterministic".
- [ ] 3.2 Lay out each floating subtree relative to its stored position and add a `contentBounds(layout)` helper for fit-to-content; verify unit tests cover "Move a floating root" (primary positions unchanged) and bounds including a far floating subtree.

Suggested fixture level: compact - pure function, no persistence or entrypoint.
Minimal mergeable slice: 3.1 - primary-tree layout is independently useful and tested; floating placement is a second PR.

## 4. Persistence — repository port and IndexedDB adapter

- [ ] 4.1 Define the `MapRepository` port in `domain/` and an `InMemoryMapRepository` in `infrastructure/persistence/`, with a shared contract test suite (`list` ordering by `updatedAt`, `get`/`put`/`delete`, `MapSummary` shape); verify the contract suite passes against the in-memory implementation.
- [ ] 4.2 Implement `IndexedDbMapRepository` with `idb` (object store `maps`, `{ schemaVersion: 1, map }` envelope, higher-version refusal with a typed error, open-failure surfaced as `StorageUnavailableError`); add `idb` and dev `fake-indexeddb`; verify the same contract suite passes against it under `fake-indexeddb` and unit tests cover spec map-persistence "Future version" and "Floating root round-trip".

Suggested fixture level: expanded - persisted state and a versioned file format.
Minimal mergeable slice: 4.1 - port, in-memory adapter and contract suite merge green with no browser APIs; the IndexedDB adapter is the second PR and only adds an implementation of an already-tested contract.

## 5. Editor store

- [ ] 5.1 Create the Zustand editor store in `src/contexts/map/application/editor-store`: load map, `dispatch(op)` through `applyOp` + `History`, `undo`/`redo`, `beginGroup`/`endGroup`, UI slice (selection set, editing node, context-menu target, viewport); add `zustand`, `nanoid`; verify unit tests show dispatch applies and records one history entry, a rejected op leaves state and history unchanged, and selection ops behave per spec canvas-editing "Selection" (pure state, no DOM).
- [ ] 5.2 Add autosave (500 ms debounce after the last op, flush on `beforeunload`), `storageUnavailable` flag populated from `StorageUnavailableError`, and write-failure notice state; verify unit tests with fake timers cover spec map-persistence "Rapid edits coalesce" and the unavailable path.

Suggested fixture level: compact - application state, no new persisted shape (the envelope is owned by task 4).
Minimal mergeable slice: 5.1 - the store without autosave is fully testable and green; autosave is a separate PR that only subscribes to it.

## 6. Canvas rendering and editor route

- [ ] 6.1 Build `src/components/canvas` with `@xyflow/react`: nodes/edges derived from store + `layoutForest`, custom node (title, color token, collapse toggle with descendant count, note indicator), pan/zoom bounds 25–200%, fit-to-content button; add `@xyflow/react`; create `/maps/[id]` page that loads the map from the repository (in-memory fallback + banner on `StorageUnavailableError`) and shows the not-found state for unknown ids; verify the page renders a stored map's primary root and a floating root at its position in a Playwright scenario, and a component test renders the collapsed indicator count.
- [ ] 6.2 Register `/maps/[id]` in `e2e/smoke.spec.ts` (seeded map, `data-testid` ready marker), update `constraints.yaml` `verification.key_ui_paths` status and `AGENTS.md ## Verification Matrix` key-route note; verify `pnpm e2e` walks both routes with zero console errors.

Suggested fixture level: compact - rendering only; mutations stay in tasks 7–9.
Minimal mergeable slice: 6.1 - a read-only canvas page merges green on its own; the e2e registration is a one-file follow-up.

## 7. Node editing interactions

- [ ] 7.1 Inline title editing: double-click / F2 opens the editor, Enter commits one `update_node`, Esc discards, blur commits, an empty title on a node created in this session removes it with no net history entry; verify Playwright scenarios "Commit a rename", "Escape discards", "Empty new node is discarded".
- [ ] 7.2 Keyboard shortcuts per design D10 (Tab child, Enter sibling / child on primary root, Delete, arrows, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+A, Esc), inert while a text field has focus; verify Playwright scenarios "Tab adds a child", "Enter on the primary root", "Arrow navigation", "Delete inside the editor".
- [ ] 7.3 Selection: click, Shift+click toggle, rubber-band on empty canvas, select-all, Esc clear; verify Playwright scenario "Rubber-band selection" and a store unit test for Shift+click toggling.

Suggested fixture level: compact - UI interactions over an already-tested store.
Minimal mergeable slice: 7.1 - inline editing alone is a complete, demonstrable feature; shortcuts and selection are independent PRs that both depend on it only for the "editing" flag.

## 8. Drag — reparent, detach, group drag

- [ ] 8.1 Drag a single node: on drop, hit-test laid-out rects → `move_node(newParentId)`; drop on empty canvas → `move_node(null, position)` for tree nodes or `set_root_position` for floating roots; cycle or primary-root refusal snaps the node back with no history entry; verify Playwright scenarios "Reparent by drop", "Detach to canvas", "Refused cycle".
- [ ] 8.2 Multi-select drag moves the whole selection under one target as one history group (delete and color groups from task 9 reuse the same helper); verify Playwright scenario "Delete two selected subtrees" undo-count assertion generalised to group drag (one undo restores all).
- [ ] 8.3 Profile a generated 500-node map during drag and record frame timing in the PR's Runtime evidence (manual profiling note, not a CI harness — see design Open Question 1 / Not yet specified); verify the note states the measured frame time and the memoisation applied if the budget was missed.

Suggested fixture level: compact - interaction layer; the ops it emits are already covered by task 1.
Minimal mergeable slice: 8.1 - single-node drag is independently demonstrable; group drag is a follow-up PR.

## 9. Context menu, colors, notes, collapse UI

- [ ] 9.1 Context-menu registry (`MenuItem { id, label, shortcut?, isEnabled, run }`) and component with the eight M1 items and primary-root disabling rules; verify a unit test of the registry's enablement and a Playwright scenario "Menu on the primary root".
- [ ] 9.2 Color tokens: theme CSS variables for six tokens in light/dark, menu submenu, group apply as one history entry; verify Playwright scenarios "Set color from the menu" and "Group color".
- [ ] 9.3 Note side panel (plain textarea, commit on blur, indicator on canvas) and collapse/expand toggle wired to `update_node`; verify Playwright scenarios "Add a note" and "Collapse and expand".

Suggested fixture level: compact - UI over existing ops.
Minimal mergeable slice: 9.1 - the menu with add/rename/delete/collapse/detach items works without colors or notes; 9.2 and 9.3 are independent follow-ups.

## 10. Map library page

- [ ] 10.1 Replace the placeholder home page with the library: list ordered by `updatedAt` desc, empty state, 新建导图 creating a map with primary root "新导图" and navigating to its editor (keep `data-testid="app-ready"`); verify Playwright scenarios "Create from the empty state" and "Ordering".
- [ ] 10.2 Rename (title independent of primary root text) and delete with confirmation, plus the not-found state link; verify Playwright scenarios "Rename from the list", "Delete with confirmation", "Stale link".

Suggested fixture level: compact - page over the repository port.
Minimal mergeable slice: 10.1 - list + create is a complete flow; rename/delete is a second PR.

## 11. Integration verification and M1 closure

- [ ] 11.1 End-to-end M1 acceptance walk in Playwright: create map → Tab child → rename → drag-reparent → detach → reload → structure, position and note persist; plus the storage-unavailable banner scenario with IndexedDB blocked; verify `pnpm e2e` passes with zero console errors and screenshots land in `.run/ui-evidence/`.
- [ ] 11.2 M1 closure docs: add `## Known Limitations` to `README.md` (no AI, browser-only storage, LR layout only, no export), remove the README allowlist entry from `docs/.docgate.json` and the matching `constraints.yaml` exemption; verify `pnpm docs:check` passes without the allowlist.

Suggested fixture level: compact - verification and docs only.
Minimal mergeable slice: 11.1 - the acceptance walk merges on its own; the README closure is a docs-only follow-up.

## Workflow follow-up

- Archive the change after every task group's PR has merged and `pnpm check` is green on `main`.
