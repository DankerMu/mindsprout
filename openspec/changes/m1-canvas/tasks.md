# Tasks

Module boundaries follow `AGENTS.md ## Directory Map`; every task lands its own tests (TDD required, 90% per-file coverage) and the docs its work calls for. Dependencies are added by the task that first uses them (`knip` fails on an unused dependency). Verification tiers: **unit** = Vitest in `node` (domain/application) or jsdom component tests (`src/**/*.test.tsx` in the `dom` Vitest project, tier added by task 6.0) — this is what the per-file coverage gate measures; **e2e** = the named Playwright scenario from the spec. Each UI task says which assertions are unit and which are e2e; every spec scenario with a user-visible THEN is named by exactly one task.

## 1. Map domain — model, TreeOp schemas, reducer

- [x] 1.0 Allow `zod` in `domain/` (design D2, decision 0005): amend `.dependency-cruiser.cjs` `domain-is-pure` so its `to` excludes only the `zod` package (resolved paths `node_modules/zod/` and `node_modules/.pnpm/*/node_modules/zod/`, two pathNot entries — a single optional-group regex is rejected by dependency-cruiser's safe-regex check) and update the rule's `comment` string; mirror the allowance in `constraints.yaml` `module_boundaries.allowed_dependency_directions`, `AGENTS.md ## Directory Map` and the `docs/engineering/architecture-discipline.md` Layering table domain row with the exact per-file text in design "Fixture — issue #2"; ship `decisions/implemented/architecture/0005-zod-in-domain.md`; verify (gate) a temporary probe `import { z } from 'zod'` in `src/contexts/map/domain/` passes `pnpm boundaries` while a probe `import 'react'` fails naming `domain-is-pure` as the only violation, a node one-liner shows the pattern matches hoisted/.pnpm/subpath zod paths and not lookalikes, both probes are deleted, and `pnpm decisions:check`, `pnpm docs:check`, `pnpm test:guardrails` pass; the PR flags the `constraints.yaml` edit and the `AGENTS.md` generated-section edit for owner acceptance.
- [x] 1.1 Define `MindMap`, `MindNode`, `ColorToken`, `NewNode` (recursive, no `position`), `TreeOpError` with the D2 code set, the seven strict `TreeOp` Zod schemas (`move_node` as a discriminated union on `newParentId`; `update_node` with `note`/`color` nullable) and the `createMindMap({ id, rootId, title, rootText })` factory in `src/contexts/map/domain`; verify (unit) schema tests cover spec map-tree-ops "Malformed payload", "Creation payload cannot carry a position", "Detach without a position", "Reparent with a position" (all `invalid-op` before traversal) and accept every op shape, and the factory test covers "New map has exactly one root".
- [x] 1.2 Implement `applyOp` (`{ map, inverse: TreeOp[] }`) for `add_children`, `add_root`, `update_node`, `delete_node` with the `unknown-node`, `invalid-target` (duplicate id, payload-internal duplicate, index out of range) and `primary-root-protected` rules; verify (unit) tests cover spec map-tree-ops "Floating root carries a position", "Reducer leaves metadata untouched", "Inverse of a multi-child add", "Add a subtree in one op", "Clear a color", "Inverse of setting a color on an uncoloured node", "Unknown node id", "Deleting the primary root", "Renaming the primary root", "Delete a node with children", "Delete a collapsed node with grandchildren", "Delete a floating root", "Duplicate id on add", "Duplicate id inside one payload", "Expanded is stored as no flag", plus "Input map is untouched" and the apply→inverse round-trip property for these ops (the all-ops scenario is closed by 1.3).
- [x] 1.3 Implement `move_node` (both variants: reparent, attach from floating root with roots-index inverse, detach to floating root, cycle refusal, primary-root refusal, already-floating refusal), `set_root_position` (floating roots only) and `replace_children` (id reuse inside the replaced subtree) with inverses; verify (unit) tests cover "Move a node under its own child", "Positioning the primary root", "Detach a child into a floating root", "Attach a floating root under a node", "Position a non-root node", "Detach a node that is already floating", "Reuse of replaced ids is accepted", "External duplicate is rejected", "Inverse restores the old children" and "Applying then applying the inverse restores the map" across all seven ops; verify `pnpm boundaries` passes under the task 1.0 rule.

Suggested fixture level: expanded - the reducer is the persisted data shape and the protocol M3 providers will emit; schema and shared-state triggers apply; 1.0 touches constraints.yaml (Critical Path: gate integrity).
Minimal mergeable slice: 1.0 - the gate amendment plus decision record is a complete, self-verifying PR (`pnpm boundaries` + `pnpm test:guardrails`); 1.1 + 1.2 follow as the schemas and four structural ops; `move_node` and the positional ops are a third, independently testable PR.

## 2. Undo history

- [x] 2.1 Implement `History` (push / undo / redo / redo-clear / 200-entry cap / `canUndo` / `canRedo`) over `{ ops, inverses: TreeOp[][] }` entries in `src/contexts/map/application/history`; verify (unit) tests cover spec map-undo-history "Undo a rename", "Redo after undo", "Undo a multi-child add", "Branching history", "Cap at 200".
- [x] 2.2 Add `beginGroup` / `endGroup` / `cancelGroup` with the atomicity rules of design D3 (nested `beginGroup` throws `group-open`, rejected dispatch cancels the group and rethrows, empty group pushes nothing, `undo`/`redo` while open throw); verify (unit) tests cover "Multi-select delete is one step", "Empty group leaves no entry", "Nested beginGroup is rejected", "Rejected op cancels the group", "Cancelled group leaves no entry", "Undo while a group is open", "Undo a detach", "Undo deleting a floating root".

Suggested fixture level: compact - pure application module, no shared entrypoint or persisted shape.
Minimal mergeable slice: 2.1 - the ungrouped history is complete and green by itself; groups are additive.

## 3. Layout engine

- [ ] 3.1 Implement `layoutForest(map, options)` for the primary tree with `d3-hierarchy` `tree()` and LR axis swap, measured `nodeSize` input with text-length estimate fallback, collapsed subtrees skipped; add `d3-hierarchy` + `@types/d3-hierarchy`; verify (unit) tests cover spec canvas-layout "Three-level tree renders without overlap", "Adding a child reflows siblings", "Measured size replaces the estimate" (positions only), the collapsed case of requirement "Collapsed nodes hide their subtree" (positions only; the rendered scenario belongs to task 9.1) and "Re-layout without changes".
- [ ] 3.2 Lay out each floating subtree relative to its stored position and add a `contentBounds(layout)` helper for fit-to-content; verify (unit) tests cover "Move a floating root" (primary positions unchanged) and bounds including a far floating subtree (the rendered fit-to-content scenario belongs to task 6.2).

Suggested fixture level: compact - pure function, no persistence or entrypoint.
Minimal mergeable slice: 3.1 - primary-tree layout is independently useful and tested; floating placement is a second PR.

## 4. Persistence — repository port and IndexedDB adapter

- [x] 4.1 Define in `src/contexts/map/domain/` the `MapRepository` port, `MapSummary { id, title, updatedAt }`, `StorageUnavailableError` and `UnsupportedSchemaVersionError { found, supported }`; implement `InMemoryMapRepository` in `infrastructure/persistence/` with a shared contract test suite (`list` ordering by `updatedAt` desc, `get` returns `undefined` for unknown ids, `put` stores the map as given, `delete`, `MapSummary` shape); verify (unit) the contract suite passes against the in-memory implementation.
- [x] 4.2 Implement `IndexedDbMapRepository` with `idb` (object store `maps`, `{ schemaVersion: 1, map }` envelope, higher version → `UnsupportedSchemaVersionError`, open failure → `StorageUnavailableError`, both the domain-declared errors from 4.1); add `idb` and dev `fake-indexeddb`; verify (unit) the same contract suite passes against it under `fake-indexeddb` and tests cover the `UnsupportedSchemaVersionError` path of spec map-persistence requirement "Persisted shape is versioned" (the user-visible scenario is task 6.2) and "Floating root round-trip".

Suggested fixture level: expanded - persisted state and a versioned file format.
Minimal mergeable slice: 4.1 - port, errors, in-memory adapter and contract suite merge green with no browser APIs; the IndexedDB adapter is the second PR and only adds an implementation of an already-tested contract.

## 5. Editor store

- [x] 5.1 Create the Zustand editor store in `src/contexts/map/application/editor-store` (decision 0003 consequence as revised in this change): load map, `dispatch(op)` through `applyOp` + `History`, `undo`/`redo`/`canUndo`/`canRedo`, `beginGroup`/`endGroup`/`cancelGroup` and the `runGrouped(label, fn)` helper, `createNode(parentId, index?)` opening the creation group (expanding a collapsed parent with `update_node { collapsed: false }` inside the group, design D3) with `commitTitle(text)` (empty → `cancelGroup`) and `cancelEdit()`, `topmostSelected()` normalisation, `rename(title)` stamping `updatedAt` without a history entry, UI slice (selection set with primary selected node, editing node, context-menu target, viewport, notice); add `zustand`, `nanoid`; verify (unit, no DOM) dispatch applies and records one history entry, a rejected op leaves state and history unchanged, selection behaves per spec canvas-editing "Selection" (click, Shift+click toggle, select-all, clear), create-and-name is one entry and an empty commit leaves none (spec map-undo-history "Create and name is one step", "Abandoned node leaves no entry"), `createNode` on a collapsed parent records the expand in the same entry so one undo re-collapses it and a cancel re-collapses it, select-all → `topmostSelected()` returns exactly the roots, and `rename` changes `title`/`updatedAt` without touching `canUndo`.
- [ ] 5.2 Add autosave: 500 ms debounce after the last op, `updatedAt` stamped before every `put`, a `flush()` method (the `pagehide` listener is registered by the route in task 6.2), `storageUnavailable` flag from `StorageUnavailableError`, and write-failure notice state ("保存失败") when `put` rejects; verify (unit, fake timers) spec map-persistence "Rapid edits coalesce", "Save stamps updatedAt", the unavailable path and the rejected-`put` path (edit stays in state, notice set).

Suggested fixture level: 5.1 compact - application state over already-tested modules; 5.2 expanded - it owns the persisted-state write/flush path and its failure surfacing (sibling surfaces: `IndexedDbMapRepository.put` in 4.2, banner/toast rendering in 6.3, the `pagehide` listener in 6.2).
Minimal mergeable slice: 5.1 - the store without autosave is fully testable and green; autosave is a separate PR that only subscribes to it.

## 6. Canvas rendering and editor route

- [ ] 6.0 Component-test tier: add dev `jsdom`, `@testing-library/react` and its peer `@testing-library/dom`; `vitest.config.ts` splits into a `node` project (`src/**/*.test.ts`) and a `dom` project (`src/**/*.test.tsx`, jsdom), so a `.test.tsx` file opts in by its extension; the `dom` project's `setupFiles` loads `tests/support/dom-shims.ts` (`ResizeObserver`, `matchMedia`, `DOMMatrixReadOnly`/`DOMMatrix` no-ops for React Flow, plus RTL cleanup); document the tier in `docs/engineering/architecture-discipline.md` TDD section; verify (unit) a smoke component test (`src/components/canvas/smoke.test.tsx`, trivial component inline) passes in jsdom, a temporary `.tsx` coverage probe shows the per-file gate measures UI files, and `pnpm test:unit` stays green in node for existing tests. Issue #14 revised the original docblock / `src/test/` / on-file-coverage wording; the reasons are in proposal "Fixture triage — issue #14".
- [ ] 6.1 Build `src/components/canvas` over a static `map` prop with `@xyflow/react`: nodes/edges from `layoutForest`, custom node (title, color token class, collapse indicator with descendant count, note indicator), `ResizeObserver` measurement fed back as `nodeSize` (design D4), pan/zoom clamped 25–200%, fit-to-content button using `contentBounds`; add `@xyflow/react`; verify (unit, jsdom) component tests cover the collapsed indicator count, the note indicator, the color token class, estimate-then-measured `nodeSize` feedback, zoom clamping and that a floating root renders at its position; the rendered scenarios are verified through the route in task 6.2.
- [x] 6.2 Create `/maps/[id]`: the app-wide `MapRepository` provider in `src/app/providers/` (one instance per session, IndexedDB by default), page loads the map into the editor store, registers a `pagehide` listener calling `flush()`, shows the not-found state for unknown ids and "此导图由更新版本创建" on `UnsupportedSchemaVersionError`; verify (e2e) spec map-library "Stale link", spec map-persistence "Future version" (seeded `schemaVersion: 2` record), "Reload after edits", "Edits older than the save window survive reload", spec canvas-layout "Fit to content", "Zoom clamps", "Space-drag pans", and that a seeded map renders its primary root and a floating root at its position.
- [x] 6.3 Storage fallback and notices: the provider falls back to one shared `InMemoryMapRepository` on `StorageUnavailableError` and exposes `storageUnavailable`; the editor renders the persistent banner "未保存到浏览器" and the "保存失败" toast from the store's notice state; verify (unit, jsdom) banner and toast components render from state; verify (e2e, IndexedDB blocked via `page.addInitScript`) spec map-persistence "Private mode" and "Write failure is visible" (a `put` forced to reject).
- [x] 6.4 Register `/maps/[id]` in `e2e/smoke.spec.ts` (seeded map, `data-testid` ready marker), update `constraints.yaml` `verification.key_ui_paths` status and `AGENTS.md ## Verification Matrix` key-route note; verify `pnpm e2e` walks both routes with zero console errors and `pnpm test:guardrails` passes; the PR flags the `constraints.yaml` edit and the `AGENTS.md` generated-section edit for owner acceptance.

Suggested fixture level: 6.0 expanded - shared test configuration (`vitest.config.ts` setupFiles) used by every later UI task; 6.1–6.3 compact - rendering and wiring over already-tested modules, mutations stay in tasks 7–9; 6.4 expanded - touches `constraints.yaml` (Critical Path: gate integrity) and an `AGENTS.md` generated section.
Minimal mergeable slice: 6.0 - the component-test tier merges green on its smoke test alone; 6.1 is the first feature slice (a read-only canvas over a static map, verified by component tests), 6.2 wires the route and owns the rendered scenarios, 6.3 adds the failure surfaces, 6.4 is a one-file-plus-config follow-up.

## 7. Node editing interactions

- [x] 7.1 Inline title editing of existing nodes: double-click / F2 opens the editor on the targeted node only, Enter commits one `update_node`, Esc discards, blur commits, any length accepted; verify (unit, jsdom) the title input commits on Enter/blur and discards on Esc; verify (e2e) spec canvas-editing "Commit a rename", "Escape discards", "Long title", "Rename with three nodes selected".
- [x] 7.2 Node creation: Tab adds a child, Enter adds a sibling (a child on any root), both through the store's `createNode` creation group; the new node enters inline editing immediately, empty commit or Esc removes it; a collapsed parent is expanded inside the creation group so the editor can take focus; verify (e2e) spec canvas-editing "Tab adds a child", "Tab on a collapsed node", "Enter on the primary root", "Enter on a floating root", "Name a new node", "Empty new node is discarded".
- [x] 7.3 Selection and navigation: click, Shift+click toggle, rubber-band on empty canvas, Cmd/Ctrl+A, Esc clear, arrow keys (← no-op on roots, → no-op on a collapsed node); every shortcut gated by the `isEditing` flag; verify (unit, jsdom) the keyboard handler maps keys to store actions, leaves the selection unchanged for → on a collapsed node, and is inert while a text field has focus; verify (e2e) "Rubber-band selection", "Arrow navigation", "Arrow right on a collapsed node", "Arrow left on a floating root".
- [x] 7.4 Delete selection as one group: Delete/Backspace (outside an editor) runs `runGrouped('delete')` over the top-most selection after excluding the primary root, with the notice "主根不能删除" when it was selected; the menu's 删除 (task 9.1) reuses the same store action; verify (unit) the store action normalises and skips the primary root; verify (e2e) spec canvas-editing "Delete two selected subtrees", "Primary root in selection", "Select all then Delete", "Delete a floating root from the canvas", "Delete inside the editor".
- [x] 7.5 Undo/redo affordances: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, toolbar 撤销/重做 buttons bound to `canUndo`/`canRedo`, inert while editing; verify (unit, jsdom) buttons disable from state; verify (e2e) spec canvas-editing "Undo a Tab-created child with Cmd/Ctrl+Z", "Redo with Cmd/Ctrl+Shift+Z", "Buttons reflect availability", "Undo inside the editor" and spec map-undo-history "Reload clears history".

Suggested fixture level: compact - UI interactions over an already-tested store.
Minimal mergeable slice: 7.1 - inline editing of existing nodes is a complete, demonstrable feature; 7.2 depends on it for the editor, 7.3 and 7.5 are independent PRs, 7.4 depends on 7.3 for multi-selection.

## 8. Drag — reparent, detach, group drag

- [x] 8.1 Drag a single node: on drop, hit-test laid-out rects → `move_node(newParentId)`; drop on empty canvas → `move_node(null, position)` for tree nodes or `set_root_position` for floating roots; cycle, primary-root or drop-on-self refusal snaps the node back with no dispatch; verify (unit) the hit-test and refusal predicate over laid-out rects; verify (e2e) spec canvas-editing "Reparent by drop", "Detach to canvas", "Refused cycle", "Primary root in the dragged set".
- [x] 8.2 Group drag over `topmostSelected()` (helper from task 5.1) under one target or onto empty canvas with per-node offsets, refusal when the primary root is dragged or the target is a dragged node or its descendant, all inside `runGrouped('move')`; verify (unit) the drop planner produces the op list and refusals of design D5; verify (e2e) spec canvas-editing "Group drag", "Nested selection moves once", "Drop on a selected node is refused", "Group detach to canvas".
- [x] 8.3 Performance evidence per design D11 and spec canvas-layout "Large maps stay responsive while dragging": add a 500-node fixture generator (`e2e/fixtures/large-map.ts`, reused by the e2e seed), profile a two-second leaf drag on a production build with the Chrome DevTools Performance panel, apply the D11 memoisation if the budget is missed; verify scenario "500-node drag profile": the PR's `## Runtime evidence` states median and p95 frame times against the ≤ 16.7 ms / ≤ 33 ms budget (review-only evidence; no CI harness).

Suggested fixture level: compact - interaction layer; the ops it emits are already covered by task 1.
Minimal mergeable slice: 8.1 - single-node drag is independently demonstrable; 8.2 depends on 7.4 and is a follow-up PR; 8.3 is evidence plus memoisation only.

## 9. Context menu, colors, notes, collapse UI

- [x] 9.1 Context-menu registry (action/submenu contract in design D6, where `ctx` = target, selection and the layout `positions` map from `layoutForest`) in `application/menu/` and the menu component with the six ops-only items — 添加子节点, 添加兄弟节点, 重命名, 删除 (store action from 7.4), 折叠/展开 (`update_node { collapsed }` on the target only), 脱离为浮动节点 (one `move_node { newParentId: null, position: ctx.positions.get(target) }` on the target only, design D6) — with the root enablement rules of design D6; verify (unit) registry enablement for the primary root, a floating root and a child, that 折叠 acts on the target regardless of selection, and that 脱离为浮动节点, given a `positions` map in `ctx`, dispatches the detach op with the target's position from that map regardless of selection; verify (e2e) spec canvas-editing "Menu on a floating root", "Detach from the menu", "Collapse with three nodes selected" and spec canvas-layout "Collapse and expand".
- [x] 9.2 Color tokens: theme CSS variables for six tokens in light/dark, 设置颜色 submenu with the six tokens plus 无颜色 (`color: null`), group apply through `runGrouped('color')`; verify (unit) the submenu dispatches token or `null` for every selected node; verify (e2e) spec canvas-editing "Set color from the menu", "Clear a color from the menu", "Group color".
- [x] 9.3 Note side panel (plain textarea, commit on blur, `note: null` when emptied, indicator on canvas) and the 编辑备注 item, completing the eight-item menu; verify (unit, jsdom) the panel commits once on blur; verify (e2e) spec canvas-editing "Add a note" and "Menu on the primary root" (all eight items present, three disabled).

Suggested fixture level: compact - UI over existing ops.
Minimal mergeable slice: 9.1 - the registry and the six ops-only items work without colors or notes; 9.2 is an independent follow-up; 9.3 depends on 9.2 so that its eight-item scenario is verifiable.

## 10. Map library page

- [x] 10.1 Replace the placeholder home page with the library over the shared repository provider: list ordered by `updatedAt` desc, empty state, 新建导图 calling `createMindMap` (title and primary root "新导图"), saving and navigating to the editor (keep `data-testid="app-ready"`); verify (unit, jsdom) the list renders summaries in order and the empty state; verify (e2e) spec map-library "Create from the empty state" and "Ordering".
- [ ] 10.2 Rename (application-layer title update stamping `updatedAt`, independent of the primary root text) and delete with confirmation; verify (e2e) spec map-library "Rename from the list", "Delete with confirmation".
- [x] 10.3 Library under storage-unavailable: banner on `/`, session maps listed from the shared in-memory fallback, create → editor works, reload shows not-found plus banner; verify (e2e, IndexedDB blocked) spec map-library "Create with storage blocked" and "Reload with storage blocked".

Suggested fixture level: compact - page over the repository port.
Minimal mergeable slice: 10.1 - list + create is a complete flow; rename/delete is a second PR; 10.3 depends on 6.3.

## 11. Integration verification and M1 closure

- [ ] 11.1 End-to-end M1 acceptance walk in Playwright: create map → Tab child → rename → drag-reparent → detach → reload → structure, position and note persist and 撤销 is disabled after the reload (re-asserting the reload-clears-history rule owned by 7.5); verify `pnpm e2e` passes with zero console errors and screenshots land in `.run/ui-evidence/`.
- [ ] 11.2 M1 closure docs: add `## Known Limitations` to `README.md` (no AI, browser-only storage, last-500 ms-burst may be lost on immediate reload, LR layout only, no export), remove the README allowlist entry from `docs/.docgate.json` and the matching `constraints.yaml` exemption; verify `pnpm docs:check` passes without the allowlist and `pnpm test:guardrails` passes; the PR flags the `constraints.yaml` edit.

Suggested fixture level: 11.1 compact - verification only; 11.2 expanded - touches `constraints.yaml` (Critical Path: gate integrity).
Minimal mergeable slice: 11.1 - the acceptance walk merges on its own; the README closure is a docs-plus-gate follow-up.

## Workflow follow-up

- Archive the change after every task group's PR has merged and `pnpm check` is green on `main`.

## Risk packs — issue #2 (task 1.0)

- Config / project setup — selected: the change is four rule mirrors + the rule itself; evidence = `pnpm boundaries` on the two probes (zod passes, react fails on domain-is-pure) + `pnpm test:guardrails`.
- Documentation / migration notes — selected: decision 0005, AGENTS.md, constraints.yaml and architecture-discipline.md wording; evidence = `pnpm decisions:check`, `pnpm docs:check`.
- Release / packaging / dependency compatibility — selected: the allowance depends on pnpm's node_modules layout and zod subpaths (zod/v4, zod/mini); evidence = the regex check in design "Fixture — issue #2" Required evidence (both layouts and subpaths match, lookalikes do not).
- Public API / CLI / script entry; File IO; Schema; Auth; Concurrency; Resource limits; Legacy compatibility; Error handling — not selected: no `src/` behaviour or runtime code changes.

## Risk packs — issue #3 (task 1.1)

- Schema / columns / units / field names — selected: the seven TreeOp schemas and the MindMap/MindNode shapes are the persisted and provider-facing contract; evidence = schema accept/reject unit tests named in design "Fixture — issue #3".
- Public API / CLI / script entry — selected: domain exports are the API every later slice (reducer, store, providers) consumes; evidence = exported names fixed in the fixture, typecheck, knip (no unused exports beyond the fixture list).
- Error handling / rollback / partial outputs — selected: `TreeOpError` code set is the only error surface; evidence = reject tests assert code `invalid-op` and attached issues; no traversal before validation (pure parse).
- Config / project setup — selected (amendment): `domain-is-pure` gains a test-file exemption mirrored in constraints.yaml with decision 0006; evidence = `pnpm boundaries` on the real tests + `pnpm test:guardrails` accept case.
- File IO; Auth; Concurrency; Resource limits; Legacy compatibility; Release / packaging; Documentation — not selected: no IO, auth, async, size limits, legacy consumers or new dependencies (zod already present); docs are the fixture itself.

## Risk packs — issue #4 (task 1.2)

- Schema / columns / units / field names — selected: applyOp's output is the persisted MindMap shape (canonical collapsed, no undefined keys, position only on floating roots); evidence = scenario tests asserting exact node shapes + round-trip property in design "Fixture — issue #4".
- Public API / CLI / script entry — selected: `applyOp` signature and inverse shapes are consumed by History (#6) and the store (#12); evidence = exact-inverse `toEqual` assertions per op, typecheck, knip.
- Error handling / rollback / partial outputs — selected: rejections must throw the exact `TreeOpError.code` and leave the input untouched; evidence = rejection tests per code on frozen maps + snapshot comparison after each rejection; unsupported ops throw `invalid-op`.
- Concurrency / shared state / ordering — selected: purity and inverse ordering (reverse-order deletes, original indices) are what make undo correct; evidence = "Input map is untouched" on deep-frozen fixtures + seeded round-trip property.
- Config; File IO; Auth; Resource limits; Legacy compatibility; Release / packaging; Documentation — not selected: no config, IO, auth, size limits, legacy consumers or new dependencies; docs are the fixture itself.

## Risk packs — issue #5 (task 1.3)

- Schema / columns / units / field names — selected: move/attach/detach and replace_children change which nodes carry `position` and which ids exist in the persisted map; evidence = scenario tests asserting exact node shapes (no position after attach, copied position after detach) + seven-op round-trip property in design "Fixture — issue #5".
- Public API / CLI / script entry — selected: move_node index semantics and inverse shapes are what drag (#24/#25), the menu (#27) and History (#6/#7) consume; evidence = exact-inverse `toStrictEqual` assertions per variant, typecheck, knip.
- Error handling / rollback / partial outputs — selected: cycle, primary-root-protected and invalid-target must throw the exact code with the input untouched; evidence = rejection tests per code on frozen maps + snapshot comparison.
- Concurrency / shared state / ordering — selected: final-index semantics and LIFO inverse application decide whether undo restores sibling order; evidence = same-parent reorder test + round-trip property with explicit indices.
- Config; File IO; Auth; Resource limits; Legacy compatibility; Release / packaging; Documentation — not selected: no config, IO, auth, size limits, legacy consumers or new dependencies (tests/support/ is test code only); docs are the fixture itself.

## Risk packs — issue #6 (task 2.1)

- Public API / CLI / script entry — selected: `History`, `HistoryEntry`, `HistoryError`, `HISTORY_LIMIT` are what #7, #12 and #23 build on; evidence = names fixed in design "Fixture — issue #6", typecheck, knip.
- Concurrency / shared state / ordering — selected: undo applies inverse lists last-first with each list in order; evidence = outer-order test (dependent ops a→b), inner-order test (order-sensitive inverse list), frozen entry undo → redo → undo test, plus "Undo a multi-child add".
- Error handling / rollback / partial outputs — selected: a reducer failure during undo/redo must leave the stacks unchanged; malformed entries fail loud; evidence = atomicity and invalid-entry tests.
- Resource limits / large input / discovery — selected: history is capped at 200, oldest dropped; evidence = "Cap at 200" test.
- Schema; Config; File IO; Auth; Legacy compatibility; Release / packaging; Documentation — not selected: in-memory only, no persisted shape, no config, IO, auth, legacy consumers or dependencies.

## Risk packs — issue #7 (task 2.2)

- Public API / CLI / script entry — selected: `dispatch`, `beginGroup`/`endGroup`/`cancelGroup`, `GroupCancelledError` and the new error codes are what #12/#35 build `runGrouped` and the creation group on; evidence = names fixed in design "Fixture — issue #7", typecheck, knip.
- Concurrency / shared state / ordering — selected: group revert order and LIFO undo of interacting multi-op groups decide whether a group restores exactly; evidence = "Multi-select delete is one step", group-drag and detach+attach group tests.
- Error handling / rollback / partial outputs — selected: rejected dispatch and cancelGroup must leave no partial group, no entry and an untouched redo stack; evidence = "Rejected op cancels the group", "Cancelled group leaves no entry", atomic cancel on a foreign map.
- Schema; Config; File IO; Auth; Resource limits (cap unchanged, covered by #6); Legacy compatibility; Release / packaging; Documentation — not selected: in-memory module, no persisted shape, config, IO, auth, legacy consumers or dependencies.

## Risk packs — issue #12 (task 5.1a)

- Public API / CLI / script entry — selected: `createEditorStore`, `EditorState` actions and `EditorStoreError` are the surface 5.2, 6.x, 7.x, 8.x, 9.x and #35 call; evidence = names fixed in design "Fixture — issue #12", typecheck, knip.
- Concurrency / shared state / ordering — selected: the store is the shared editor state; flags must mirror History in the same update and every load starts a fresh History; evidence = load-reset, flag-mirroring and runGrouped tests.
- Error handling / rollback / partial outputs — selected: rejected ops (ungrouped and grouped), a throwing runGrouped fn and a swallowed rejection must leave state consistent and surface the TreeOpError; evidence = the rejection, runGrouped and swallowed-rejection tests.
- Release / packaging / dependency compatibility — selected: adds `zustand` as a runtime dependency (MIT, 5.x, lockfile via pnpm); evidence = `pnpm install --frozen-lockfile` in CI, knip (used), import inventory (design "Fixture — issue #12"; grep for react / bare zustand imports in application/ = 0). `nanoid` deferred to #35.
- Schema; Config; File IO; Auth; Resource limits; Legacy compatibility; Documentation — not selected: no persisted shape change, config, IO, auth, size limits or legacy consumers; docs are the fixture itself.

## Risk packs — issue #35 (task 5.1b)

- Public API / CLI / script entry — selected: selection, editing, menu-target state and createNode / startEdit / commitTitle / cancelEdit / topmostSelected are what 6.x–9.x call; evidence = names fixed in design "Fixture — issue #35", typecheck, knip.
- Concurrency / shared state / ordering — selected: selection must be pruned in the same update as every map change and topmostSelected must follow tree order; evidence = pruning tests, topmostSelected tests, frozen-snapshot test.
- Error handling / rollback / partial outputs — selected: an abandoned or rejected creation must leave map, flags, selection and editing exactly as before createNode; evidence = abandoned-node, collapsed-parent cancel and rejection tests (from a canUndo+canRedo state).
- Release / packaging / dependency compatibility — selected: adds `nanoid` (MIT, 5.x) via pnpm; evidence = install --frozen-lockfile, knip (used), import inventory.
- Schema; Config; File IO; Auth; Resource limits; Legacy compatibility; Documentation — not selected: no persisted shape change, config, IO, auth, size limits or legacy consumers; docs are the fixture itself.

## Risk packs — issue #10 (task 4.1)

- Public API / CLI / script entry — selected: the MapRepository port, the two errors and describeMapRepositoryContract are what 4.2, 5.2, 6.x and 10.x consume; evidence = names fixed in design "Fixture — issue #10", type assertions, typecheck, knip.
- Schema / columns / units / field names — selected: MapSummary is exactly { id, title, updatedAt } and the error fields are { found, supported }; evidence = shape case (Object.keys) and error tests.
- Concurrency / shared state / ordering — selected: list order (updatedAt desc, id asc) and no aliasing between caller objects and stored state; evidence = ordering/tie case, isolation case, bite checks (i), (ii), (iv), (v).
- Error handling / rollback / partial outputs — selected: the errors adapters throw are declared here; delete of an unknown id is a no-op; evidence = error tests, unknown-id cases; the port's error contract (which method rejects with which error) is a doc comment checked by review only in 4.1, since the in-memory adapter produces neither error — 4.2 tests the open failure, newer-version get and list over a newer-version record.
- Config; File IO; Auth; Resource limits; Legacy compatibility; Release / dependency; Documentation — not selected: no config, browser IO (4.2), auth, size limits, legacy consumers or new dependency; CONTEXT.md already lists the port in the map row.

## Risk packs — issue #11 (task 4.2)

- Public API / CLI / script entry — selected: openIndexedDbMapRepository is what the 6.2 provider awaits; evidence = contract run, open-failure cases, typecheck, knip.
- Schema / columns / units / field names — selected: the stored envelope { schemaVersion: 1, map } under key map.id is the persisted format M2 reads; evidence = envelope case, reopen round-trip.
- File IO / path safety / overwrite — selected: put overwrites by key and writes must commit before resolving; evidence = contract replace case, envelope case; review: put/delete await the request and tx.done together (not observable under fake-indexeddb).
- Error handling / rollback / partial outputs — selected: open failure, newer version, unreadable record and put failure each map to the port's error contract, and list tolerates bad records; evidence = open-failure (a)(b)(c), future-version, unreadable-get, put-failure, list-tolerance cases; bite checks (ii)(ii-b)(iii).
- Release / packaging / dependency compatibility — selected: adds idb (ISC) and dev fake-indexeddb (Apache-2.0); evidence = install --frozen-lockfile, knip, licence check.
- Legacy compatibility / examples — selected: the 4.1 contract suite and port must stay unchanged; evidence = contract run unchanged, git diff shows no change under tests/support or domain/.
- Config; Auth; Concurrency; Resource limits; Documentation — not selected: no config, auth, multi-writer coordination (single tab, no upgrades in M1), size limits, or doc surface beyond the fixture.

## Risk packs — issue #8 (task 3.1)

- Public API / CLI / script entry — selected: layoutForest, estimateNodeSize and the coordinate convention are what 3.2, 6.1 and 8.x read; evidence = names, the returned sizes and the convention fixed in design "Fixture — issue #8", typecheck, knip, root-at-origin and sizes cases.
- Release / packaging / dependency compatibility — selected: adds d3-hierarchy (ISC, resolved 3.1.2) and dev @types/d3-hierarchy (MIT); evidence = install --frozen-lockfile, lockfile resolves d3-hierarchy 3.1.2, knip (d3-hierarchy used), typecheck (@types used), licence review.
- Schema; Config; File IO; Auth; Concurrency; Resource limits; Error handling; Legacy compatibility; Documentation — not selected: pure in-memory function with no persisted shape, config, IO, auth, shared state, size limits (500 nodes is 8.3's profiling), error paths (inputs are typed; invalid sizes fall back), legacy consumers or doc surface.

## Risk packs — issue #9 (task 3.2)

- Public API / CLI / script entry — selected: floating placement under the #8 convention and `contentBounds` / `ContentBounds` are what 6.1, 6.2 fit-to-content and 8.x read; evidence = names fixed in design "Fixture — issue #9", typecheck, knip, anchoring and bounds cases.
- Legacy compatibility / examples — selected: every #8 behaviour of the primary tree (convention, sizes, collapse, order, purity) must hold unchanged; evidence = the #8 test cases pass with no assertion weakened (only the "floating roots get no positions" case is replaced and the deep-frozen case's position count is updated from 4 to the six sampleMap ids, because 3.2 is exactly that change), git diff shows no other deleted or weakened #8 assertion.
- Schema; Config; File IO; Auth; Concurrency; Resource limits; Error handling; Release / packaging; Documentation — not selected: no persisted shape, config, IO, auth, shared state, size limits, dependency change or doc surface; the one error path (floating root with an absent or non-finite position) is a corrupt-map guard covered by a unit case.

## Risk packs — issue #13 (task 5.2)

- Public API / CLI / script entry — selected: 6.2 and 6.3 read `createEditorStore({ repository })`, `flush()`, `storageUnavailable` and the "保存失败" notice. Evidence: the names fixed in design "Fixture — issue #13", typecheck, knip, and the flush cases.
- Concurrency / shared state / ordering — selected: the debounce timer, a write still in flight when more edits arrive, load while a save is pending, and saves while a History group is open. Evidence: the coalesce, restart, group, load-while-pending and in-flight cases, using fake timers and deferred stub promises.
- Error handling / rollback / partial outputs — selected: `StorageUnavailableError` versus any other rejection, the edit kept in state, a failed write left pending, no stacked notices, `flush()` never rejects. Evidence: the failure cases.
- Legacy compatibility / examples — selected: a store created without `repository` behaves exactly as before. Evidence: every existing editor-store test passes unchanged; git diff shows no deleted or weakened assertion.
- Schema; Config; File IO; Auth; Resource limits; Release / packaging; Documentation — not selected:
  - no persisted shape change (the 4.x adapters own the envelope);
  - no config, auth, dependency or doc surface;
  - IndexedDB itself is 4.2's job, and the `pagehide` listener is 6.2's.

## Risk packs — issue #14 (task 6.0)

- **Config / project setup** — selected. `vitest.config.ts` changes for every unit test and for Stryker's vitest runner. Evidence:
  - `vitest list` per project: the `node` project holds exactly the pre-existing .test.ts files and the `dom` project only .test.tsx files;
  - `pnpm test:unit` passes with the same count of pre-existing tests;
  - the coverage-probe evidence;
  - `pnpm mutation` exit 0 with the vitest runner.
- **Release / packaging / dependency compatibility** — selected. Adds dev dependencies `jsdom`, `@testing-library/react`, and its required peer `@testing-library/dom`. Evidence:
  - `pnpm install --frozen-lockfile`;
  - lockfile versions, each published ≥3 days before the PR (Renovate minimum release age);
  - MIT licences on the allowlist;
  - `pnpm dead-code`: knip reports none of them unused;
  - typecheck.
- **Legacy compatibility / examples** — selected. Existing node tests must keep running in node, unchanged. Evidence:
  - the node project file list;
  - the pre-existing test count is unchanged;
  - git diff shows no existing test file touched.
- **Documentation / migration notes** — selected. Later UI tasks need to know the tier. Evidence:
  - the TDD section of `docs/engineering/architecture-discipline.md` names the `.test.tsx` → jsdom convention, the shim file, cleanup, and that coverage applies;
  - `pnpm docs:check`.
- **Not selected:** Public API; Schema; File IO; Auth; Concurrency; Resource limits; Error handling. There is no production code, runtime surface, persisted shape or error path.

## Risk packs — issue #15 (task 6.1)

- **Public API / CLI / script entry** — selected. `MindMapCanvas({ map })`, the node data shape, the CSS class contract (`mind-node--color-<token>`) and the accessible names of the indicators and fit button are what 6.2, 7.x–9.x and the e2e walk read. Evidence: names fixed in design "Fixture — issue #15", typecheck, knip, component cases.
- **Release / packaging / dependency compatibility** — selected. Adds runtime `@xyflow/react` (MIT; peers react/react-dom ≥17, satisfied by 19.3). Evidence: `pnpm install --frozen-lockfile`, lockfile version, npm publish time ≥3 days, licence, knip.
- **Concurrency / shared state / ordering** — selected. Measurement callbacks arrive asynchronously and in batches, and feed back into layout. React Flow's internal state must never become the source of truth. Evidence:
  - the `mergeNodeSizes` identity cases;
  - the batched-measurement and unchanged-measurement cases;
  - rerender-from-props cases;
  - observer disconnect on unmount.
- **Resource limits / large input / discovery** — selected, scoped. One shared observer, not one per node; no re-layout when measurements are unchanged. Evidence: the identity case and the single-observer case. The 500-node frame budget stays with 8.3 (non-goal).
- **Not selected:**
  - Schema, File IO, Auth, Error handling, Legacy compatibility: read-only rendering of an already-validated map; no persisted shape, IO, auth, error path or existing consumer.
  - Config: the vitest config is unchanged, and the dom-shims addition is evidenced by its smoke case.
  - Documentation: two bullet edits to the existing component-tier section (route-component exemption; the act-environment rule for later component tests), evidenced by docs:check and review.

## Risk packs — issue #16 (task 6.2)

- Public API / CLI / script entry — selected: `/maps/[id]`, its four visible states and their texts, data-testid="editor-title" and data-testid="map-editor-ready", useMapRepository / EditorSession / useEditorStore and the e2e seed helper are read by #17–#20 and #30/#31; evidence = names fixed in design "Fixture — issue #16", dom cases, e2e scenarios, knip.
- Concurrency / shared state / ordering — selected: one repository per session across navigations and StrictMode, the load race on unmount, flush synchronous with pagehide/unmount so later reads see the write; evidence = identity case, StrictMode stale-effect guard, synchronous-put cases.
- Error handling / rollback / partial outputs — selected: every get outcome maps to exactly one visible state (never not-found on error), corrupt records end in the error boundary; evidence = MapEditor classification cases, e2e corrupt-record scenario, bite (i).
- File IO / path safety / overwrite — selected (scoped): opening must never write browser storage; evidence = EditorSession zero-put case, e2e raw-record-unchanged assertions for v1 and v2 records.
- Release / packaging / dependency compatibility — selected: first `pnpm build` compiling the canvas stylesheet import and CSS Modules; evidence = pnpm build exit 0.
- Documentation / migration notes — selected: `/maps/[id]` is the first user-visible route, and the repository rules (the AGENTS file) say a changeset accompanies every user-visible change. Evidence: the `.changeset/*.md` entry and `pnpm changeset status`.
- Schema; Config; Auth; Resource limits; Legacy compatibility — not selected:
  - no persisted-shape change (seeds mirror the 4.2 envelope);
  - no config, auth or size surface;
  - `/` is unchanged.

## Risk packs — issue #21 (task 7.3)

- Public API / CLI / script entry — selected: canvas pointer/keyboard events and selected state are consumed by later editing issues. Evidence: named DOM and browser scenarios in the issue #21 design fixture.
- Concurrency / shared state / ordering — selected: React Flow callbacks and store selection must agree; keyboard focus and pan gestures must not duplicate or leak events. Evidence: exact selected sets, Shift-toggle ordering, real-store focus/IME gates and selection-preserving pan.
- Legacy compatibility / examples — selected: static map rendering, measurement, fit, zoom and #16 routes remain intact. Evidence: unchanged existing assertions except the deliberately obsolete read-only selection expectation; full e2e and owning component coverage.
- Documentation / migration notes — selected: changeset plus decision ownership record/consequence. Evidence: docs:check and decisions:check.
- Config; File IO; Schema; Auth; Resource limits; Error handling; Release / packaging — not selected: no config, stored shape, credentials, dependencies, IO operation, new recovery state or resource limit changes. Browser seed/readback exercises existing persistence only to prove selection writes nothing.

## Risk packs — issue #19 (task 7.1)

- Public API / CLI / script entry — selected: double-click/F2 and input commit/cancel are user entrypoints. Evidence: named DOM and browser rename scenarios, exact target and text.
- Concurrency / shared state / ordering — selected: Enter/Escape/blur ordering, editing identity, composition and focus. Evidence: terminal-event idempotence, multi-selection, IME and removed/hidden edit tests.
- Error handling / rollback / partial outputs — selected: cancelled drafts never mutate map/history and hidden input cannot retain a stuck edit. Evidence: Escape, hidden/deleted target, empty/unchanged cases against the real store.
- File IO / path safety / overwrite — selected: first UI edit persists through autosave without changing the envelope. Evidence: real IndexedDB 600 ms / under-100 ms reload scenario and unchanged peer/header assertions.
- Legacy compatibility / examples — selected: selection, native text behavior, map-prop rendering, fit/zoom/pan and measurement stay intact. Evidence: full browser regression, real-store field-key gates, measured-edge/no-blink assertions.
- Documentation / migration notes — selected: changeset and ownership consequence. Evidence: docs:check and decisions:check.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config, envelope, credentials, dependency or resource-limit change. Long-title acceptance is behavior, not a new cap.

## Risk packs — issue #30 (task 10.1)

- Public API / CLI / script entry — selected: / changes from placeholder to list/create/open. Evidence: Create from empty, Ordering, list-entry navigation and home smoke.
- File IO / path safety / overwrite — selected: new maps saved before navigation; unique IDs and factory shape. Evidence: deferred/rejected put DOM cases and real IndexedDB readback.
- Concurrency / shared state / ordering — selected: list races and repeated creation share session repository. Evidence: stale result guard, pending-create single write, recency/tie order.
- Error handling / rollback / partial outputs — selected: read errors never empty; write failure never navigates and preserves usable library. Evidence: separate failures and explicit retry, no automatic retry.
- Legacy compatibility / examples — selected: shared provider, editor and app-ready contracts unchanged. Evidence: full existing browser scenarios plus home/stale-link smoke.
- Documentation / migration notes — selected: changeset and ownership consequence. Evidence: docs:check and decisions:check.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no configuration, schema, credentials, resource cap or dependency change.

## Risk packs — issue #17 (task 6.3)

- Public API / CLI / script entry — selected: session provider ready shape and editor warning/error surface. Evidence: migrated consumers, provider/state DOM tests and browser private-mode flow.
- Concurrency / shared state / ordering — selected: shared fallback promise, StrictMode and SPA identity, stale effects and notice replacement. Evidence: remount/single-instance tests, public create/back/reopen, no auto-dismiss timer.
- Error handling / rollback / partial outputs — selected: unavailable versus generic open/get/put failures. Evidence: classification matrix, no silent fallback or not-found-on-error, edit retained after failed put.
- File IO / path safety / overwrite — selected: failure surfaces must not rewrite records or swap storage mid-session. Evidence: raw-record unchanged after quota failure, no writes on failed get, fallback lost only on full reload.
- Legacy compatibility / examples — selected: normal IndexedDB paths and all editor/library behavior unchanged. Evidence: existing full e2e and owning unit tests.
- Documentation / migration notes — selected: changeset and decision consequence. Evidence: docs:check and decisions:check.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config/schema/credential/limit/dependency changes.

## Risk packs — issue #20 (task 7.2)

- Public API / CLI / script entry — selected: Tab/Enter creation and input focus. Evidence: named browser scenarios and real-store keyboard tests.
- Concurrency / shared state / ordering — selected: creation group spans draft focus/terminal events. Evidence: single group, repeat/modifier/focus gates, no duplicate terminal dispatch.
- Error handling / rollback / partial outputs — selected: blank/Escape/blur cancels complete creation and restores selection/collapse without touching prior history. Evidence: exact-map DOM cancellation and public discard.
- File IO / path safety / overwrite — selected: unnamed/provisional content must not persist. Evidence: open-group/cancel repository proof and real one-second Reload after edits.
- Legacy compatibility / examples — selected: inline rename, selection, pan and notices retained. Evidence: existing full browser suite and owning DOM coverage.
- Documentation / migration notes — selected: changeset, consequence and approved #23 scenario handoff. Evidence: docs:check/decisions:check; both issue comments record owner approval.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config, schema, credential, cap or dependency change.

## Risk packs — issue #23 (task 7.5)

- Public API / CLI / script entry — selected: undo/redo keyboard and toolbar. Evidence: original five named scenarios, real-store flags and both modifier mappings.
- Concurrency / shared state / ordering — selected: pointerdown→blur→click may change editing and history availability. Evidence: first click cancels unnamed creation without undoing prior rename; second click works; redo and cancelled-pointer boundaries.
- Error handling / rollback / partial outputs — selected: unfinished creation must close before any history action, never group-open or unrelated rollback. Evidence: exact-map cancellation/history assertions and zero browser exceptions.
- File IO / path safety / overwrite — selected: reload preserves the saved map but discards session history. Evidence: real IndexedDB public edit/reload/raw content and disabled buttons, no autosave change.
- Legacy compatibility / examples — selected: static canvas, creation/naming, selection and native text undo preserved. Evidence: owning DOM coverage and full existing e2e.
- Documentation / migration notes — selected: changeset and ownership consequence; transferred #20 scenarios completed here. Evidence: docs:check, decisions:check and named browser proof.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config, envelope, credential, cap or dependency changes.

## Risk packs — issue #32 (task 10.3)

- Public API / CLI / script entry — selected: home unavailable banner and public create/open. Evidence: real-provider DOM and Create with storage blocked.
- Concurrency / shared state / ordering — selected, unchanged ownership: reuse one session repository across SPA navigation. Evidence: no document requests, list/reopen retains renamed root and Tab-created child.
- Error handling / rollback / partial outputs — selected: unavailable storage stays visibly nondurable; generic errors remain errors. Evidence: real open-rejection DOM distinction and Reload with storage blocked.
- Legacy compatibility / examples — selected: normal library and #17 rename/quota failure remain intact. Evidence: retained assertions and full e2e.
- Documentation / migration notes — selected: user-visible banner changeset. Evidence: docs:check and review; mechanical wiring exempt from new decision.
- File IO; Schema; Config; Auth; Resource limits; Release / packaging — not selected: no new IO behavior, persisted shape, config, credentials, limits or dependencies; underlying fallback semantics already landed in #17.

## Risk packs — issue #22 (task 7.4)

- Public API / CLI / script entry — selected: reusable store deleteSelection and keyboard deletion. Evidence: real-store action cases, both keys/native gates and five named browser scenarios.
- Concurrency / shared state / ordering — selected: exclude protected root before normalisation; group IDs frozen before pruning; editing/group ownership. Evidence: nested/mixed-root/select-all exact maps and refusal/no-op boundaries.
- Error handling / rollback / partial outputs — selected: atomic grouped deletion, no primary-root rejection or accidental history consumption. Evidence: one-step exact undo/redo, prior history/future and existing group refusal.
- File IO / path safety / overwrite — selected, scoped: destructive changes must only autosave stable grouped maps. Evidence: real-store repository observation around grouped delete/undo; no persistence implementation change.
- Legacy compatibility / examples — selected: topmostSelected unchanged for future drag; selection, naming, undo, notice, fallback retained. Evidence: existing normalization assertions and full browser suite.
- Documentation / migration notes — selected: owner root-protection resolution reconciles D5, requirement prose and issue algorithm without changing scenario outcomes; changeset and decision0004 consequence. Evidence: explicit approval record, docs:check, decisions:check.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config, persisted shape, credential, cap or dependency changes.

## Risk packs — issue #24 (task 8.1)

- Public API / CLI / script entry — selected: pointer drag and pure drop helpers. Evidence: geometry/refusal unit cases and public drag scenarios.
- Concurrency / shared state / ordering — selected: transient controlled positions, final layout reset, map changes during gesture and single-node selection membership. Evidence: preview/refusal/stale-map/gate component cases and unchanged pan/selection browser regressions.
- Error handling / rollback / partial outputs — selected: primary/self/cycle refusal must dispatch nothing and snap back, not leave a partial move. Evidence: exact transforms/history flags and unchanged stored record after refusal.
- File IO / path safety / overwrite — selected, scoped: only final accepted TreeOp may persist; coordinates/order survive undo. Evidence: real IndexedDB readback of accepted/undone/refused drops; no persistence implementation changes.
- Legacy compatibility / examples — selected: static canvas, measured geometry, editing, selection, pan/zoom, deletion/undo retained. Evidence: paired coverage and full existing browser suite; multi-selection drag explicitly remains inert until #25.
- Documentation / migration notes — selected: changeset and decision0003 consequence; downstream #25/#26 handoff. Evidence: docs:check/decisions:check and review against exact coordinate contract.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config, shape, credential or dependency change; 500-node budget remains #26, not an invented cap here.

## Risk packs — issue #27 (task 9.1)

- Public API / CLI / script entry — selected: extensible menu registry and public context menu. Evidence: registration execution, root enablement and six actions through real store/UI.
- Concurrency / shared state / ordering — selected: target versus selected set, creation groups, menu lifetime and focus. Evidence: multi-selection target-only collapse/detach/rename, selected/unselected deletion, stale menu and keyboard/blur boundaries.
- Error handling / rollback / partial outputs — selected: disabled/stale/dismissed actions must be inert; creation/deletion reuse atomic paths. Evidence: unchanged maps/history for refusal, exact one-step undo, no partial creation persistence.
- File IO / path safety / overwrite — selected, scoped: accepted destructive/menu changes persist only through existing autosave. Evidence: real IndexedDB accepted/undone content and unchanged dismissed/disabled records; no repository changes.
- Legacy compatibility / examples — selected: keyboard/selection/drag, static canvas, title editing and public history remain intact. Evidence: owning DOM tests and full existing e2e.
- Documentation / migration notes — selected: changeset and menu ownership/registry consequence in the appropriate decision record. Evidence: docs:check, decisions:check and review; no new duplicate contract document.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config, persisted shape, credentials, limits or dependency changes; group drag/performance remain separate.

## Risk packs — issue #18 (task 6.4)

- Config / project setup — selected: critical-path route-coverage metadata. Evidence: exact smoke inventory/status alignment, unchanged thresholds and pnpm test:guardrails.
- Public API / CLI / script entry — selected, test registration only: executable smoke walks / and /maps/[id]. Evidence: HTTP success, route-specific ready markers and seeded editor contents in real browser.
- Legacy compatibility / examples — selected: existing home smoke and shared noise/screenshot protocol remain. Evidence: both smoke cases and full final-head e2e.
- Documentation / migration notes — selected: AGENTS key-route note mirrors constraints and smoke. Evidence: docs/decisions checks, full-depth review and explicit owner acceptance before merge; mechanical edit, no new decision/release note.
- File IO; Schema; Auth; Concurrency; Resource limits; Error handling; Release / packaging — not selected: reuse existing test seed IO/envelope, no production state/error paths/configuration limits or dependencies change.

## Risk packs — issue #25 (task 8.2)

- Public API / CLI / script entry — selected: generalized planner/drag controls and multi-selected gesture. Evidence: exact op lists, live editor group execution, four named browser scenarios.
- Concurrency / shared state / ordering — selected: normalized membership versus grabbed descendant, visual append order, one shared delta, native input ownership. Evidence: reversed order/ties, nested grab, mixed roots, pre-render stale selection/map, collision/recovery and unchanged native tests.
- Error handling / rollback / partial outputs — selected: whole-set primary/member/cycle refusal, missing geometry and atomic group. Evidence: no partial plan/history/write; exact all-preview reset and one-step full-map undo/redo; existing History rollback tests retained.
- File IO / path safety / overwrite — selected, scoped: stable final grouped map only; floating offsets/order survive save/undo. Evidence: real-store repository observation and exact real IndexedDB accepted/undone/refused group records.
- Legacy compatibility / examples — selected: single-node drag, editor keys/menu, static/editing/pan and generic normalizer contracts preserved. Evidence: migrated owning unit suites and full existing browser suite; obsolete multi-selection-inert assertion replaced by behavior.
- Documentation / migration notes — selected: changeset, decision0003 generalized consequence, corrected helper provenance and owner visual-order decision. Evidence: docs/decisions checks and issue handoff comment.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no config, persisted shape, credential, dependency or cap changes; actual500-node budget belongs to #26.

## Risk packs — issue #26 (task 8.3)

- Resource limits / large input / discovery — selected:500 nodes,3–7 branching, depth5 and two-second drag budget. Evidence: independent workload assertions, three native recordings and qualified complete-frame interval parser; no new runtime cap.
- Public API / CLI / script entry — selected, test fixture only: exported generator consumed by a real e2e seed. Evidence: seeded editor renders500 nodes and actual leaf drag is recorded locally; CI contains functional assertions only.
- Legacy compatibility / examples — selected: layout geometry, collapsed visibility, primary/floating anchors, single/group drag and cancellation preserved. Evidence: existing browser regressions; affected unit coverage if any production optimization is required.
- Concurrency / shared state / ordering — conditional: memoization must include measured sizes/gap and preserve root/pre-order output. Evidence if changed: measurement invalidation, unchanged-tree reuse and exact geometry/undo tests; no cache changes when baseline already meets budget.
- Documentation / migration notes — selected: PR carries raw trace references, parser/workload/build/environment identities, all run metrics and optimization disposition. Evidence: independent review against D11 and unchanged spec thresholds.
- Config; Schema; Auth; File IO; Error handling; Release / packaging — not selected: existing seed/production IO/error semantics reused; no configuration, persisted shape, credentials or dependencies change. Invalid profiling data is rejected by the evidence oracle, not repaired by product code.

## Risk packs — issue #28 (task 9.2)

- Public API / CLI / script entry — selected: submenu-capable registry and public color menu. Evidence: existing extension action plus real-store/DOM activation and three named browser scenarios.
- Concurrency / shared state / ordering — selected: target versus current selection, nested selection, submenu focus and stale session ownership. Evidence: mixed ancestor/child group, unselected target, native keyboard and stale-menu refusal.
- Error handling / rollback / partial outputs — selected: one existing color group, disabled/stale/dismissed actions inert. Evidence: exact undo/redo and unchanged map/history on dismissal; existing History cancellation tests retained.
- File IO / path safety / overwrite — selected, scoped: only stable accepted group results persist through existing autosave. Evidence: real IndexedDB colored/cleared/undone maps; no repository changes.
- Legacy compatibility / examples — selected: six actions, extension registry, node classes, selection/drag/editing and history remain. Evidence: owning unit coverage and full browser suite; fixed incidental item-count assertions removed.
- Documentation / migration notes — selected: changeset, menu contract and owning decision consequence. Evidence: docs/decisions checks and strict OpenSpec validation.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no configuration, persisted shape, credentials, dependency or runtime-cap changes. Theme is scoped node presentation; no global theme subsystem or new performance claim.

## Risk packs — issue #29 (task 9.3)

- Public API / CLI / script entry — selected: note panel and eighth registry action with a UI focus port. Evidence: public editor visibility/menu focus and both named browser scenarios.
- Concurrency / shared state / ordering — selected: draft identity, blur versus selection/menu/toolbar, live note refresh and text-focus ownership. Evidence: real-store stale/duplicate blur, target switches, refocus and native text-key scenarios.
- Error handling / rollback / partial outputs — selected: no stale-target dispatch or duplicate history; existing inverse protocol restores optional notes. Evidence: exact add/clear undo/redo, unchanged blur and removed/replaced-node refusal.
- File IO / path safety / overwrite — selected, scoped: only committed notes reach existing autosave; raw text and absence survive reload. Evidence: real IndexedDB readback before/after blur and existing debounce/reload, without repository changes.
- Legacy compatibility / examples — selected: seven actions/color submenu, title focus, selection/drag/viewport and note indicator remain. Evidence: affected unit coverage and full native browser regression; no geometry assertion weakening.
- Documentation / migration notes — selected: changeset, D6/D9 focus seam and existing decision consequence. Evidence: docs/decisions checks, strict validation and review.
- Config; Schema; Auth; Resource limits; Release / packaging — not selected: no configuration, persisted shape, credentials, new cap or dependency changes. Notes remain literal text, never an HTML/Markdown rendering path.

## Verification fixture — issue #33 (task 11.1)

- Begin with an empty browser database through the existing seed helper, then create the map from the library UI. All nodes and attributes in the accepted result must come from public interactions, not seeded target data or store injection.
- Use Tab to create two root children and a descendant; rename one branch through the inline editor. Give its descendant a literal multiline note and blur it. Capture generated IDs from the public DOM; author expected parent/order/text/note values independently.
- Native-drag the renamed branch under the other branch. Assert the complete intermediate forest and rendered parent-child edges before proceeding, so a skipped reparent cannot be hidden by the later detach.
- Native-drag that subtree onto empty canvas. Assert the primary/floating root identities, order and retained descendant note. Capture the committed floating position and its rendered flow-position witness before reload; this walk proves exact round-trip identity, while the existing drag scenarios own pointer-to-flow accuracy.
- Wait for actual persisted expected state through the existing raw IndexedDB reader, capture the pre-reload envelope and screenshot, and require Undo enabled. After reload, require a fresh raw IndexedDB read to deep-equal that complete envelope: schema version, map metadata, generated map/node IDs, full hierarchy and root/sibling order, text, multiline note and floating-root position. Use public Fit for the session-only viewport and independently assert restored UI tree/edges, floating flow position and note; Undo and Redo are disabled.
- Reuse browser helpers and native Playwright input rather than copying private drag-coordinate algorithms. Keep existing feature scenarios and assertions intact. A genuine product failure is routed to its owning feature issue; this test-only slice cannot patch production or relax the oracle.
- Evidence: screenshots for reparented, detached and reloaded states under `.run/ui-evidence/`, zero console warnings/errors/page errors, fresh production `pnpm e2e` and exact-head CI. No fabricated product red→green claim for verification-only work.

## Risk packs — issue #33 (task 11.1)

- Public API / CLI / script entry — selected, verification only: library/editor public walk and test discovery. Evidence: actual create/navigation/keyboard/menu/native drag path; no production hook.
- File IO / path safety / overwrite — selected, verification only: existing real IndexedDB autosave/readback/reload. Evidence: explicit expected forests plus unchanged final envelope and restored UI; no new persistence implementation.
- Concurrency / shared state / ordering — selected, verification only: creation groups, committed note, intermediate reparent, final detach and reload-cleared history. Evidence: stepwise expected state and enabled-before/disabled-after history; timing/rollback fault scenarios remain in their existing owning suites.
- Legacy compatibility / examples — selected: all existing e2e scenarios remain. Evidence: full `pnpm e2e`, unchanged production source and existing helpers.
- Documentation / migration notes — selected: task completion and PR Runtime evidence references. Evidence: strict OpenSpec validation and documentation gate; no new product decision or user-visible changeset for this test-only addition.
- Config; Schema; Auth; Resource limits; Error handling / rollback; Release / packaging — not selected: no changed configuration, shape, credentials, limits, failure policy or dependencies; existing feature fault tests retained. README/closure work remains task11.2.
