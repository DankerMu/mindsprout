# Tasks

Module boundaries follow `AGENTS.md ## Directory Map`; every task lands its own tests (TDD required, 90% per-file coverage) and the docs its work calls for. Dependencies are added by the task that first uses them (`knip` fails on an unused dependency). Verification tiers: **unit** = Vitest in `node` (domain/application) or jsdom component tests (`src/components`, tier added by task 6.0) — this is what the per-file coverage gate measures; **e2e** = the named Playwright scenario from the spec. Each UI task says which assertions are unit and which are e2e; every spec scenario with a user-visible THEN is named by exactly one task.

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

- [ ] 6.0 Component-test tier: add dev `jsdom` and `@testing-library/react`; `*.test.tsx` files opt in with a `// @vitest-environment jsdom` docblock; add `src/test/dom-shims.ts` (`ResizeObserver`, `matchMedia`, `DOMMatrix` no-ops for React Flow) to `vitest.config.ts` `setupFiles`; document the tier in `docs/engineering/architecture-discipline.md` TDD section; verify (unit) a smoke component test (`src/components/canvas/smoke.test.tsx` rendering a trivial component) reaches 90% on its file and `pnpm test:unit` stays green in node for existing tests.
- [ ] 6.1 Build `src/components/canvas` over a static `map` prop with `@xyflow/react`: nodes/edges from `layoutForest`, custom node (title, color token class, collapse indicator with descendant count, note indicator), `ResizeObserver` measurement fed back as `nodeSize` (design D4), pan/zoom clamped 25–200%, fit-to-content button using `contentBounds`; add `@xyflow/react`; verify (unit, jsdom) component tests cover the collapsed indicator count, the note indicator, the color token class, estimate-then-measured `nodeSize` feedback, zoom clamping and that a floating root renders at its position; the rendered scenarios are verified through the route in task 6.2.
- [ ] 6.2 Create `/maps/[id]`: the app-wide `MapRepository` provider in `src/app/providers/` (one instance per session, IndexedDB by default), page loads the map into the editor store, registers a `pagehide` listener calling `flush()`, shows the not-found state for unknown ids and "此导图由更新版本创建" on `UnsupportedSchemaVersionError`; verify (e2e) spec map-library "Stale link", spec map-persistence "Future version" (seeded `schemaVersion: 2` record), "Reload after edits", "Edits older than the save window survive reload", spec canvas-layout "Fit to content", "Zoom clamps", "Space-drag pans", and that a seeded map renders its primary root and a floating root at its position.
- [ ] 6.3 Storage fallback and notices: the provider falls back to one shared `InMemoryMapRepository` on `StorageUnavailableError` and exposes `storageUnavailable`; the editor renders the persistent banner "未保存到浏览器" and the "保存失败" toast from the store's notice state; verify (unit, jsdom) banner and toast components render from state; verify (e2e, IndexedDB blocked via `page.addInitScript`) spec map-persistence "Private mode" and "Write failure is visible" (a `put` forced to reject).
- [ ] 6.4 Register `/maps/[id]` in `e2e/smoke.spec.ts` (seeded map, `data-testid` ready marker), update `constraints.yaml` `verification.key_ui_paths` status and `AGENTS.md ## Verification Matrix` key-route note; verify `pnpm e2e` walks both routes with zero console errors and `pnpm test:guardrails` passes; the PR flags the `constraints.yaml` edit and the `AGENTS.md` generated-section edit for owner acceptance.

Suggested fixture level: 6.0 expanded - shared test configuration (`vitest.config.ts` setupFiles) used by every later UI task; 6.1–6.3 compact - rendering and wiring over already-tested modules, mutations stay in tasks 7–9; 6.4 expanded - touches `constraints.yaml` (Critical Path: gate integrity) and an `AGENTS.md` generated section.
Minimal mergeable slice: 6.0 - the component-test tier merges green on its smoke test alone; 6.1 is the first feature slice (a read-only canvas over a static map, verified by component tests), 6.2 wires the route and owns the rendered scenarios, 6.3 adds the failure surfaces, 6.4 is a one-file-plus-config follow-up.

## 7. Node editing interactions

- [ ] 7.1 Inline title editing of existing nodes: double-click / F2 opens the editor on the targeted node only, Enter commits one `update_node`, Esc discards, blur commits, any length accepted; verify (unit, jsdom) the title input commits on Enter/blur and discards on Esc; verify (e2e) spec canvas-editing "Commit a rename", "Escape discards", "Long title", "Rename with three nodes selected".
- [ ] 7.2 Node creation: Tab adds a child, Enter adds a sibling (a child on any root), both through the store's `createNode` creation group; the new node enters inline editing immediately, empty commit or Esc removes it; a collapsed parent is expanded inside the creation group so the editor can take focus; verify (e2e) spec canvas-editing "Tab adds a child", "Tab on a collapsed node", "Enter on the primary root", "Enter on a floating root", "Name a new node", "Empty new node is discarded".
- [ ] 7.3 Selection and navigation: click, Shift+click toggle, rubber-band on empty canvas, Cmd/Ctrl+A, Esc clear, arrow keys (← no-op on roots, → no-op on a collapsed node); every shortcut gated by the `isEditing` flag; verify (unit, jsdom) the keyboard handler maps keys to store actions, leaves the selection unchanged for → on a collapsed node, and is inert while a text field has focus; verify (e2e) "Rubber-band selection", "Arrow navigation", "Arrow right on a collapsed node", "Arrow left on a floating root".
- [ ] 7.4 Delete selection as one group: Delete/Backspace (outside an editor) runs `runGrouped('delete')` over `topmostSelected()` minus the primary root, with the notice "主根不能删除" when it was selected; the menu's 删除 (task 9.1) reuses the same store action; verify (unit) the store action normalises and skips the primary root; verify (e2e) spec canvas-editing "Delete two selected subtrees", "Primary root in selection", "Select all then Delete", "Delete a floating root from the canvas", "Delete inside the editor".
- [ ] 7.5 Undo/redo affordances: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, toolbar 撤销/重做 buttons bound to `canUndo`/`canRedo`, inert while editing; verify (unit, jsdom) buttons disable from state; verify (e2e) spec canvas-editing "Undo a Tab-created child with Cmd/Ctrl+Z", "Redo with Cmd/Ctrl+Shift+Z", "Buttons reflect availability", "Undo inside the editor" and spec map-undo-history "Reload clears history".

Suggested fixture level: compact - UI interactions over an already-tested store.
Minimal mergeable slice: 7.1 - inline editing of existing nodes is a complete, demonstrable feature; 7.2 depends on it for the editor, 7.3 and 7.5 are independent PRs, 7.4 depends on 7.3 for multi-selection.

## 8. Drag — reparent, detach, group drag

- [ ] 8.1 Drag a single node: on drop, hit-test laid-out rects → `move_node(newParentId)`; drop on empty canvas → `move_node(null, position)` for tree nodes or `set_root_position` for floating roots; cycle, primary-root or drop-on-self refusal snaps the node back with no dispatch; verify (unit) the hit-test and refusal predicate over laid-out rects; verify (e2e) spec canvas-editing "Reparent by drop", "Detach to canvas", "Refused cycle", "Primary root in the dragged set".
- [ ] 8.2 Group drag over `topmostSelected()` (helper from task 7.4) under one target or onto empty canvas with per-node offsets, refusal when the primary root is dragged or the target is a dragged node or its descendant, all inside `runGrouped('move')`; verify (unit) the drop planner produces the op list and refusals of design D5; verify (e2e) spec canvas-editing "Group drag", "Nested selection moves once", "Drop on a selected node is refused", "Group detach to canvas".
- [ ] 8.3 Performance evidence per design D11 and spec canvas-layout "Large maps stay responsive while dragging": add a 500-node fixture generator (`e2e/fixtures/large-map.ts`, reused by the e2e seed), profile a two-second leaf drag on a production build with the Chrome DevTools Performance panel, apply the D11 memoisation if the budget is missed; verify scenario "500-node drag profile": the PR's `## Runtime evidence` states median and p95 frame times against the ≤ 16.7 ms / ≤ 33 ms budget (review-only evidence; no CI harness).

Suggested fixture level: compact - interaction layer; the ops it emits are already covered by task 1.
Minimal mergeable slice: 8.1 - single-node drag is independently demonstrable; 8.2 depends on 7.4 and is a follow-up PR; 8.3 is evidence plus memoisation only.

## 9. Context menu, colors, notes, collapse UI

- [ ] 9.1 Context-menu registry (`MenuItem { id, label, shortcut?, isEnabled(ctx), run(ctx) }`, where `ctx` = target, selection and the layout `positions` map from `layoutForest`, design D6) in `application/menu/` and the menu component with the six ops-only items — 添加子节点, 添加兄弟节点, 重命名, 删除 (store action from 7.4), 折叠/展开 (`update_node { collapsed }` on the target only), 脱离为浮动节点 (one `move_node { newParentId: null, position: ctx.positions.get(target) }` on the target only, design D6) — with the root enablement rules of design D6; verify (unit) registry enablement for the primary root, a floating root and a child, that 折叠 acts on the target regardless of selection, and that 脱离为浮动节点, given a `positions` map in `ctx`, dispatches the detach op with the target's position from that map regardless of selection; verify (e2e) spec canvas-editing "Menu on a floating root", "Detach from the menu", "Collapse with three nodes selected" and spec canvas-layout "Collapse and expand".
- [ ] 9.2 Color tokens: theme CSS variables for six tokens in light/dark, 设置颜色 submenu with the six tokens plus 无颜色 (`color: null`), group apply through `runGrouped('color')`; verify (unit) the submenu dispatches token or `null` for every selected node; verify (e2e) spec canvas-editing "Set color from the menu", "Clear a color from the menu", "Group color".
- [ ] 9.3 Note side panel (plain textarea, commit on blur, `note: null` when emptied, indicator on canvas) and the 编辑备注 item, completing the eight-item menu; verify (unit, jsdom) the panel commits once on blur; verify (e2e) spec canvas-editing "Add a note" and "Menu on the primary root" (all eight items present, three disabled).

Suggested fixture level: compact - UI over existing ops.
Minimal mergeable slice: 9.1 - the registry and the six ops-only items work without colors or notes; 9.2 is an independent follow-up; 9.3 depends on 9.2 so that its eight-item scenario is verifiable.

## 10. Map library page

- [ ] 10.1 Replace the placeholder home page with the library over the shared repository provider: list ordered by `updatedAt` desc, empty state, 新建导图 calling `createMindMap` (title and primary root "新导图"), saving and navigating to the editor (keep `data-testid="app-ready"`); verify (unit, jsdom) the list renders summaries in order and the empty state; verify (e2e) spec map-library "Create from the empty state" and "Ordering".
- [ ] 10.2 Rename (application-layer title update stamping `updatedAt`, independent of the primary root text) and delete with confirmation; verify (e2e) spec map-library "Rename from the list", "Delete with confirmation".
- [ ] 10.3 Library under storage-unavailable: banner on `/`, session maps listed from the shared in-memory fallback, create → editor works, reload shows not-found plus banner; verify (e2e, IndexedDB blocked) spec map-library "Create with storage blocked" and "Reload with storage blocked".

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
