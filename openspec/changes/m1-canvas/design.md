# Design

## Context

See proposal.md — Why. Constraints that shape the approach:

- `AGENTS.md` / `CONTEXT.md`: DDD strict — `src/contexts/map/domain` is pure (no framework imports, enforced by `pnpm boundaries`; `zod` is the one permitted schema library, decision 0005 shipped by task 1.0); `application/` orchestrates through ports and never imports `infrastructure/`; `src/app` is the composition root and nothing imports from it. Zustand is permitted only for the editor store, which dispatches `TreeOp`s (decision 0003, consequence revised in this change: the store lives in `application/editor-store`).
- L4 gates: 90% per-file coverage, TDD pairing hook, 700-line files, complexity 10, Playwright e2e on key UI paths, no real-key AI calls (none here). `vitest.config.ts` runs in `environment: 'node'` with no DOM; task 6.0 adds the component-test tier before any `src/components` file lands.
- Stage 1 grill ledger (13 user decisions, 4 assumptions, 2 open items) is binding; every decision below cites its branch.
- Existing home page (`src/app/page.tsx`, `data-testid="app-ready"`) is the e2e anchor for `/`; `/maps/[id]` is registered as pending in `constraints.yaml`.

## Goals / Non-Goals

**Goals**

- A usable mind-map editor with no AI: build, edit, reorganise, collapse, undo, persist locally, reopen (PRD M1 acceptance).
- A `TreeOp` reducer stable enough that M3+ providers only emit ops; no UI rewrite when AI arrives.
- Forest model with a primary root (grill Q4/Q5) without losing the "one map has one topic" product semantics.

**Non-Goals**

- Layout direction switch (TB / radial) — LR only; the layout module takes a direction parameter but no UI exposes it (grill Q3).
- Equal multi-root maps without a primary root (grill Q5 alternative).
- Free hex colors or a color picker — six semantic tokens only (grill Q11); "no color" is the absence of a token, not a seventh token.
- Markdown rendering of notes — plain multi-line text (grill Q12).
- Persisting undo history across reloads (assumption 3).
- Deleting the primary root — it can be renamed and have its children cleared (assumption 1).
- Multi-node rename or collapse — editing and collapse stay single-node (ledger: "editing and collapse stay single-node").
- A CI performance harness — the 500-node budget (D11) is verified by manual profiling in M1.
- Export (M6), AI generation/Grow (M3/M4), cloud sync/accounts (M2), touch/mobile editing, collaborative editing.
- Replacing `replace_children`'s UI — the op exists for AI; M1 exposes no UI for it.

## Decisions

### D1. Forest with primary root (grill Q4, Q5; supersedes single-root invariant)

```ts
type NodeId = string; // nanoid, caller-generated
type ColorToken = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
interface MindNode {
  id: NodeId;
  text: string; // single line, unbounded
  note?: string; // multi-line plain text
  color?: ColorToken;
  collapsed?: boolean;
  position?: { x: number; y: number }; // floating roots only
  children: MindNode[];
}
interface MindMap {
  id: string;
  title: string;
  roots: MindNode[]; // roots[0] primary, roots[1..] floating
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

`roots[0]` is the primary root (never deleted or moved, laid out at the canvas origin); `roots[1..]` are floating subtrees. A floating root carries `position` (canvas coordinates, user-placed); non-root nodes never carry `position`. `createMindMap({ id, rootId, title, rootText })` in `domain/` is the only way to obtain a map with a primary root — no `TreeOp` can create one.

**Tree state vs map metadata.** `roots` is tree state and changes only through `applyOp` (decision 0003). `title`, `createdAt` and `updatedAt` are map metadata: the application layer sets `updatedAt` on every save and on rename, the reducer never reads or writes them, and metadata edits are not undo steps (`CONTEXT.md` Core Invariants are worded this way in this change).

**`ownerId` is not a client field.** `docs/TECH.md` §3 lists `owner_id` as an M2 server-side column that the `account` context attaches under RLS; the browser `MindMap` has no owner. M2 bumps `schemaVersion` to 2 when it adds it (Migration Plan).

Alternatives: keep single-root and model floating nodes as a special child kind (rejected — leaks a fake parent into layout and export); equal multi-root (rejected by user — every AI/export action would need a "which tree" prompt).

Consequences: decision record 0004 ships in this change; `CONTEXT.md` invariant "single-root aggregate" becomes "forest with one primary root"; `openspec/glossary.md` `MindMap` entry, `docs/TECH.md` §3 and `docs/engineering/architecture-discipline.md` (aggregate-root sentence) are revised in the same PR (grill Q6). The aggregate root for consistency purposes is the `MindMap`; a single op touches one `MindMap`.

### D2. TreeOp protocol v1 (extends TECH §4)

```ts
// Recursive creation payload: a whole subtree, never a position (strict schema — unknown keys rejected).
type NewNode = {
  id: NodeId;
  text: string;
  note?: string;
  color?: ColorToken;
  collapsed?: boolean;
  children?: NewNode[];
};
```

| op                  | payload                                                                                                                 | notes                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_children`      | `parentId`, `children: NewNode[]`, `index?`                                                                             | inserts whole subtrees at `index` (default: append); ids are generated by the caller (`nanoid`) so the op is replayable                                                                                                                                                                     |
| `add_root`          | `node: NewNode`, `position`, `index?`                                                                                   | creates a floating root at roots index `index` (≥ 1, default: append); never creates a primary root                                                                                                                                                                                         |
| `update_node`       | `id`, `text?`, `note?: string \| null`, `color?: ColorToken \| null`, `collapsed?`                                      | partial update: an absent field is untouched, `null` clears `note`/`color`; `position` is not updatable here                                                                                                                                                                                |
| `delete_node`       | `id`                                                                                                                    | rejected for `roots[0]`; deletes the subtree (tree node or floating root)                                                                                                                                                                                                                   |
| `move_node`         | `{ id, newParentId: NodeId, index? }` \| `{ id, newParentId: null, position, index? }` (discriminated on `newParentId`) | non-null: reparent (attaches a floating root and drops its position); `null`: detach a tree node into a floating root at `position` (roots `index` ≥ 1, default: append); rejected for `roots[0]`; `index` is the node's final index in the destination list counted without the moved node |
| `set_root_position` | `id`, `position`                                                                                                        | floating roots only                                                                                                                                                                                                                                                                         |
| `replace_children`  | `parentId`, `children: NewNode[]`                                                                                       | swaps the whole child list; retained for AI (M3+); no M1 UI                                                                                                                                                                                                                                 |

`applyOp(map, op): { map, inverse: TreeOp[] }` is a pure function in `domain/`. `inverse` is the ordered list of ops that restores the input map exactly (most ops invert to one op; `add_children` with n children inverts to n `delete_node`s in reverse order). It throws a typed `TreeOpError` with a `code` instead of silently no-op-ing (AGENTS.md: misconfiguration fails loud):

| rejection                                                                                                                                                                                                                                                                                                                                                               | `TreeOpError.code`                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| payload fails the Zod schema: missing field, unknown key (e.g. `position` on a `NewNode`), `move_node` with `null` and no `position`, `move_node` with a non-null parent and a `position`                                                                                                                                                                               | `invalid-op` (wraps the `ZodError` issues; no tree traversal happens) |
| `id`, `parentId` or `newParentId` not present in the map                                                                                                                                                                                                                                                                                                                | `unknown-node`                                                        |
| `delete_node`, `move_node` or `set_root_position` targeting `roots[0]`                                                                                                                                                                                                                                                                                                  | `primary-root-protected`                                              |
| `move_node` whose new parent is the moved node or one of its descendants                                                                                                                                                                                                                                                                                                | `cycle`                                                               |
| `add_children` / `add_root` / `replace_children` introducing an id already in the map (for `replace_children`: outside the replaced subtree) or duplicated inside the payload                                                                                                                                                                                           | `invalid-target`                                                      |
| `set_root_position` on a node that is not a floating root; `move_node` with `null` on a node that is already a floating root; `index` out of range (`add_root`/detach `index` 0 or > `roots.length`, child `index` > `children.length`; for `move_node` the destination list is counted without the moved node, so a same-parent move accepts 0..`children.length` − 1) | `invalid-target`                                                      |

Inverses: `add_children` → `delete_node` per inserted child (reverse order); `add_root` → `delete_node`; `update_node` → `update_node` with the previous values (`null` when `note`/`color` was absent, `false` when `collapsed` was absent); `delete_node` → `add_children` with the removed subtree as a `NewNode` (including `collapsed` and all descendants) at the original `index`, or `add_root` with the subtree, its `position` and its roots `index`; `move_node` → `move_node` back to the original parent and index, or `{ newParentId: null, position, index }` when the node was a floating root; `set_root_position` → `set_root_position` with the previous position; `replace_children` → `replace_children` with the previous children as `NewNode`s.

Zod schemas for every op live beside the types in `domain/` so M3 provider output validation reuses them (Important Development Note 2). Importing `zod` from `domain/` is currently rejected by `.dependency-cruiser.cjs` `domain-is-pure` (`dependencyTypesNot: ['core']` blocks every npm import); task 1.0 amends that rule to allow `zod` alone, mirrors the allowance in `constraints.yaml` `module_boundaries` and `AGENTS.md ## Directory Map`, and ships decision record 0005 ("zod is a schema language, not a framework; the TreeOp schema is a domain contract"). Re-exporting `zod` through `src/shared/` was rejected: it would satisfy the rule text while hiding the dependency the rule exists to make visible.

Alternative: immutable snapshot history (zundo) — rejected: snapshots of a 500-node map per keystroke-level op cost memory, and inverse ops make "one op = one undo step" and AI-session grouping trivial. `docs/TECH.md` §2 drops the zundo mention.

### D3. Undo history as an inverse-op stack with explicit groups (grill Q2, Q8)

`History { past: Entry[], future: Entry[] }`, `Entry = { ops: TreeOp[], inverses: TreeOp[][], label }` (`inverses[i]` is the inverse list of `ops[i]`). Undo applies `inverses[n-1] … inverses[0]`, each list in its own order; redo re-applies `ops` in order. `dispatch(op)` outside a group applies, pushes `{ ops: [op], inverses: [inverse] }` and clears `future`. History is capped at 200 entries (oldest dropped). `canUndo` / `canRedo` are derived flags the UI binds to (D10). History lives in the Zustand editor store, not in the persisted map.

**Groups.** `beginGroup(label)` opens a group; every `dispatch` until `endGroup()` is applied immediately but recorded into the open group; `endGroup()` pushes one entry holding all of them (and clears `future`). Rules, each with a scenario in spec map-undo-history:

- `beginGroup` while a group is open throws `group-open`; `endGroup`/`cancelGroup` with no open group throw `no-group`.
- A `dispatch` whose op is rejected by the reducer inside a group **cancels the group**: the inverses of the ops already applied in that group are applied in reverse, no entry is pushed, and the `TreeOpError` is rethrown. Because the reverted map is a value the caller must keep, `History.dispatch` delivers it on the error: it throws `GroupCancelledError` (a `HistoryError` with code `group-cancelled`, `restored` = the reverted map, `cause` = the `TreeOpError`); the editor store sets its map to `restored` and rethrows `cause`, so the `TreeOpError` is what reaches the store's caller. The atomicity rule lives in `History` (its owner), not in each caller; `History.groupOpen` lets `runGrouped` cancel only a group that is still open. Groups are atomic — "one AI session is one undo unit" (CONTEXT.md) only holds if a half-applied session can never be left behind. The M1 UI never relies on this path: it filters the primary root and normalises the selection (D5) before dispatching.
- `cancelGroup()` does the same revert on request and pushes nothing.
- `endGroup()` after zero applied ops pushes nothing.
- `undo()` / `redo()` while a group is open throw `group-open`. Multi-select groups (`runGrouped`) are synchronous, but the creation group (below) stays open for the whole inline edit, so the editor closes it (commit on blur / Esc) before any undo, and `canUndo`/`canRedo` stay the stack flags while a group is open; M3 decides whether streaming sessions auto-close.

Multi-select delete / group reparent / color use groups through one store helper `runGrouped(label, fn)` (begin, run, end; cancel on throw) (grill Q9); M3 AI sessions reuse the primitives.

**Node creation is a group.** Tab / Enter / 添加子节点 call `createNode(parentId, index?)`: `beginGroup('add node')`, dispatch `add_children` with an empty-text node, select it and open the inline editor. When the parent is collapsed, `createNode` first dispatches `update_node { id: parentId, collapsed: false }` inside the same group so the new child is rendered and its editor can take focus; that expand is part of the creation entry, so one undo removes the child and re-collapses the parent, and `cancelGroup()` re-collapses it too. Committing a non-empty title dispatches `update_node` and `endGroup()` — creating and naming a node is **one** undo step. Committing an empty title, or pressing Esc on a node created this way, calls `cancelGroup()`: the node is removed and no entry exists. Renaming an existing node is a single ungrouped `update_node` on commit; Esc discards without dispatching.

### D4. Layout: d3-hierarchy `tree()` per root, LR by axis swap (grill Q3)

`layoutForest(map, { direction: 'LR', nodeSize, gap })` → `{ positions, sizes, edges }` (positions are top-left corners; exact contract in "Fixture — issue #8 (task 3.1)"). Primary tree is laid out from origin; each floating subtree is laid out from its own `position`. Collapsed nodes contribute no descendants. Node dimensions are measured (`ResizeObserver` in the custom node component, task 6.1) and fed back as `nodeSize` per node; a first pass uses estimated width from text length so the first paint has no jump. The function is pure and lives in `application/layout/`, tested without React.

Alternative: ELK / dagre — rejected: heavier dependencies for a tree, and both struggle with per-root free positioning.

### D5. Canvas: React Flow as a controlled view, never the source of truth

`@xyflow/react` renders nodes/edges derived each render from `map + layout + selection`. React Flow's internal node state is overwritten from the store; drags are intercepted: `onNodeDragStop` runs a hit test against laid-out node rects — drop on a node → `move_node(newParentId)`, drop on empty canvas → `move_node(null, position)` (detach) or `set_root_position` when the dragged node is already a floating root. Custom node component renders title, color token, collapse indicator (descendant count; it is display only — in M1 collapse is toggled solely from the menu item 折叠/展开, D6, so task 6.1 ships no mutation), note indicator; inline editing swaps the title for an input.

**Selection normalisation.** `topmostSelected(selection)` drops every selected node that has a selected ancestor. Group delete and group drag operate on the normalised set, so Cmd/Ctrl+A → Delete dispatches one `delete_node` per root except the primary root, never one per node. Color applies to every selected node (nesting is harmless there). Delete skips the primary root and shows the notice "主根不能删除" when it was selected.

**Group drag.** The dragged set is the normalised selection; descendants of a dragged node move with it. The drop is refused (snap back, no history entry, no dispatch) when the primary root is in the set, or the target is a member of the set or a descendant of one. Dropping on a node moves each member under it as the last children, in canvas order, inside one group. Dropping on empty canvas detaches each tree member as a floating root at `dropPoint + (member.laidOutPosition − grabbedNode.laidOutPosition)` and repositions floating members by the same delta, inside one group.

Selection, editing state, context-menu state, pan/zoom live in the editor store's UI slice, never in the map.

### D6. Context menu as a registry (grill Q10)

`MenuItem { id, label, shortcut?, isEnabled(ctx), run(ctx) }` registered in `application/menu/`; `ctx` carries the right-clicked target, the selection, and the current layout — `positions` from `layoutForest` (D4) — so `run(ctx)` reads `ctx.positions.get(target)` for the target's laid-out canvas position without touching React Flow or the UI slice. M1 registers eight items: 添加子节点, 添加兄弟节点, 重命名, 删除, 折叠/展开, 设置颜色 (submenu: six tokens + 无颜色, which dispatches `color: null`), 编辑备注, 脱离为浮动节点. Enablement: 添加兄弟节点 and 脱离为浮动节点 are disabled on every root (primary or floating); 删除 is disabled on the primary root only. 删除 and 设置颜色 act on the whole selection when the target is selected; 重命名, 折叠/展开 and 编辑备注 act on the target node only, whatever the selection (ledger: editing and collapse stay single-node). 脱离为浮动节点 is likewise single-node: on a non-root target it dispatches one ungrouped `move_node { id: target, newParentId: null, position: ctx.positions.get(target) }` (the target's current laid-out canvas position) — the node keeps its place on the canvas and only its parent link is cut, the selection is not consulted, and one undo re-attaches it under its previous parent at its previous index (D2 inverse). M4 registers the four Grow actions without touching the menu component.

### D7. Persistence: IndexedDB via `idb`, repository port in domain (grill Q7)

`MapRepository { list(): Promise<MapSummary[]>; get(id): Promise<MindMap | undefined>; put(map): Promise<void>; delete(id): Promise<void> }` with `MapSummary = { id: string; title: string; updatedAt: string }`, plus the errors an adapter may throw — `StorageUnavailableError` (store cannot be opened) and `UnsupportedSchemaVersionError { found, supported }` — are all declared in `src/contexts/map/domain/` (task 4.1) so `application/` consumes them without importing `infrastructure/`. `IndexedDbMapRepository` in `src/contexts/map/infrastructure/persistence/` stores `{ schemaVersion: 1, map }` under key `id` in object store `maps`. `put` stores what it is given; the application stamps `updatedAt` before every `put` and on rename (D1).

The map context owns the port and the browser adapters; `CONTEXT.md`'s map row says so in this change (its "Forbidden logic" is server/RLS persistence, which the `account` context supplies in M2 by implementing the same port). The `account` row records that it implements `MapRepository` under RLS in M2.

Autosave: the editor store debounces `put` 500 ms after the last op and exposes `flush()`; the `/maps/[id]` composition root registers a `pagehide` listener that calls `flush()` as a best-effort attempt. IndexedDB does not guarantee that a transaction opened during unload commits, so the guarantee the spec states is bounded: an edit older than the 500 ms window is never lost; a reload inside the window may lose at most that last burst.

One `MapRepository` instance is resolved once per app session in the composition root (`src/app/providers/`) and shared by the library and the editor. When IndexedDB cannot be opened the provider falls back to one in-memory repository for the whole session and sets `storageUnavailable`; both pages show the persistent banner "未保存到浏览器", creating from the library still navigates to a working editor, and a full reload of such a URL shows the not-found state plus the banner — it never silently pretends to save. `put` failures surface as a toast. Tests use `fake-indexeddb`.

### D8. Routes (grill Q7)

`/` — map library (Server Component shell + client list): create (`createMindMap` with title "新导图" and primary root text "新导图"), open, rename, delete (confirm). `/maps/[id]` — editor; unknown id shows a not-found state with a link back; a record with a higher `schemaVersion` shows "此导图由更新版本创建" and modifies nothing. Both are client-rendered data paths; no API routes in M1.

### D9. Colors and text (grill Q11, Q12)

`ColorToken = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'`; the theme maps tokens to CSS variables (light/dark); clearing a color dispatches `update_node { color: null }`. Title is single-line, unbounded (the "≤ 40 字" in TECH §5.5 is an AI prompt constraint, not a model constraint), Enter commits; note is a plain `textarea` in a side panel, autosaved via `update_node` on blur; an emptied note dispatches `note: null`.

### D10. Keyboard and undo affordances (grill Q13)

Tab add child; Enter add sibling (on any root — primary or floating — add child instead, because a root has no sibling list; the menu's 添加兄弟节点 names the sibling op precisely and is disabled on every root, so the keyboard convenience and the menu agree on what exists); Delete/Backspace delete selection (normalised, primary root skipped); F2 or double-click edit the targeted node only; Esc cancel edit / clear selection; Cmd/Ctrl+Z undo; Cmd/Ctrl+Shift+Z redo; arrow keys move a single selection (← parent, no-op on any root; → first child, a no-op on a collapsed node because its children are not rendered and a selection must stay visible; ↑↓ previous/next sibling); Tab / Enter / 添加子节点 on a collapsed parent expand it inside the creation group (D3) rather than creating a hidden child; Space+drag or middle-button pan; wheel zoom; Cmd/Ctrl+A select all visible nodes. Every shortcut, including undo/redo, is inert while a text field has focus. The editor toolbar shows 撤销 / 重做 buttons bound to `canUndo` / `canRedo`; a disabled button is how "undo unavailable" is observable (e.g. after a reload).

### D11. 500-node drag budget and how it is verified (resolves former Open Question 1)

Target: on a generated 500-node map (primary tree, branching 3–7, depth 5) dragging a leaf for two seconds keeps the median frame at ≤ 16.7 ms and p95 at ≤ 33 ms on the developer's machine, Chrome DevTools Performance panel, production build. Verification in M1 is a manual profiling note in the PR's `## Runtime evidence` (task 8.3; review-only per AGENTS.md Verification Matrix) — not a Playwright timing assertion, which would be flaky on CI runners. Memoisation plan when the budget is missed: layout memoised on `(map, collapsedSet)`; `set_root_position` recomputes only that root's subtree. An automated CI harness stays in `## Not yet specified`.

## Sketch seams under test

- `applyOp` in `src/contexts/map/domain` — the highest seam: every invariant (cycle, primary-root protection, inverse exactness, id uniqueness, position rules) is provable with pure unit tests; already the place M3 validation will hook in.
- `History` groups in `application/history` — atomicity (cancel on rejection), nesting rejection, empty groups.
- `layoutForest` in `application/layout` — pure, covers collapse and floating placement without rendering.
- `MapRepository` contract test run against `InMemoryMapRepository` and `IndexedDbMapRepository` (fake-indexeddb) — the only persisted-state boundary.
- Component tests (jsdom, task 6.0) for `src/components/canvas` rendering and menu enablement — what the 90% per-file gate measures for UI files.
- Playwright walk of `/` and `/maps/[id]` (create map → add child via Tab → rename → drag-reparent → detach → reload → tree persists) — the single end-to-end path that proves M1 acceptance; every spec scenario with a user-visible THEN is named by exactly one task's verify clause.

## Risks / Trade-offs

- [500-node drag may drop frames with per-render layout recomputation] → budget and method in D11; memoise before adding machinery.
- [React Flow drag semantics fight the tree model] → nodes are `draggable` but positions are reset from layout after every drag; hit test is ours, not React Flow's connection logic.
- [IndexedDB unavailable or quota errors] → in-memory fallback + banner (D7); `put` failures surface as a toast, never swallowed.
- [Last edit lost on immediate reload] → bounded by the 500 ms window (D7); `pagehide` flush is best-effort and the spec says so.
- [Forest change ripples into docs] → all document revisions ship in this change's PR set (decision 0004 first).
- [Inline editing vs shortcuts conflict] → one `isEditing` flag in the UI slice gates every shortcut.
- [Allowing `zod` in domain weakens `domain-is-pure`] → the allowance is one package, recorded in decision 0005, mirrored in `constraints.yaml`, and `pnpm test:guardrails` still proves the rule rejects any other import.

## Migration Plan

- Greenfield: `schemaVersion: 1` is the first persisted shape (`{ schemaVersion, map }` with the D1 `MindMap`, no `ownerId`); a reader that meets a higher version refuses to load and reports it (`UnsupportedSchemaVersionError` → "此导图由更新版本创建").
- M2 cloud sync reads the same envelope and bumps `schemaVersion` to 2 when it adds server-side ownership; no browser-side migration is planned for M1.
- Rollback: feature is additive; removing the routes leaves IndexedDB data inert.

## Open Questions

1. Snap/attach affordance when a floating subtree is dragged near the primary tree — drop-on-node only (current design) vs proximity snapping; a UX refinement that leaves the ops unchanged.

## Not yet specified

- Automated performance harness in CI (distinct from D11's manual profiling): what runs in CI, on which machine class, and what budget fails the build.
- Touch and mobile interaction model for the canvas (PRD lists mobile editing as out of v1 but a read-only mobile view is unresolved).
- Snapping/alignment helpers for floating subtrees (grid, guides) — the problem space is visible but no requirement can be stated yet.

## Fixture — issue #2 (task 1.0)

```text
Change surface: .dependency-cruiser.cjs (domain-is-pure `to` filter AND its `comment` string), constraints.yaml module_boundaries.allowed_dependency_directions, AGENTS.md ## Directory Map, docs/engineering/architecture-discipline.md Layering table (domain row), decisions/implemented/architecture/0005-zod-in-domain.md
Must preserve: domain-is-pure still rejects every npm package except zod (react probe fails naming the rule as the only violation); every other dependency-cruiser rule unchanged; AGENTS.md stays within the 320-line budget; pnpm test-guardrails cases unchanged (no boundaries fixture slot exists — probes are temporary files deleted before commit, never kept)
Must add/change (exact text per file):
  - .dependency-cruiser.cjs: `to.pathNot` gains the two entries `'^node_modules/zod/'` and `'^node_modules/\.pnpm/[^/]+/node_modules/zod/'` (one optional-group pattern is rejected by dependency-cruiser's safe-regex check) (keeping dependencyTypesNot: ['core']); rule `comment` becomes "domain/ depends on nothing but itself, src/shared and zod (decision 0005)"
  - constraints.yaml module_boundaries.allowed_dependency_directions: new list entry "domain -> zod (schema language, decision 0005)"
  - AGENTS.md ## Directory Map, the `domain/` line: "imports only itself + src/shared + zod"
  - docs/engineering/architecture-discipline.md Layering table, Domain row "May depend on" cell: "itself, `src/shared`, `zod` (decision 0005)"
  - decisions/implemented/architecture/0005-zod-in-domain.md: kind architecture, status implemented, Alternatives considered incl. re-export via src/shared rejected
Governing invariant: a domain/ file may import zod (any subpath: zod, zod/v4, zod/mini) and nothing else outside domain/ and src/shared, under both pnpm layouts (hoisted node_modules/zod/ and node_modules/.pnpm/zod@*/node_modules/zod/)
Sibling surfaces: constraints.yaml module_boundaries (mirror, in scope); docs/engineering/architecture-discipline.md Layering table (mirror, in scope); .dependency-cruiser.cjs comment (mirror, in scope); scripts/test-guardrails.sh (no change — no boundaries slot; non-goal)
Seams under test: pnpm boundaries (dependency-cruiser over src/) — the single seam; pnpm decisions:check and pnpm docs:check cover the record and prose mirrors
Required evidence:
  - probe src/contexts/map/domain/zod-probe.ts (`import { z } from 'zod'; export const probe = z.string();`) → `pnpm boundaries` exit 0
  - probe src/contexts/map/domain/react-probe.ts (`import 'react';`) → `pnpm boundaries` exit non-zero, output contains "domain-is-pure", and the only reported violation is react-probe.ts
  - regex evidence: a node one-liner shows the new `pathNot` entries (either matching) cover `node_modules/.pnpm/zod@4.6.7/node_modules/zod/index.js`, `node_modules/zod/index.js`, `node_modules/zod/v4/index.js` and does NOT match `node_modules/.pnpm/zod-x@1/node_modules/zod-x/index.js` nor `node_modules/zodiac/index.js`
  - both probes deleted (git status shows no src/contexts/map/domain/*-probe.ts); pnpm decisions:check exit 0; pnpm docs:check exit 0; pnpm test:guardrails exit 0; pnpm fmt:check exit 0
Non-goals: any MindMap/TreeOp code (issue #3); application/ rules; keeping probes as a guardrail case (no slot in scripts/test-guardrails.sh)
Review focus: regex matches zod only (evidence above); both pnpm layouts and subpaths covered; each mirror carries its specified text; decision record frontmatter valid; AGENTS.md line budget
```

## Fixture — issue #3 (task 1.1)

```text
Change surface: new files under src/contexts/map/domain/ — types (MindMap, MindNode, ColorToken, NewNode, NodeId, Position), tree-op schemas + TreeOp union + parseTreeOp, TreeOpError, createMindMap — each with its paired *.test.ts; nothing outside domain/
Amendment (Phase 1 blocker, orchestrator decision): paired *.test.ts files under domain/ must import vitest, which `domain-is-pure` flags. Test files are not domain code; they are exempted from the layer-purity rule, narrowly: `.dependency-cruiser.cjs` rule `domain-is-pure` gains `from.pathNot: ['\\.test\\.tsx?$']` (nothing else in the rule changes; the dead `no-framework-in-domain-or-application` rule is #37's business and stays untouched); `constraints.yaml` `module_boundaries` gains the line "test files (*.test.ts, *.test.tsx) are exempt from domain-is-pure only: they may import the test runner and sibling fixtures; every other boundary rule applies to them (decision 0006)" under `allowed_dependency_directions`; new record decisions/implemented/testing/0006-test-files-exempt-from-domain-is-pure.md (kind testing; moved and narrowed by the ci-gate-hardening change, issue #40; status implemented; alternatives: vitest globals (hides the import, weakens typecheck), moving tests out of domain/ (breaks the TDD pairing guard and AGENTS.md test placement), allowing vitest in domain for all files (would let production code import the test runner)); scripts/test-guardrails.sh "boundaries guard" gains an accept case: a `zod-probe.test.ts` in domain/ importing vitest and zod is accepted while the react probe is still rejected. Evidence: pnpm boundaries exit 0 with the real test files present; pnpm test:guardrails shows the new accept PASS; pnpm decisions:check; pnpm docs:check.
Must preserve: domain-is-pure (only zod imported; no node core modules, no src/shared), 90% per-file coverage, TDD pairing hook, 700-line / complexity-10 limits, knip zero unused exports (every exported name below is consumed by a test in this PR; the reducer in #4 consumes them next). Downstream expectations the schemas must honour: (a) `text` on NewNode and update_node accepts "" (D3 createNode dispatches add_children with an empty-text node — no min length); (b) the inverses #4/#5 emit must parse: update_node with note: null / color: null / collapsed: false, add_children carrying a full deleted subtree (note, color, collapsed, nested children) at an index, move_node { newParentId: null, position, index }
Must add/change (exports, exact names):
  - types.ts: NodeId (string), Position { x: number; y: number }, ColorToken ('red'|'orange'|'yellow'|'green'|'blue'|'purple'), MindNode { id, text, note?, color?, collapsed?, position?, children }, MindMap { id, title, roots, createdAt, updatedAt } (ownerId is NOT part of the domain shape in M1 — it joins in M2 with the account context; TECH §3 lists it for the DB row), NewNode { id, text, note?, color?, collapsed?, children? } recursive and never carrying position
  - tree-op.ts: one strict Zod object schema per op (unknown keys rejected): addChildrenOp { op:'add_children', parentId, children: NewNode[] (min 1), index? } — every `index?` on every op is the same schema: integer ≥ 0 (negatives and fractions → invalid-op); range checks (add_root/detach index 0 or > roots.length, child index > children.length) stay in the reducer as invalid-target per the D2 table; `position` is { x: number; y: number } with finite numbers, addRootOp { op:'add_root', node: NewNode, position, index? }, updateNodeOp { op:'update_node', id, text?, note?: string|null, color?: ColorToken|null, collapsed?: boolean } (at least one field), deleteNodeOp { op:'delete_node', id }, moveNodeOp = union of two strict objects: { op:'move_node', id, newParentId: string, index? } (position forbidden) | { op:'move_node', id, newParentId: null, position, index? }, setRootPositionOp { op:'set_root_position', id, position }, replaceChildrenOp { op:'replace_children', parentId, children: NewNode[] }; treeOpSchema = discriminated union on `op`; TreeOp = z.infer; parseTreeOp(input: unknown): TreeOp — throws TreeOpError('invalid-op') wrapping the ZodError issues; never touches a map
  - errors.ts: TreeOpErrorCode = 'invalid-op'|'unknown-node'|'primary-root-protected'|'cycle'|'invalid-target'; class TreeOpError extends Error { code; issues?: ZodIssue[] } (name 'TreeOpError')
  - create-mind-map.ts: createMindMap(input: { id: string; rootId: NodeId; title: string; rootText: string; now?: () => Date }) → MindMap with roots=[{ id: rootId, text: rootText, children: [] }], createdAt/updatedAt ISO strings from `now` (default Date), no position on roots[0]; `now` is injected so tests are deterministic (AGENTS universal rule: no clock in business logic)
Governing invariant: a value accepted by parseTreeOp is structurally valid for the reducer — no unknown keys, position present exactly when the op creates or moves a floating root (add_root, move_node with null parent, set_root_position) and absent otherwise — and a map from createMindMap has exactly one root without position
Sibling surfaces: docs/TECH.md §3/§4 type sketches (docs; the implementer does not edit them — the orchestrator reconciles ownerId/NewNode wording when archiving the change); spec map-tree-ops (oracle, unchanged); #4 applyOp (consumer; not in this PR)
Seams under test: parseTreeOp (the schema boundary) and createMindMap — unit tests only; no reducer, no React
Required evidence (vitest, src/contexts/map/domain/*.test.ts):
  - reject: spec "Malformed payload" (move_node without id → code invalid-op, issues non-empty), "Creation payload cannot carry a position" (add_children child with position → invalid-op), "Detach without a position" (move_node newParentId null, no position → invalid-op), "Reparent with a position" (move_node newParentId 'p1' with position → invalid-op); plus unknown key on any op → invalid-op; update_node with no fields → invalid-op; add_children with empty children → invalid-op; add_children with index -1 and with index 1.5 → invalid-op
  - accept: one minimal valid payload per op (seven) parses and round-trips structurally equal; plus an empty-text NewNode in add_children; a nested NewNode carrying note, color, collapsed and children (deleted-subtree inverse shape) at an index; update_node { note: null, color: null, collapsed: false }; move_node { newParentId: null, position, index }
  - factory: spec "New map has exactly one root" (roots.length 1, roots[0] has no position key, roots[0].children deep-equals [], roots[0].text = rootText, map.title = title, createdAt/updatedAt equal the injected now in ISO form)
  - gates: pnpm test:unit ≥90% every new file; pnpm boundaries exit 0; pnpm typecheck; pnpm lint; pnpm dead-code exit 0
Non-goals: applyOp and inverses (#4, #5); MapRepository (#10); nanoid (#12); ownerId (M2); editing TECH.md
Review focus: `.strict()` on every object schema (zod 4: z.strictObject or .strict()); recursive NewNode via z.lazy with explicit type annotation; nullable vs optional semantics on note/color; move_node union rejects both mismatches; parseTreeOp throws TreeOpError not ZodError; ISO timestamp determinism; file/complexity limits
```

## Fixture — issue #4 (task 1.2)

```text
Change surface: new src/contexts/map/domain/apply-op.ts exporting applyOp(map: MindMap, op: TreeOp): { map: MindMap; inverse: TreeOp[] }, with its paired apply-op.test.ts; helpers may split into further domain/ files only if each ships a paired *.test.ts; nothing outside domain/; no new dependency (the round-trip property uses a seeded PRNG generator written in the test, not fast-check)
Must preserve: issue #3 exports unchanged (types.ts, tree-op.ts, errors.ts, create-mind-map.ts); domain-is-pure (only zod + sibling domain files); 700-line / complexity-10 limits; knip zero unused exports (applyOp is consumed by its test; issue #6 History and #12 store consume it next); the input map object is never mutated (structural sharing of untouched subtrees is allowed)
Must add/change:
  - Validation order: (1) parseTreeOp(op) first — the reducer validates the payload itself (spec "Ops are validated before they are applied"), so a cast/malformed op throws invalid-op before traversal; (2) unknown-node (id / parentId missing); (3) primary-root-protected; (4) invalid-target (duplicate id against the map or inside the payload at any nesting; add_children index > parent.children.length; add_root index 0 or > roots.length). A rejection throws and returns nothing.
  - add_children: inserts the NewNode subtrees at index (default append) under any node (tree node, primary or floating root); inverse = one delete_node per inserted child, in reverse payload order
  - add_root: inserts a floating root carrying `position` at roots index (default append, ≥1); inverse = [delete_node(node.id)]
  - update_node: partial update; absent field untouched; note/color null removes the key; inverse = one update_node carrying exactly the fields the op carried, each with its previous value (null when note/color was absent, false when collapsed was absent); allowed on roots[0]
  - delete_node: removes the subtree; roots[0] → primary-root-protected; inverse for a tree node = [add_children { parentId, children: [toNewNode(node)], index: originalIndex }]; for a floating root = [add_root { node: toNewNode(root), position: root.position, index: rootsIndex }]; a floating root without position (corrupt map) → invalid-target
  - toNewNode(MindNode): copies id, text, and note/color/collapsed only when present, children always (recursive), never position. NewNode → MindNode: children ?? [], position never.
  - Canonical collapsed (round-trip enabler): the reducer never stores `collapsed: false` — update_node { collapsed: false } removes the key, and a NewNode carrying collapsed: false is stored without it. Without this, update { collapsed: true } on a node with no flag followed by its inverse { collapsed: false } leaves a key the input did not have.
  - move_node, set_root_position, replace_children (issue #5): throw TreeOpError('invalid-op', '<op> is not supported yet') with no `issues` — never a silent no-op; #5 replaces these branches and their tests
  - exactOptionalPropertyTypes: never write a key with value undefined (absent means absent)
Governing invariant: for every valid op of the four kinds and every canonical map M (built from createMindMap + applyOp), applyOp(M, op) leaves M deep-equal to its pre-call snapshot, keeps id/title/createdAt/updatedAt identical, and folding applyOp over the returned inverse list yields a map deep-equal to M
Sibling surfaces: tree-op.ts schemas (inverses the reducer emits must parse — round-trip applies them through applyOp, which re-parses); spec map-tree-ops (oracle); issue #5 (adds the remaining three ops to the same switch); issue #6 History and #12 editor store (consumers of { map, inverse }); persisted shape (task 4.x stores whatever applyOp returns — canonical collapsed applies there)
Seams under test: applyOp only — unit tests in apply-op.test.ts; no React, no store
Required evidence (vitest):
  - scenarios (exact names in tasks.md 1.2): "Floating root carries a position" (add_root text 灵感 at (120,40) → roots[1] has that text/position, roots[0] deep-equal to before); "Reducer leaves metadata untouched" (updatedAt 2026-11-05T10:00:00.000Z, each of the four ops); "Inverse of a multi-child add" (add X,Y under P → inverse toEqual [delete_node Y, delete_node X]; applied → P.children as before); "Add a subtree in one op" (collapsed:true + two grandchildren → stored in payload order); "Clear a color" (blue, color:null → no color key, inverse toEqual update_node { id, color: 'blue' }); "Inverse of setting a color on an uncoloured node" (inverse { color: null }, applied → no color key); "Unknown node id" (update_node on missing id → unknown-node; also add_children parentId missing and delete_node id missing); "Deleting the primary root" (primary-root-protected); "Renaming the primary root" (text 新标题, children unchanged); "Delete a node with children" (N is the middle of three siblings, index 1; 3 descendants gone; inverse add_children carries index 1 and restores N between its siblings); "Delete a collapsed node with grandchildren" (inverse is a single add_children whose NewNode has collapsed:true and nested grandchildren); "Delete a floating root" (roots index 2 of four roots, (300,200), two children → inverse toEqual add_root with subtree, position, index 2; applied → restored at index 2 with roots[3] still after it); "Duplicate id on add" (id exists anywhere, incl. inside a floating root → invalid-target); "Duplicate id inside one payload" (same id at different nesting → invalid-target)
  - extra rejections: add_children index > children.length → invalid-target (index == length accepted as append); add_root index 0 and index > roots.length → invalid-target; add_root node id duplicating an existing id → invalid-target; cast malformed op → invalid-op; move_node / set_root_position / replace_children each → invalid-op
  - canonical collapsed: update { collapsed: false } on a collapsed node → key removed, inverse { collapsed: true }; add_children NewNode collapsed:false → stored without the key; update { collapsed: true } on a flagless node → inverse { collapsed: false } and round-trip deep-equal
  - "Input map is untouched": every test map deep-frozen (recursive Object.freeze) and compared toEqual a structuredClone snapshot after every op, including rejected ones
  - lossless delete: delete_node on a node carrying note, color and collapsed whose child carries note and color → inverse NewNode carries all of them; applied → deep-equal to the original
  - middle-index insert: add_root at index 1 with two existing floating roots → lands at roots[1]; add_children at index 0 of a parent with two children → lands first
  - round-trip property: seeded PRNG (fixed seeds, ≥200 cases) builds canonical maps (createMindMap + random add_children/add_root with explicit random in-range indices; every generated node draws random note / color / collapsed:true presence) and draws a valid op of each of the four kinds against them (update_node with random field subsets incl. null clears; delete_node targets drawn from all non-primary nodes, so non-last siblings, nested nodes and floating roots are hit); assert apply → fold inverse → toEqual original; a failing case prints its seed
  - gates: pnpm test:unit ≥90% line/branch/function on apply-op.ts (and any helper file); pnpm boundaries, typecheck, lint, dead-code, duplicate-code, fmt:check exit 0
Carried from PR #39 review (P2): tree-op.test.ts "reports the offending path in the error message" asserts the path token itself (the old toContain('id') was satisfied by the "Invalid" prefix); the 0006 record placement/wording item is filed as its own issue (touches constraints.yaml, a Critical Path)
Non-goals: move_node / set_root_position / replace_children semantics and the all-ops round-trip (#5); History (#6); validating that an input map satisfies D1 invariants beyond the corrupt-floating-root guard (maps come from createMindMap + applyOp); performance tuning (500-node budget is D11 / #26)
Review focus: inverse exactness incl. index on delete inverses and reverse order on add_children; update_node inverse carries only the op's fields; canonical collapsed applied on both update and insert paths; no input mutation (no push/splice/delete on input arrays/objects); validation order (parse → unknown-node → primary-root → invalid-target); no undefined-valued keys; property test actually exercises all four ops and nested subtrees
```

## Fixture — issue #5 (task 1.3)

```text
Change surface: src/contexts/map/domain/apply-op.ts — the three `not supported yet` branches become real ops; production code may split into further domain/ modules (e.g. move-node.ts) only with a paired *.test.ts each and with the existing tree helpers (locate, editList, insertAt, toNewNode, toMindNode, assertFreshIds) kept as one implementation, never copied. Tests: apply-op.test.ts exceeds the 700-line lint limit once the new scenarios land, so tests split into apply-op.test.ts (the four #4 ops + validation + metadata), a sibling test file for the three new ops, and a sibling file for the seven-op round-trip property; helpers shared by those files (deepFreeze, node/mapOf builders, frozen apply/undo/rejection wrappers, nodeIn) move to tests/support/map-domain.ts — outside src/, so it is neither production domain code nor under the per-file coverage/pairing gates, and domain test files may import it (decision 0006 test-file exemption). No new dependency.
Must preserve: every #4 behaviour and test assertion (add_children, add_root, update_node, delete_node, canonical collapsed, validation order, exact inverses); applyOp signature; input never mutated; metadata untouched; no undefined-valued keys; position copied, never aliased between input op, output map and inverse ops
Must add/change:
  - Validation order (all three ops): parseTreeOp → unknown-node (move_node: id then newParentId; set_root_position: id; replace_children: parentId) → primary-root-protected (move_node / set_root_position on roots[0]) → cycle (move_node: newParentId is the node or a descendant) → invalid-target (rest of this list)
  - Index semantics for move_node: `index` is the node's FINAL index in the destination list, i.e. interpreted after the node is removed from its old place. Reparent/attach: 0..destination.children.length (counted without the moved node), default append. Detach: roots index 1..roots.length (roots unchanged by removing a tree node), default append. Out of range → invalid-target. Moving within the same parent is a reorder.
  - Reparent (tree node, non-null newParentId): remove from old parent, insert under new parent at index; inverse = [move_node { id, newParentId: oldParentId, index: oldIndex }]
  - Attach (floating root, non-null newParentId): remove from roots, drop `position`, insert under new parent at index; inverse = [move_node { id, newParentId: null, position: <copy of old position>, index: oldRootsIndex }]; a floating root without position (corrupt map) → invalid-target
  - Detach (tree node, newParentId null): remove from parent, insert into roots at index carrying a copy of `position`; inverse = [move_node { id, newParentId: oldParentId, index: oldIndex }]; detaching a floating root → invalid-target (callers use set_root_position); roots[0] → primary-root-protected
  - set_root_position: floating roots only — tree node → invalid-target, roots[0] → primary-root-protected; replaces position with a copy; inverse = [set_root_position { id, position: <copy of old> }]; floating root without position → invalid-target
  - replace_children: replaces parentId's whole child list (P may be any node incl. roots[0] or a floating root; empty list allowed both ways); payload ids may reuse ids found only among P's descendants; an id elsewhere in the map (incl. P itself) or repeated in the payload → invalid-target; payload stored through toMindNode (canonical collapsed, children ?? []); inverse = [replace_children { parentId, children: oldChildren.map(toNewNode) }]
  - Remove the three `not supported yet` branches and their #4 tests (the placeholder behaviour is replaced, not weakened)
Governing invariant: for every valid op of all seven kinds and every canonical map M (built from createMindMap + applyOp), applyOp(M, op) leaves M deep-equal to its pre-call snapshot, keeps id/title/createdAt/updatedAt identical, returns a canonical map satisfying D1 (roots[0] never moved or positioned; every floating root has a position; no tree node has one; ids unique; no cycles), and folding applyOp over the returned inverse yields a map deep-equal to M
Sibling surfaces: #4 ops in the same switch (must stay green, unchanged); tree-op.ts schemas (every emitted inverse must parse — the round-trip re-parses through applyOp); History #6/#7 (applies inverses LIFO across groups); editor store #12; drag #24/#25 (emit move_node / set_root_position with these index semantics); context menu #27 (detach); persistence 4.x (stores what applyOp returns)
Seams under test: applyOp only (unit); no React, no store
Required evidence (vitest):
  - scenarios (spec map-tree-ops): "Move a node under its own child" (A→under child B → cycle, also newParentId === id → cycle; map untouched); "Positioning the primary root" (primary-root-protected); "Detach a child into a floating root" (C with descendants, (300,200) → last root with that position, descendants intact, C gone from parent; inverse toStrictEqual move_node back with oldParent + oldIndex); "Attach a floating root under a node" (F at roots index 2 of four, (300,200) → last child of P, no position key, roots[3] shifted; inverse toStrictEqual { op: 'move_node', id: F, newParentId: null, position: {x:300,y:200}, index: 2 }); "Position a non-root node" (invalid-target); "Detach a node that is already floating" (invalid-target); "Reuse of replaced ids is accepted" ([a,b] → [a (new text), c]: children a,c; b gone; a's old descendants gone unless re-supplied); "External duplicate is rejected" (id from outside P's subtree → invalid-target; also P's own id → invalid-target; payload-internal duplicate → invalid-target); "Inverse restores the old children" ([a,b] with descendants → [c], inverse restores a,b with descendants deep-equal)
  - extra (each with the exact inverse asserted by toStrictEqual): reparent across parents with explicit middle index; reorder within the same parent (index semantics: moving first child of three to index 2 makes it last, index 3 → invalid-target; inverse { newParentId: P, index: 0 }); moving the primary root (reparent and detach) → primary-root-protected; detach with index 0 and index > roots.length → invalid-target; reparent index > destination length (counted without the node) → invalid-target; attach of a floating root under a node inside its own subtree → cycle; unknown id / unknown newParentId / unknown set_root_position id / unknown replace parentId → unknown-node; set_root_position inverse toStrictEqual previous position; set_root_position on corrupt floating root without position → invalid-target; replace_children with [] and its inverse; replace_children payload collapsed:false stored without the flag; aliasing: mutating the input op's position after the call does not change the returned map or inverse
  - "Reducer leaves metadata untouched" extended to all seven ops
  - "Input map is untouched": every applied and rejected op runs on a deep-frozen map compared toStrictEqual a structuredClone snapshot (shared helper)
  - round-trip property "Applying then applying the inverse restores the map": seeded PRNG (fixed seeds, ≥200 per op kind) over all seven kinds; after every apply (op and each inverse step) assert D1 on the result — roots[0] has no position, every floating root has a finite position, no tree node has one, ids unique; move_node draws reparent (cross-parent and same-parent reorder), attach and detach with explicit in-range final indices; set_root_position random finite positions; replace_children targets drawn from roots[0], floating roots and nested nodes, mixing ids reused from P's descendants (any depth, re-nested) with fresh ids and sometimes []; set_root_position targets drawn across all floating roots; a generator self-check asserts each variant is hit (incl. replace on roots[0], on a floating root and on a nested node); failure prints seed and kind
  - gates: pnpm test:unit ≥90% line/branch/function on every src file touched; boundaries, typecheck, lint (incl. max-lines 700 on every test file), dead-code, duplicate-code, fmt:check exit 0
Non-goals: History (#6/#7); UI, drag hit-testing, layout; validating non-canonical persisted maps (noted on #11); performance (#26)
Review focus: final-index semantics on reparent/attach/detach and their inverses (same-parent reorder is the trap); cycle check covers attach of a floating root; position dropped on attach and copied on detach/set_root_position; replace_children reuse boundary (P's descendants only, not P); #4 behaviour unchanged after the test split; no helper duplicated between test files or between production modules
```

## Fixture — issue #6 (task 2.1)

```text
Change surface: new src/contexts/map/application/history/history.ts (+ paired history.test.ts); imports only ../../domain (applyOp, TreeOp, MindMap); no store, no React, no persistence
Must preserve: applyOp contract (#4/#5) untouched; history is in-memory only (never serialised, no persistence import); application/ never imports infrastructure/
Must add (exports, exact names):
  - interface HistoryEntry { readonly ops: readonly TreeOp[]; readonly inverses: readonly (readonly TreeOp[])[]; readonly label: string } — plain data; inverses[i] is the inverse list applyOp returned for ops[i]; History stores entries as given and never mutates them
  - HISTORY_LIMIT = 200
  - class HistoryError extends Error { code: HistoryErrorCode } with HistoryErrorCode = 'invalid-entry' (issue #7 extends the union with 'group-open' | 'no-group')
  - class History: push(entry): void; undo(map: MindMap): MindMap; redo(map: MindMap): MindMap; get canUndo(): boolean; get canRedo(): boolean
Behaviour:
  - push: rejects an entry with zero ops or ops.length !== inverses.length → HistoryError('invalid-entry'), stacks unchanged; otherwise appends to past, clears future, drops the oldest past entry beyond HISTORY_LIMIT
  - undo: applies inverses[n-1] … inverses[0], each inner list in its own order, via applyOp, then moves the entry from past to future; redo: re-applies ops in order via applyOp, then moves the entry back to past (the stored entry is reused — its inverses stay valid because redo starts from a map deep-equal to the one the ops were first applied to)
  - atomic: the new map is computed before any stack changes; if applyOp throws (stale or foreign map), the TreeOpError propagates and past/future are unchanged
  - empty stack: undo with !canUndo / redo with !canRedo returns the same map object unchanged (Cmd+Z on an empty history is a normal user action, not an error)
  - canUndo = past non-empty; canRedo = future non-empty
Governing invariant: for any sequence of applyOp results pushed as entries, undo k times then redo k times returns maps deep-equal to the corresponding earlier states, and a failed undo/redo never changes the stacks
Sibling surfaces: #7 groups (adds begin/end/cancelGroup and group-open guards to this class); #12 editor store (holds one History, mirrors canUndo/canRedo into state); #23 toolbar buttons (bind to canUndo/canRedo)
Seams under test: History public API over real applyOp and maps from createMindMap (no mocked reducer)
Required evidence (vitest, history.test.ts):
  - spec map-undo-history "Undo a rename" (update_node A→B pushed; undo → text "A", canRedo true, canUndo false); "Redo after undo" (→ text "B", canRedo false, canUndo true); "Undo a multi-child add" (one add_children of two nodes; one undo → both gone, canRedo true); "Branching history" (undo then push a different op → canRedo false); "Cap at 200" (201 single-op pushes → exactly 200 undos change the map, the 201st returns the same object, and the map after 200 undos equals the state after the first op)
  - canUndo/canRedo asserted after every push/undo/redo in those tests
  - outer order: a multi-op entry whose second op depends on the first (a = add_children X under P, b = update_node X text), built from the real applyOp results and pushed directly: one undo restores the pre-a map (a forward outer order would throw unknown-node), one redo restores the post-b map
  - inner order: a hand-built entry whose single inverse list is order-sensitive (ops [add_children Y], inverses [[update_node Y …, delete_node Y]] — applying the inner list reversed throws unknown-node), proving each inner list runs in its own order
  - entries are never mutated: the pushed entries are deep-frozen and the same entry goes undo → redo → undo with identical results (catches in-place .reverse())
  - empty stacks: fresh History undo/redo return the identical map object (toBe), flags false
  - atomicity: undo against a map that lacks the entry's node → TreeOpError('unknown-node') propagates, canUndo/canRedo unchanged and a subsequent undo on the correct map still works; same for redo
  - push invalid entries (zero ops; ops/inverses length mismatch) → HistoryError code 'invalid-entry', flags unchanged
  - gates: pnpm test:unit ≥90% line/branch/function on history.ts; boundaries, typecheck, lint, dead-code, fmt:check exit 0
Non-goals: groups and group errors (#7); store wiring (#12); UI (#23); label semantics beyond storage
Review focus: inverse application order (outer reverse, inner forward); atomicity on reducer failure; cap drops oldest not newest; push clears future; no persistence or infrastructure import
```

## Fixture — issue #7 (task 2.2)

```text
Change surface: src/contexts/map/application/history/history.ts (+ history.test.ts; a sibling test file only if history.test.ts would pass 700 lines); imports only ../../domain
Must preserve: every #6 contract and test — push / undo / redo / canUndo / canRedo semantics, atomic undo/redo, empty-stack identity return, invalid-entry, HISTORY_LIMIT; entries stored as given
Must add (exports, exact names):
  - HistoryErrorCode = 'invalid-entry' | 'group-open' | 'no-group' | 'group-cancelled'
  - class GroupCancelledError extends HistoryError — code 'group-cancelled', readonly restored: MindMap, cause: TreeOpError (Error `cause` option)
  - History.dispatch(map: MindMap, op: TreeOp): MindMap — the only place History calls applyOp for new ops
  - History.beginGroup(label: string): void; History.endGroup(): void; History.cancelGroup(map: MindMap): MindMap
  - get groupOpen(): boolean — true between beginGroup and endGroup / cancelGroup / a rejected dispatch; lets the store's runGrouped (cancel on throw) skip cancelGroup when a rejected dispatch already closed the group
Behaviour:
  - dispatch outside a group: applyOp; on success push { ops: [op], inverses: [inverse], label: op.op } (ungrouped label = the op name) and return the new map; a TreeOpError propagates unchanged with stacks unchanged
  - dispatch inside a group: applyOp; on success record op + inverse into the open group (future is NOT cleared, nothing pushed) and return the new map; on a TreeOpError: revert = apply the group's recorded inverse lists last-first (each in its own order) to the `map` argument, close the group, push nothing, leave past/future unchanged, throw GroupCancelledError { restored: reverted map, cause: the TreeOpError }. If the revert itself throws (the caller passed a map that is not the group's current map), that TreeOpError propagates and the group stays open unchanged
  - beginGroup while open → HistoryError('group-open'), the open group (label, recorded ops) unaffected
  - endGroup: no open group → 'no-group'; zero recorded ops → close, push nothing, future unchanged; otherwise close and push one entry built from FRESH arrays ({ ops: [...], inverses: [...], label }) through push (so future clears and the cap applies)
  - cancelGroup(map): no open group → 'no-group'; otherwise compute the reverted map first, then close the group, push nothing, future unchanged, return the reverted map; if the revert throws, the TreeOpError propagates and the group stays open (atomic, retryable)
  - undo / redo / push while a group is open → HistoryError('group-open'), checked BEFORE the empty-stack early return, nothing changes
  - canUndo / canRedo while a group is open keep meaning "past / future non-empty" (group ops are not counted until endGroup)
Governing invariant: a group is all-or-nothing — after endGroup exactly one entry restores the pre-group map in one undo; after cancelGroup or a rejected dispatch the map is deep-equal to the pre-group map and past/future are exactly as before beginGroup
Sibling surfaces: #12 store (dispatch → History.dispatch; runGrouped = begin/run/end, cancelling only while groupOpen; on GroupCancelledError sets map = restored and rethrows cause, so its caller sees the TreeOpError); #35 createNode creation group (begin → add_children (+ update_node expand) → update_node title → end, or cancel; the group is open during inline editing, so commit/cancel closes it before any undo — 7.3/7.5 shortcuts are inert while editing); M3 AI sessions; spec map-undo-history group scenarios
Seams under test: History public API over real applyOp and maps from createMindMap / tests/support helpers (no mocked reducer)
Required evidence (vitest):
  - spec scenarios: "Multi-select delete is one step" (three deletes in one group across two parents incl. two siblings of the same parent → one undo restores all three at original parents and indices, deep-equal pre-group map; canUndo gained exactly one step); "Empty group leaves no entry" (begin+end → canUndo/canRedo unchanged, with a non-empty future preserved); "Nested beginGroup is rejected" (code 'group-open', then endGroup still pushes the original group's ops — one undo restores pre-group); "Rejected op cancels the group" (two ops applied, third rejected → GroupCancelledError, restored deep-equal pre-group map, cause is the TreeOpError with its exact code, no entry added, canUndo/canRedo unchanged, a later beginGroup works); "Cancelled group leaves no entry" (add_children + update_node then cancelGroup → returned map deep-equal pre-group, canRedo unchanged with a non-empty future); "Undo while a group is open" (undo and redo throw 'group-open' — including with empty past/future — and nothing changes); "Undo a detach" (dispatch move_node null → undo → C back under original parent at original index, no position key); "Undo deleting a floating root" (roots index 2, (300,200), with children → undo restores index 2, position, subtree)
  - group drag (from the #7 issue note): one group moving siblings A (index 0) and B (index 2) of the same parent to Q, then detach + attach in one group; each undone in one step deep-equal to the pre-group map, and redo restores the post-group map
  - groupOpen: false initially; true after beginGroup; false after endGroup, after cancelGroup, after a rejected dispatch (GroupCancelledError), and still true after a failed revert / failed cancel / nested beginGroup; canUndo/canRedo during an open group equal their pre-group values after dispatches
  - guards: endGroup / cancelGroup without a group → 'no-group'; push while open → 'group-open' (History exposes no entry getter, so the ungrouped label = op name is a stored value only; tests assert behaviour, not labels)
  - atomicity: cancelGroup with a foreign map → TreeOpError, group still open, a retry with the right map succeeds; rejected dispatch with a revert that cannot apply → TreeOpError (not GroupCancelledError), group still open
  - fresh arrays: after endGroup, further group activity (begin / dispatch / cancel) does not change the pushed entry (undo of the earlier entry still restores correctly)
  - ungrouped dispatch: success pushes one entry and clears future; rejection leaves stacks unchanged and rethrows the TreeOpError as-is (not wrapped)
  - carried from PR #43 review: reword the history.test.ts header comment so it no longer claims every map handed to History is deep-frozen (or freeze them)
  - gates: pnpm test:unit ≥90% line/branch/function on history.ts; boundaries, typecheck, lint, dead-code, fmt:check exit 0
Non-goals: runGrouped and createNode (#12/#35); store and UI; async/streaming groups (M3 decides auto-close)
Review focus: group-open check ordering vs empty-stack return; cancel/rejection never clears future; endGroup pushes fresh arrays; revert order (outer reverse, inner forward); GroupCancelledError carries restored + cause and ungrouped rejections are not wrapped; atomic cancel on a foreign map
```

## Fixture — issue #12 (task 5.1a)

```text
Change surface: new src/contexts/map/application/editor-store/editor-store.ts (+ paired editor-store.test.ts); package.json + pnpm-lock.yaml gain `zustand` (runtime dependency, MIT, current 5.x release older than Renovate's 3-day minimum age); imports only ../../domain, ../history and `zustand/vanilla`
Must preserve: applyOp / History contracts (#4–#7) untouched; decision 0003 (tree state changes only through History.dispatch → applyOp; metadata only through rename); application/ imports no React, Next or infrastructure — the React binding (`useStore` from `zustand`) belongs to src/components in 6.x
Scope deviations from the issue text (recorded; posted on #35 and in the PR): `nanoid` is NOT added here — nothing in 5.1a generates ids, knip fails on an unused dependency, and tasks.md says a dependency is added by the task that first uses it; #35 (createNode) adds it, overriding its own "no new dependencies" PR-boundary line. The acceptance clause "a rejected op leaves … selection … deep-equal" moves to #35, which introduces the selection/editing slice (selection and editing state after a rejection inside the creation group)
Must add (exports, exact names):
  - interface Viewport { x: number; y: number; zoom: number }; DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }
  - type EditorStoreErrorCode = 'no-map'; class EditorStoreError extends Error { code }
  - interface EditorState { map: MindMap | null; canUndo: boolean; canRedo: boolean; groupOpen: boolean; viewport: Viewport; notice: string | null; load(map); dispatch(op); undo(); redo(); beginGroup(label); endGroup(); cancelGroup(); runGrouped(label, fn: () => void); rename(title); setViewport(viewport); showNotice(message); clearNotice() }
  - createEditorStore(options?: { now?: () => Date }): StoreApi<EditorState> (zustand/vanilla createStore); `now` defaults to () => new Date() and is injected so tests are deterministic
Behaviour:
  - one History per load: load(map) creates a NEW History, sets map, canUndo/canRedo/groupOpen false, viewport DEFAULT_VIEWPORT, notice null (opening another map never inherits undo steps)
  - canUndo / canRedo / groupOpen are mirrors of the private History, refreshed in the same set() as every map change — never tracked independently
  - dispatch(op): map = history.dispatch(map, op). Ungrouped TreeOpError → rethrown as-is, state unchanged. GroupCancelledError → set map = error.restored and refreshed flags, then rethrow error.cause (the caller sees the TreeOpError, never GroupCancelledError)
  - undo() / redo(): map = history.undo/redo(map); HistoryError('group-open') propagates with state unchanged; empty stack leaves state unchanged
  - beginGroup / endGroup delegate and refresh flags; cancelGroup() reverts with the current map and sets the restored map; HistoryError (group-open / no-group) propagates with state unchanged
  - runGrouped(label, fn): beginGroup runs OUTSIDE the try (a group already open → HistoryError('group-open') propagates, fn never runs, the outer group stays open and untouched); then fn() → endGroup; if fn or endGroup throws: cancelGroup only while history.groupOpen is still true, then rethrow the original error (a rejected dispatch has already closed the group; cancelling again would throw no-group and mask the TreeOpError). fn is synchronous
  - rename(title): map = { ...map, title, updatedAt: now().toISOString() }; no History entry; canUndo/canRedo unchanged; later undo/redo keep the renamed title (reducer never touches metadata)
  - setViewport(v) stores v as given (clamping 25–200% is the canvas's job, 6.1); showNotice(message) / clearNotice() set / null `notice`
  - before load (map === null): dispatch / undo / redo / beginGroup / endGroup / cancelGroup / runGrouped / rename → EditorStoreError('no-map'), state unchanged; setViewport / showNotice / clearNotice work without a map
  - state is only ever replaced through set(); no action mutates the previous map or state object
Governing invariant: store.map always equals the result of applying, through History, exactly the ops History records (plus metadata from load/rename), and canUndo/canRedo/groupOpen always equal History's own values
Sibling surfaces: History (#6/#7); #35 (adds selection/editing slice, createNode/commitTitle/cancelEdit via beginGroup/dispatch/endGroup/cancelGroup, reads groupOpen, adds nanoid); #13 autosave (subscribes to map changes, stamps updatedAt before put, writes notice "保存失败"); 6.2 route (createEditorStore + load); 6.3 banner/toast (reads notice); 7.4 ("主根不能删除" via showNotice); 7.5 toolbar (canUndo/canRedo); 8.x drag and 9.x menu (dispatch / runGrouped)
Seams under test: createEditorStore public API in the node environment with real History + applyOp (no mocks, no DOM)
Required evidence (vitest, editor-store.test.ts):
  - load: map set; canUndo/canRedo/groupOpen false; viewport default; notice null; load of a second map after edits resets canUndo/canRedo false and undo no-ops on the new map (new History)
  - dispatch applies and records exactly one entry (canUndo true; one undo restores the pre-op map deep-equal; redo restores)
  - history intact (AC "history deep-equal", spec "Cancelled group leaves no entry … canRedo is unchanged"): each of the following starts from a state with canUndo AND canRedo true (dispatch a, dispatch b, undo) and, after its assertions, proves one redo and one undo yield maps deep-equal to the no-rejection path:
    - ungrouped rejection: the TreeOpError instance (exact code) reaches the caller; map, flags, viewport, notice deep-equal to before
    - runGrouped rejection (below) and explicit cancelGroup (below)
  - spec "Grouped ops undo together" via runGrouped: three ops → exactly one entry; one undo restores the pre-group map
  - spec "Rejected op cancels the group" via runGrouped: two ops then a rejected one → caller receives the TreeOpError (instanceof TreeOpError, not GroupCancelledError, exact code); map deep-equal pre-group; canUndo/canRedo unchanged; groupOpen false
  - runGrouped where fn throws a plain Error after two dispatches → group cancelled (map deep-equal pre-group, no entry), the same Error rethrown
  - swallowed rejection (from the #12 issue note): fn catches the rejection and dispatches again → runGrouped throws HistoryError('no-group'); afterwards map = pre-group map + the second op, canUndo true, one undo restores the pre-group map (state and History consistent)
  - explicit beginGroup / dispatch / endGroup and beginGroup / dispatch / cancelGroup through the store; groupOpen mirrored at each step; undo while open → HistoryError('group-open'), state unchanged
  - rename: title and updatedAt (= injected now in ISO) change, canUndo/canRedo unchanged; a following undo of an earlier op keeps the new title
  - viewport and notice: setViewport / showNotice / clearNotice round-trip through getState() with no React
  - no-map: dispatch, undo, redo, beginGroup, endGroup, cancelGroup, runGrouped, rename each throw EditorStoreError('no-map') before load with getState() deep-equal before/after; setViewport, showNotice, clearNotice succeed before load
  - runGrouped while a group is already open (the #35 creation group case): throws HistoryError('group-open'), fn is not called, groupOpen stays true, map unchanged, and the outer group can still endGroup normally
  - previous state objects are not mutated (snapshot of getState() before an action is deep-equal after it)
  - import inventory (pnpm boundaries cannot prove this — #37, and doNotFollow hides what a bare `zustand` import pulls in): the PR lists editor-store.ts imports; only `zustand/vanilla`, `../../domain/*` and `../history/history` are allowed, and `grep -rnE "from '(react|zustand)'" src/contexts/map/application/` returns 0 matches
  - gates: pnpm test:unit ≥90% on editor-store.ts; boundaries, typecheck, lint, dead-code (zustand used; no unused deps), duplicate-code, fmt:check exit 0; lockfile updated by pnpm (never hand-edited)
Non-goals: selection/editing slice, createNode, topmostSelected, nanoid (#35); autosave/flush/storage flags (#13); React components and hooks (6.x); keyboard (7.3); drag planning (8.x)
Review focus: GroupCancelledError unwrap and runGrouped's groupOpen gate; flags always mirrored from History in the same set(); new History on every load; no direct map writes besides history results and rename; zustand/vanilla only (no react import in application/); dependency version, licence and lockfile
```

## Fixture — issue #35 (task 5.1b)

```text
Change surface: src/contexts/map/application/editor-store/editor-store.ts (extended in place) + new pure helpers src/contexts/map/application/editor-store/selection.ts (visibleIds, topmost, prune — paired selection.test.ts); store tests may split into a sibling editor-store-*.test.ts file if editor-store.test.ts would pass 700 lines, with shared test helpers in tests/support/; package.json + pnpm-lock.yaml gain `nanoid` (runtime, MIT, current 5.x release older than Renovate's 3-day minimum age) via pnpm add — handed off from #12, overriding this issue's "no new dependencies" line; imports stay zustand/vanilla, nanoid, ../../domain, ../history
Must preserve: every #12 contract and test (load, dispatch unwrap, undo/redo, groups, runGrouped, rename, viewport, notice, no-map); flags mirrored from History in the same set() as every map change; application/ imports no React
Must add (exports / state, exact names):
  - createEditorStore(options?: { now?: () => Date; newId?: () => NodeId }) — newId defaults to nanoid() and is injected so tests are deterministic
  - EditorStoreErrorCode gains 'unknown-node' | 'hidden-node' | 'already-editing' | 'not-editing'
  - interface Editing { readonly id: NodeId; readonly created: boolean }
  - state: selectedIds: readonly NodeId[] (selection order = click order); primaryId: NodeId | null; editing: Editing | null; menuTargetId: NodeId | null
  - actions: select(id) (click: selection = [id], primary = id); toggleSelect(id) (Shift+click: add → primary = id; removing the primary → primary = last remaining id or null; removing a non-primary keeps primaryId); setSelection(ids) (rubber-band: replaces the selection with ids in the given order, duplicates dropped keeping the first occurrence, primary = last id or null for []); selectAll() (every visible node in tree pre-order across all roots; primary kept if still selected, else roots[0].id); clearSelection(); openMenu(id) / closeMenu(); topmostSelected(): NodeId[] (selected ids with no selected ancestor, tree pre-order); createNode(parentId, index?): NodeId; startEdit(id); commitTitle(text); cancelEdit()
  - selection.ts: visibleIds(map): NodeId[] (pre-order; a collapsed node is visible, its descendants are not); topmost(map, ids): NodeId[]; and a prune helper used by the store
Behaviour:
  - select / toggleSelect / setSelection / openMenu / startEdit with an id not in the map → EditorStoreError('unknown-node'); with an id that exists but is hidden under a collapsed ancestor → EditorStoreError('hidden-node'); state unchanged either way (the selection never holds a hidden node); every selection/editing/menu action before load → EditorStoreError('no-map') (clearSelection and closeMenu included for uniformity)
  - load resets selectedIds [], primaryId null, editing null, menuTargetId null
  - pruning: in the same set() as every map change (dispatch, undo, redo, cancelGroup, group rejection, load), selectedIds keeps only ids that exist and are visible (order kept), primaryId falls back to the last remaining selected id (or null) when pruned, menuTargetId and editing are cleared when their node no longer exists
  - createNode(parentId, index?): editing !== null → EditorStoreError('already-editing') before anything; snapshot { selectedIds, primaryId }; beginGroup('add node') (an open group → HistoryError('group-open') propagates, nothing changes); if the parent exists and is collapsed, dispatch update_node { id: parentId, collapsed: false }; dispatch add_children { parentId, children: [{ id: newId(), text: '' }], index? }; then selectedIds = [id], primaryId = id, editing = { id, created: true }; returns id. A rejected op (e.g. unknown parentId, index out of range) → the group is reverted by History, state (map, flags, selection, editing) deep-equal to before createNode, and the TreeOpError reaches the caller
  - startEdit(id): editing !== null → 'already-editing'; otherwise editing = { id, created: false } (no group, no dispatch, selection unchanged — F2 targets the primary selected node and double-click the node under the pointer; the caller chooses the id)
  - commitTitle(text): editing === null → 'not-editing'. Empty means text.trim() === ''. created: non-empty → dispatch update_node { id, text } (text stored as given) then endGroup, editing = null, selection stays on the node; empty → cancelGroup, editing = null, selection restored from the createNode snapshot. Not created (rename): non-empty and different from the current text → one ungrouped dispatch update_node { id, text }; empty or unchanged → no dispatch (decision: an existing node is never blanked by an empty commit; the spec defines empty commits only for new nodes); editing = null either way
  - cancelEdit(): editing === null → 'not-editing'; created → cancelGroup and restore the selection snapshot; rename → no dispatch; editing = null
  - creation group is owned by the edit: while editing?.created, the store's dispatch / beginGroup / endGroup / cancelGroup / runGrouped throw EditorStoreError('already-editing') with state unchanged (undo/redo already throw group-open), so no tree change other than the creation's own ops enters the group, the created node cannot disappear under the edit (pruning never clears a creation edit), and nothing outside commitTitle / cancelEdit / load can close the creation group (round-1 review of PR #48: an unguarded dispatch deleting the node orphaned the group, and a successful one was folded into the creation entry); the only op inside an open creation is commitTitle's update_node on an existing id, which cannot be rejected, so the store has no creation-rollback branch; commitTitle / cancelEdit therefore always find history.groupOpen true in the created path (this settles the #7 note on #35 — no second flag, no unreachable no-group branch)
  - undo/redo while a creation group is open still throw HistoryError('group-open') (unchanged #12 behaviour); the one-click blur-cancel + 撤销 double effect noted on this issue is UI wiring (7.2 / 7.5) — posted on #20 and #23 with its e2e (Tab → no input → click 撤销 → the previous edit survives)
Governing invariant: selection, primary, editing and menu target only ever reference nodes that exist (and, for the selection, are visible) in the current map; a creation is exactly one history entry when named and none when abandoned or rejected, and in the abandoned/rejected cases map, flags, selection and editing equal their pre-createNode values
Sibling surfaces: #12 store core (same module); History groups (#7); 6.1/6.2 canvas (render selection, editing input); 7.1 #19 inline rename (startEdit / commitTitle / cancelEdit with created: false); 7.2 #20 Tab/Enter (createNode, selection on new node, blur → commitTitle); 7.3 #21 selection keys (select / toggleSelect / selectAll / clearSelection, isEditing gate = editing !== null); 7.4 #22 delete (topmostSelected); 7.5 #23 undo buttons; 8.2 #25 group drag (topmostSelected); 9.1 #27 menu (openMenu / menuTargetId, createNode)
Seams under test: createEditorStore public API (node env, real History + applyOp, injected newId/now) and the pure selection.ts helpers
Required evidence (vitest):
  - spec canvas-editing "Selection" (state semantics): select replaces; toggleSelect adds/removes and moves primary (removing the primary → last remaining or null; after selectAll, removing a non-primary keeps primaryId); setSelection([a, b, a, c]) → [a, b, c] with primary c, setSelection([]) clears; selectAll selects exactly visibleIds (descendants of a collapsed node excluded, floating roots and their subtrees included) and keeps/sets primary; clearSelection empties and nulls primary
  - topmostSelected: after selectAll returns exactly the visible roots (primary + floating) in roots order; with a node and its grandchild selected returns only the node; tree pre-order regardless of click order
  - spec map-undo-history "Create and name is one step": createNode under N, commitTitle("想法") → one entry (canUndo gained one step), undo → node gone and map deep-equal pre-create, redo → node back with text "想法"
  - spec "Abandoned node leaves no entry": createNode then commitTitle("") and separately commitTitle("   ") and cancelEdit() → node gone, map deep-equal pre-create, canUndo/canRedo equal their pre-create values (start from a state with both true), selection and primary restored from the snapshot
  - collapsed parent (spec canvas-editing "Tab on a collapsed node"): createNode on collapsed N with two children → N expanded, new node is N's third child, editing set; commitTitle("x") then one undo → child gone and N collapsed again (map deep-equal pre-create); separately cancelEdit → N collapsed again, no entry
  - createNode selects the new node (selectedIds [id], primaryId id), editing { id, created: true }, returns the injected id; createNode with index places it there; commitTitle / cancelEdit clear editing
  - rejection: createNode with an unknown parentId and with an out-of-range index → TreeOpError (exact code) reaches the caller, map/flags/selectedIds/primaryId/editing/menuTargetId deep-equal to before, groupOpen false; ungrouped dispatch rejection leaves selection/editing/menu deep-equal (clause handed off from #12)
  - creation-group ownership: while a creation edit is open, dispatch (delete_node of the new node, of its parent, a replace_children on the parent, an update_node collapsing the parent, an unrelated colour update, and an op the reducer would reject) / beginGroup / endGroup / cancelGroup / runGrouped → 'already-editing' with state unchanged, and a following commitTitle("x") still records exactly one entry; during a rename edit (created: false) dispatch is still accepted and deleting the edited node prunes editing
  - hidden ids: select / toggleSelect / setSelection / openMenu / startEdit with a descendant of a collapsed node → 'hidden-node', state unchanged
  - guards: createNode / startEdit while editing → 'already-editing'; commitTitle / cancelEdit without editing → 'not-editing'; createNode while another group is open (begun via beginGroup) → HistoryError('group-open') with state unchanged; select / toggleSelect / openMenu / startEdit with unknown id → 'unknown-node'; every new action before load → 'no-map'
  - rename editing (created: false): startEdit(N) leaves selection unchanged; commitTitle("新想法") → exactly one entry and text changed; commitTitle with unchanged text, "" and "  " → no entry, text unchanged; cancelEdit → no entry; a 200-character title stored in full
  - pruning: delete a selected node (dispatch delete_node) → removed from selectedIds and primary falls back; collapsing a node hides its selected descendants from selectedIds; undo of a create that left the node selected prunes it; menuTargetId cleared when its node is deleted; load clears everything
  - selection.ts unit tests for visibleIds / topmost / prune over a forest with a collapsed subtree and a floating root
  - no previous state object or selectedIds array is mutated (frozen snapshots)
  - import inventory: editor-store.ts / selection.ts import only zustand/vanilla, nanoid, ../../domain/*, ../history/history, ./selection; grep for react / bare zustand in application/ = 0
  - gates: pnpm test:unit ≥90% on editor-store.ts and selection.ts; boundaries, typecheck, lint, dead-code (nanoid used), duplicate-code, fmt:check, install --frozen-lockfile exit 0
Non-goals: keyboard mapping and the isEditing gate itself (7.3); rubber-band hit-testing (7.3 computes ids, then calls a selection action); arrow navigation (7.3); delete-selection action and "主根不能删除" (7.4); drag planning (8.x); React components; autosave (#13); the blur-then-撤销 click double effect (7.2 / 7.5)
Review focus: selection snapshot restore on cancel/rejection; pruning in the same set() as map changes (no stale ids, primary fallback); created vs rename paths in commitTitle/cancelEdit; already-editing / not-editing guards; topmostSelected order and visibility; nanoid injection, version and licence
```

## Fixture — issue #10 (task 4.1)

```text
Change surface:
  - src/contexts/map/domain/map-repository.ts (new, type-only): MapSummary, MapRepository — paired map-repository.test.ts with expectTypeOf assertions (same pattern as types.ts / types.test.ts)
  - src/contexts/map/domain/errors.ts (extended in place; one home for domain errors): StorageUnavailableError, UnsupportedSchemaVersionError — tests added to errors.test.ts
  - src/contexts/map/infrastructure/persistence/in-memory-map-repository.ts (new) + in-memory-map-repository.test.ts (runs the contract suite); delete infrastructure/.gitkeep once the directory has a real file
  - tests/support/map-repository-contract.ts (new, outside src/ so 4.2 imports it unchanged; not under the per-file coverage or pairing gates; no dependency-cruiser rule governs an infrastructure test importing tests/support). It reuses deepFreeze / node / mapOf from tests/support/map-domain.ts instead of copying them (jscpd scans only src/)
  - No new dependency; no browser API (node env)
Must preserve: TreeOpError and every existing errors.test.ts case unchanged; domain purity (domain imports only itself, src/shared and zod); MindMap type unchanged
Must add (exact names and shapes):
  - type MapSummary = { id: string; title: string; updatedAt: string } (exactly these three keys)
  - interface MapRepository { list(): Promise<MapSummary[]>; get(id: string): Promise<MindMap | undefined>; put(map: MindMap): Promise<void>; delete(id: string): Promise<void> } — ids typed as MindMap['id']
  - class StorageUnavailableError extends Error: `override readonly name = 'StorageUnavailableError'` (TreeOpError pattern); constructor(message: string, options?: ErrorOptions) so an adapter can attach the underlying failure as `cause`
  - class UnsupportedSchemaVersionError extends Error: `override readonly name = 'UnsupportedSchemaVersionError'`; readonly found: number; readonly supported: number; constructor(found, supported) with a message naming both numbers
  - Error contract of the port (doc comment on MapRepository in map-repository.ts):
    - StorageUnavailableError means exactly "the backing store cannot be opened or has become unusable".
      - An adapter opens its store before it is handed out: 4.2 exposes an async factory that rejects with it.
      - The composition-root provider (6.2) awaits that factory once per session. On this error it falls back to one InMemoryMapRepository and sets the session's storage-unavailable state (D7). No other caller swaps repositories.
      - After that, any method MAY still reject with it if the store becomes unusable mid-session. A caller that receives it reports storage-unavailable (the banner): autosave (5.2) sets its storageUnavailable flag (no "保存失败", no swap), and a reader (get/list) shows the banner state, never not-found.
      - Every other storage failure rejects with the underlying error, never with StorageUnavailableError. A failed put or delete surfaces as the "保存失败" notice (spec "Write failure is visible"). A failed get or list is the reader's error state, never not-found.
    - UnsupportedSchemaVersionError is thrown only by get(id) when the stored record's schemaVersion is newer than the adapter supports. list() never rejects because of one record's version: a newer-version record is listed from its id/title/updatedAt when they are readable and skipped when they are not, so the library still shows it and opening it reports the version (D8, 6.2). put and delete never throw it.
    - Adapter-specific behaviour is tested by the adapter. 4.2 tests the open failure, the newer-version get, and list over a newer-version record. The in-memory adapter can produce neither error: it is always open and holds only current-version maps.
  - class InMemoryMapRepository implements MapRepository (no constructor arguments; starts empty)
  - describeMapRepositoryContract(label: string, createRepository: () => MapRepository | Promise<MapRepository>): registers a vitest describe block; every case calls the factory for a fresh, empty repository and assumes nothing about the adapter beyond the port
Contract (what every adapter must satisfy — the suite asserts each, deep equality only, never object identity, so a structured-cloning store passes):
  - empty repository: list() → []; get(any id) → undefined
  - list() order must not be derivable from put order: a dedicated case puts maps whose put order disagrees with updatedAt order and then replaces one with a newer updatedAt (put a@11:00, b@10:00, then b@12:00 → ['b','a'] with exact summaries; and, because Map.set keeps a replaced key's original slot so that sequence alone still passes a reverse-insertion adapter, a second sequence a@11:00, b@10:00, c@12:00, b@10:30 → ['c','a','b'], which matches neither insertion order nor its reverse), so a reverse-insertion adapter fails (bite check (vi))
  - list() ordered by updatedAt descending, ties broken by id ascending using plain code-unit comparison (`<`, not localeCompare); updatedAt compared as strings (the app writes ISO-8601 UTC via toISOString, which sorts lexicographically). Concrete case: put a@2026-11-05T10:00:00.000Z, c@…11:00…, b@…11:00… in that order → list ids ['b','c','a']; tie case: put 'a' first, then 'B', at the same updatedAt → ['B','a'] (code units, where localeCompare would give ['a','B']); a second tie put in the opposite order ('B' first, then 'a') must give the same result, so neither insertion order nor its reverse can pass. Note for 4.2: an IndexedDB 'prev' cursor on an updatedAt index returns ties in descending key order, so the adapter sorts in JavaScript
  - list() entries are exactly { id, title, updatedAt } of each stored map (toStrictEqual against a literal { id, title, updatedAt }, and the sorted Object.keys = ['id','title','updatedAt'], so key order is not asserted; no roots, createdAt or other keys)
  - get(unknown id) → undefined, also when other maps are stored
  - put stores the map as given: get(id) toStrictEqual the input for a rich map (floating root with position, collapsed child with note and color, nested children) with a deliberately old updatedAt — title, createdAt and updatedAt unchanged (no stamping)
  - put of an existing id replaces it: get returns the second map, list holds one entry for that id with the second title/updatedAt
  - delete(id) removes it: get → undefined, list excludes it, other maps untouched; delete of an unknown id resolves and changes nothing
  - isolation: mutating the object passed to put after put resolves, or the object returned by get, does not change what a later get / list returns; put accepts a deep-frozen map (it never mutates its input)
In-memory adapter: holds structuredClone copies (put clones in, get clones out, list builds fresh summaries) so it behaves like IndexedDB's structured clone — it is the real session fallback (D7), so callers must not be able to alias its state
Governing invariant: a repository returns exactly what was last put under an id (deep-equal, never stamped, never aliased) and its list is a three-field summary of the stored maps in updatedAt-desc, id-asc order
Sibling surfaces: 4.2 IndexedDbMapRepository runs the same suite unchanged (schemaVersion envelope and both errors are 4.2's tests); 5.2 autosave (stamps updatedAt before put — this suite proves the adapter does not); 6.2/6.3 provider and fallback (constructs InMemoryMapRepository); 10.1 library list order; account (M2) implements the same port
Seams under test: the MapRepository port through describeMapRepositoryContract; error classes via errors.test.ts; types via expectTypeOf
Required evidence (vitest, node env):
  - every contract bullet above as its own `it`, run against InMemoryMapRepository (the factory signature is async-capable; 4.2 passes a fresh `new IDBFactory()` or a unique DB name per case, because there is no teardown hook)
  - errors: StorageUnavailableError — instanceof Error and itself, name, message, cause passed through (and absent when not given); UnsupportedSchemaVersionError — instanceof, name, found/supported fields, message contains both numbers
  - type assertions: MapSummary is exactly the three string fields; MapRepository method signatures
  - red run before implementation; bite checks: (i) list sorted ascending → ordering case fails; (ii) put without structuredClone (stores the reference) → isolation case fails; (iii) list returns whole maps → shape case fails; (iv) get returns the stored reference → isolation case fails; (v) tie-break with localeCompare → tie case fails; (vi) list returns summaries in reverse insertion order (no sort) → the put-order and tie cases fail
  - import inventory: map-repository.ts imports only ./types; in-memory-map-repository.ts imports only ../../domain/*
  - gates: pnpm test:unit ≥90% per file; boundaries, typecheck, lint, dead-code, duplicate-code, fmt:check exit 0
Non-goals: IndexedDB adapter, idb / fake-indexeddb, schemaVersion envelope and its error-path tests (4.2, against the error contract above); updatedAt stamping and autosave (5.2); provider and fallback wiring (6.2/6.3); validating stored maps; concurrent writers (single JS thread; the port is async only for IndexedDB)
Review focus: no stamping and no aliasing in the adapter; summary exactness and ordering including ties; the contract suite is adapter-agnostic (no in-memory internals, fresh repository per case, deep equality only) so 4.2 can reuse it; error class shapes match D7
```

## Fixture — issue #11 (task 4.2)

```text
Change surface:
  - src/contexts/map/infrastructure/persistence/indexed-db-map-repository.ts (new) + indexed-db-map-repository.test.ts (contract run + adapter tests)
  - src/contexts/map/infrastructure/persistence/summary-order.ts (new) + summary-order.test.ts: the summary comparator (updatedAt desc, id asc by code unit), extracted from in-memory-map-repository.ts so both adapters share one implementation (AGENTS.md Code Canonicality); in-memory-map-repository.ts only switches to importing it
  - package.json + pnpm-lock.yaml: `idb` 8.0.4 (runtime, ISC) and `fake-indexeddb` 6.2.7 (dev, Apache-2.0) via pnpm add; both releases are older than Renovate's 3-day minimum age; the task adds them, which overrides "never bump a dependency inside a feature PR" (this adds, it does not bump)
  - tests import 'fake-indexeddb/auto' in the test file only (node env; no global setup change)
  - openspec m1-canvas tasks.md: 4.1 and 4.2 ticked
Must preserve: the MapRepository port, its error contract (doc comment on MapRepository) and tests/support/map-repository-contract.ts unchanged; InMemoryMapRepository behaviour unchanged (its only edit is importing the shared comparator); domain purity (idb lives only in infrastructure/)
Must add (exact names):
  - openIndexedDbMapRepository(): Promise<MapRepository> — the async factory of the port's error contract: opens the database eagerly and resolves only with a usable repository; any open failure rejects with StorageUnavailableError whose `cause` is the underlying error. Opens through idb's openDB, which reads the global `indexedDB`; no test-only parameters
  - exported constants used by tests instead of duplicating literals: MAP_DB_NAME = 'mindsprout', MAP_DB_VERSION = 1, MAP_STORE = 'maps', MAP_SCHEMA_VERSION = 1
  - the repository class is module-private (callers only see MapRepository)
Storage layout (D7, Migration Plan): database MAP_DB_NAME at version 1, created in the upgrade callback with one object store MAP_STORE using out-of-line keys; put(map) writes exactly { schemaVersion: 1, map } under key map.id (no ownerId, no extra fields, no stamping); out-of-line keys keep a future-version record addressable even if its shape changes
Behaviour:
  - put(map): one readwrite transaction; the request and tx.done are awaited together (Promise.all, or idb's db.put(store, value, key) shorthand), so an abort never leaves an unhandled rejection; any failure (quota, DataCloneError, transaction abort) rejects with the underlying error, never StorageUnavailableError
  - delete(id): one readwrite transaction, request and tx.done awaited together; unknown id resolves
  - get(id): absent key → undefined; "object" below always means a non-null object (typeof === 'object' && !== null). The value is an object with schemaVersion === 1 and an object `map` → that map, returned as stored (no validation or canonicalisation); value with an integer schemaVersion > 1 → UnsupportedSchemaVersionError(found, 1), read in a readonly transaction so the record is untouched; anything else (value not an object, schemaVersion missing / not a number / not an integer / < 1, or v1 whose map is not an object, including null) → rejects with a plain Error naming the id — a reader error state, never undefined/not-found and never StorageUnavailableError
  - list(): one readonly pass over keys and values; a record becomes { id: key, title: map.title, updatedAt: map.updatedAt } when its key is a string, its value is an object whose `map` is an object, and title and updatedAt are strings — regardless of schemaVersion (a newer-version record is listed); every other record is skipped; list never rejects because of a record's content; sorted in JavaScript by updatedAt descending then id ascending by code unit (the contract's tie and put-order cases)
  - no mid-session StorageUnavailableError mapping in M1 (the port says MAY): a transaction on a closed connection rejects with the underlying error
Governing invariant: what put stores is exactly { schemaVersion: 1, map } under map.id and reads back deep-equal across reopening; a record the adapter cannot serve is reported as an error (version or unreadable), never as absent, and never makes list fail
Sibling surfaces: the 4.1 contract suite (must pass unchanged); 5.2 autosave (put failures → "保存失败"); 6.2 provider (awaits openIndexedDbMapRepository, falls back on StorageUnavailableError) and route (UnsupportedSchemaVersionError → version state; other get rejections → error state); 10.1 library (list tolerant of newer/corrupt records); M2 sync reads the v1 envelope
Seams under test: openIndexedDbMapRepository + the MapRepository port, with fake-indexeddb as the IndexedDB implementation; raw records are seeded and inspected through idb's openDB on the same IDBFactory using the exported constants
Required evidence (vitest, node env, fake-indexeddb):
  - contract: describeMapRepositoryContract('IndexedDbMapRepository', factory) where the factory installs a fresh `new IDBFactory()` as globalThis.indexedDB (vi.stubGlobal) before opening — every case gets an empty database
  - envelope: after put(map), the raw value under key map.id is toStrictEqual { schemaVersion: 1, map } and the store holds exactly one record
  - spec "Floating root round-trip": a floating root at (300, 200) with a collapsed child carrying a note (and a color) is put, a second repository is opened on the same IDBFactory (a reload), and its get returns the map toStrictEqual; its list shows the summary
  - spec "Future version" (issue AC): a seeded { schemaVersion: 2, map } under 'x' → get('x') rejects with UnsupportedSchemaVersionError, found 2, supported 1; the raw record is deep-equal to the seed afterwards; list includes { id: 'x', title, updatedAt } from it
  - a newer version whose shape changed: a seeded { schemaVersion: 3, data: … } (no map) → get rejects with UnsupportedSchemaVersionError found 3, supported 1 (the version is reported regardless of map's shape — the reason for out-of-line keys), record unchanged; bite: the version check moved inside the map guard → this case fails
  - list tolerance: alongside a valid record, seeded records that are skipped — a newer version without a readable map ({ schemaVersion: 3, data: … }), a non-object value, null, { schemaVersion: 1, map: null }, a v1 envelope whose title is not a string — list resolves (never rejects) with only the readable summaries
  - unreadable get: seeded values without schemaVersion, { schemaVersion: '1', map }, { schemaVersion: 1, map: null } and { schemaVersion: 1.5, map } → get rejects with an Error that is neither StorageUnavailableError nor UnsupportedSchemaVersionError and names the id; record unchanged
  - open failure → StorageUnavailableError with `cause` set, for: (a) globalThis.indexedDB undefined; (b) indexedDB.open throwing synchronously (a stub whose open throws a SecurityError-named DOMException/Error); (c) the open request failing — a database MAP_DB_NAME already at version 2 makes opening version 1 fail with VersionError (cause.name === 'VersionError')
  - put failure is not StorageUnavailableError: put of a value the structured clone rejects (a map carrying a function in a cast field) rejects with an error whose name is 'DataCloneError' (not StorageUnavailableError), and the store is still empty afterwards
  - red run before implementation; bite checks: (i) list sorts by updatedAt ascending → contract ordering cases fail; (i-b) no id tie-break and records iterated in descending key order (reversed getAll or a 'prev' cursor) → contract tie case fails — removing only the id comparison does NOT fail, because fake-indexeddb returns records in ascending code-unit key order and the sort is stable; (ii) get treats a non-number schemaVersion as v1 → unreadable-get case fails; (ii-b) the object guard uses typeof only (null passes) → the map:null get and list cases fail; (iii) open failure rethrown raw (or mapped only via .catch, missing the synchronous throws) → open-failure cases fail. Review-only: awaiting tx.done on writes — fake-indexeddb serialises overlapping transactions on one database and clones synchronously in put, so a missing await is not observable in this environment
  - gates: pnpm test:unit ≥90% per file; typecheck, lint, boundaries, dead-code, duplicate-code, fmt:check, install --frozen-lockfile exit 0; licences ISC / Apache-2.0 checked by review of the packages' license fields (constraints.yaml: no CI licence audit)
Non-goals: fallback wiring and the banner (6.3); the version-state UI (6.2); autosave (5.2); schema migrations and database upgrades beyond creating version 1, `blocked` / `versionchange` handling (no second version exists in M1); mid-session StorageUnavailableError mapping (port MAY); validating or canonicalising stored maps — the #4 follow-up on #11 (stored `collapsed: false` / stray positions) is answered on #11: if canonicalisation on load is wanted it belongs in the application load path (6.2 / editor-store load), not in this adapter
Review focus: envelope exactness and out-of-line key; error mapping on every path (open, version, unreadable, put); list tolerance never rejecting; tx.done awaited on writes; the contract suite runs unchanged with a fresh database per case; dependency versions and licences
```

## Fixture — issue #8 (task 3.1)

```text
Change surface: src/contexts/map/application/layout/layout-forest.ts (new) + layout-forest.test.ts; package.json + pnpm-lock.yaml: `pnpm add d3-hierarchy@3.1.2` (runtime, ISC) and `pnpm add -D @types/d3-hierarchy@3.1.7` (dev, MIT) — pinned explicitly because pnpm has no minimumReleaseAge here and 3.1.3 (released 2026-11-03) is inside Renovate's 3-day minimum age; the range style follows package.json, the lockfile must resolve d3-hierarchy 3.1.2; imports only d3-hierarchy and ../../domain/types
Must preserve: domain and every existing module untouched; application/ stays framework-free (d3-hierarchy is a pure library, allowed by no-framework-in-domain-or-application)
Must add (exact names):
  - type NodeSize = { width: number; height: number }
  - type LayoutOptions = { direction: 'LR'; nodeSize?: ReadonlyMap<NodeId, NodeSize>; gap?: number }
  - type ForestLayout = { positions: Map<NodeId, Position>; sizes: Map<NodeId, NodeSize>; edges: Array<{ source: NodeId; target: NodeId }> } — Position from ../../domain/types; `sizes` holds the size actually used for every positioned node (same keys, same order as positions), so 3.2 contentBounds and 8.x hit-testing read it instead of re-deriving the measured-or-estimate rule
  - layoutForest(map: MindMap, options: LayoutOptions): ForestLayout
  - estimateNodeSize(text: string): NodeSize — the first-paint estimate
  - DEFAULT_GAP (number, 32) used when options.gap is absent, not finite or negative (0 is allowed: boxes may touch, never overlap)
Coordinate convention (shared with 3.2, 6.1 and 8.x):
  - a position is the top-left corner of the node's box, in canvas pixels (React Flow's node position)
  - the primary root's top-left is exactly (0, 0); columns and rows are computed per tree from that tree's visible nodes only and anchored at the tree root's top-left, so 3.2 can reuse the same routine with a floating root's stored position as the anchor (and an edit in one tree never moves another)
  - columns: every node at depth d has x = Σ_{k<d} (maxWidth_k + gap), where maxWidth_k is the widest visible node at depth k — so nodes at different depths never overlap horizontally
  - rows: d3-hierarchy tree() with nodeSize([1, 1]) and separation(a, b) = (height(a) + height(b)) / 2 + gap gives each node's vertical centre. d3 applies separation between adjacent siblings and between the facing contours of neighbouring subtrees, so adjacent nodes at the same depth are AT LEAST that far apart centre-to-centre (cousins may be further); non-adjacent same-depth nodes are separated by the sum of the gaps between them (all heights > 0), so same-depth boxes never overlap. Tests assert non-overlap and ordering, never exact spacing. y = centre − height / 2, then shifted so the primary root's y is 0
  - a parent's vertical centre is the midpoint of its first and last visible child's centres (d3 tree)
Sizes (the values returned in `sizes`): a node's size is options.nodeSize.get(id) when present with finite width and height > 0; otherwise estimateNodeSize(node.text). estimateNodeSize: height 32; width = max(48, 24 + Σ per code point (14 for CJK / full-width code points — U+2E80–U+9FFF, U+AC00–U+D7AF, U+F900–U+FAFF, U+FF00–U+FFEF — else 8)); code points via Array.from(text); no maximum (titles are single-line, D9). Known limits: code points outside the listed ranges (including astral CJK and emoji) count as 8 px — measurement corrects them; and because a column is as wide as its widest node, one long title pushes the whole next column right — accepted for M1, not a bug for 6.x/9.x review
Scope of the forest in 3.1: only roots[0] (the primary tree) is laid out; floating roots and their subtrees get no positions and no edges (3.2 adds them)
Collapse: a node with collapsed: true gets a position, its descendants get none, and no edge leads to them; the layout of the rest equals the layout of the same map with that node's children removed
Edges: one { source: parent, target: child } per visible parent-child pair; positions and edges are both in pre-order (children in array order), so iteration order is deterministic
Purity: no mutation of map or options (deep-frozen inputs work); no Date/random; same inputs → toStrictEqual outputs
Governing invariant: for every laid-out map, no two visible node boxes intersect, every child's box is entirely to the right of its parent's, siblings are stacked top-to-bottom in children order, and hidden nodes have no position
Sibling surfaces: 3.2 (floating subtrees reuse this per root; contentBounds reads positions + sizes); 6.1 canvas (feeds measured sizes back, renders positions as React Flow positions); 8.1/8.2 hit-testing against laid-out rects (needs the same sizes the layout used — 6.1's concern); 8.3 memoisation on (map, collapsed set)
Seams under test: layoutForest and estimateNodeSize
Required evidence (vitest, node env):
  - "intersect" means the open intervals overlap on both axes (boxes that only touch do not intersect)
  - spec "Three-level tree renders without overlap": root, two children, three grandchildren → every box is right of its parent's right edge, no two boxes intersect (pairwise), children top-to-bottom in array order
  - spec "Adding a child reflows siblings": node with one child, then the same map with a second child → both children's boxes do not overlap and the parent's vertical centre equals the midpoint of the two children's centres; the first child's position changed
  - spec "Measured size replaces the estimate": a node whose measured width is larger than its estimate → with the estimate only, its child's left edge is left of the measured right edge (the scenario is meaningful); with nodeSize given, every node in the next column starts at or after measured right edge + gap
  - collapsed (positions only): a collapsed node with four descendants → none of them has a position or edge, the node itself does; positions equal those of the same map with the node's children removed
  - spec "Re-layout without changes": two runs, and a run with an equal but distinct nodeSize Map → toStrictEqual positions, sizes and edges
  - root at origin: primary root position is { x: 0, y: 0 } for a map with and without children
  - property: a deterministic generated primary tree (fixed-seed or hand-written generator, no Math.random): ≥ 60 nodes, depth ≥ 4, mixed CJK/Latin texts of varying length; measured heights drawn from a set including values below and well above 32 (e.g. 20 and 120); measured widths above the estimate; the leaf-then-bushy-sibling pattern at depths 1 and 2; same-depth cousins under different parents; one collapsed subtree → satisfies the governing invariant (pairwise non-intersection, child right of parent, sibling order)
  - floating roots get no positions or edges; deep-frozen map and nodeSize are accepted unchanged
  - sizes: valid nodeSize entries come back in `sizes` as given; missing entries and entries with NaN, 0 or negative width/height come back as the estimate (and are laid out with it); `sizes` and `positions` have identical keys in identical order; gap NaN / negative → DEFAULT_GAP; estimateNodeSize: empty text → width 48, a CJK title is wider than a Latin title of the same length, height 32
  - red run before implementation; explicit cases for the bites: (a) columns case — root → [A: a leaf with a long Latin title, B: a short title with five leaf children] where A.width > B.width + gap; every box of B's children lies right of A's right edge and none intersects A; (b) mixed-height case — adjacent siblings and two same-depth cousins under different parents, one with a measured height ≥ 120 against estimated 32 → no intersections. Bite checks: (i) per-path x (child x = parent x + parent width + gap) instead of columns → case (a) fails; (ii) constant separation ignoring heights → case (b) fails; (iii) collapsed descendants laid out → collapsed case fails; (iv) `sizes` built from the estimate only → the sizes case fails
  - gates: pnpm test:unit ≥90% per file; typecheck (the real evidence that @types/d3-hierarchy is used — knip ignores @types/*), lint, boundaries, dead-code (d3-hierarchy used), duplicate-code, fmt:check, install --frozen-lockfile exit 0; pnpm-lock.yaml resolves d3-hierarchy 3.1.2
Non-goals: floating subtrees and contentBounds (3.2); React Flow rendering and measurement (6.1); the rendered collapse scenario and descendant count (9.1); TB/radial directions (only 'LR' is accepted, by type); memoisation (8.3)
Review focus: the coordinate convention and its documentation; no-overlap across depths and within depths with mixed sizes; collapse; determinism; dependency version and licences
```

## Fixture — issue #9 (task 3.2)

```text
Change surface: src/contexts/map/application/layout/layout-forest.ts + layout-forest.test.ts only; no dependency, domain or other module change
Must preserve: every #8 contract in "Fixture — issue #8 (task 3.1)" for the primary tree — top-left positions, primary root exactly at (0, 0), per-tree columns and rows, sizes fallback, gap fallback, collapse, pre-order, purity, governing invariant; every #8 test assertion stays (two exceptions, both because 3.2 now lays out sampleMap's floating root f1 → fc: the 3.1 case "floating roots get no positions or edges" is replaced by the cases below, and the deep-frozen case's `expect(result.positions.size).toBe(4)` becomes `expect([...result.positions.keys()]).toStrictEqual(['r', 'p', 'a', 'b', 'f1', 'fc'])`); `expectGoverningInvariant` checks one tree (primary-only key set, all-pairs overlap) — on forest maps apply it per tree (e.g. a `root` parameter) or rely on the translated-equivalence case, never across trees
Must add (exact names):
  - interface ContentBounds { minX: number; minY: number; maxX: number; maxY: number }
  - contentBounds(layout: ForestLayout): ContentBounds | undefined
Floating placement:
  - every floating root (roots[1..]) is laid out by the same per-tree routine as the primary tree, then translated so the floating root's top-left equals its stored `position` exactly: for every node of that tree, position = local position + root.position, where local is what the routine gives with the root at (0, 0)
  - columns, rows, widest-per-depth and separation are computed per tree from that tree's visible nodes only; trees never influence each other, so the primary tree's positions/sizes/edges are toStrictEqual whether floating roots exist, move, or change content
  - trees may overlap each other (floating positions are user-placed); the governing invariant holds within each tree, not across trees
  - collapse, the sizes rule and the gap rule apply to floating trees exactly as to the primary tree
  - edges: per tree, { source: parent, target: child } for visible pairs; no edge between roots
  - order: positions, sizes and edges list the primary tree first, then each floating tree in roots order, each in pre-order
  - a floating root whose `position` is absent or has a non-finite x or y (a corrupt map — no TreeOp produces one; reachable only from a hand-edited persisted record) throws Error naming the root id; never laid out at an invented place
contentBounds:
  - over every id in layout.positions with its layout.sizes entry: minX = min x, minY = min y, maxX = max(x + width), maxY = max(y + height) — the union of every laid-out box, floating subtrees included
  - an empty layout (no positions) → undefined; a position whose id has no sizes entry → throws Error naming the id (ForestLayout guarantees identical keys; a hand-built layout that breaks it is a caller bug)
  - pure; reads nothing but the layout
Governing invariant: for every map, each tree's boxes satisfy the #8 governing invariant, each floating root's box top-left equals its stored position, the primary tree's layout is independent of every floating root, and contentBounds contains every laid-out box
Sibling surfaces: 6.1 canvas renders all trees' positions; 6.2 fit-to-content frames contentBounds; 8.1/8.2 hit-test every tree's rects and set_root_position / detach store top-left positions (a detach at positions.get(id) must not move the node); 8.3 memoisation (D11 per-root recompute stays possible because trees are independent); a corrupt persisted map makes layoutForest throw during the 6.1 render — the 6.2/6.3 editor route owns the error boundary for it
Seams under test: layoutForest and contentBounds
Required evidence (vitest, node env):
  - spec "Move a floating root": map with a primary tree (≥ 3 nodes) and a floating root with ≥ 2 levels of children at (300, 200), then the same map with it at (500, 200) → every node of that subtree shifts by (+200, 0) (toBeCloseTo, 9 digits) and the primary tree's positions are toStrictEqual to before
  - anchoring: a floating root's position equals its stored position exactly (toStrictEqual), including a non-integer position; its subtree equals the primary-style layout of the same subtree (laid out as roots[0] of another map, with the same nodeSize and gap) translated by the position (toBeCloseTo); the case passes an explicit gap ≠ DEFAULT_GAP and a nodeSize with one valid and one invalid entry for floating nodes, and those nodes' sizes are toStrictEqual the measured entry and the estimate respectively
  - independence: adding a floating root whose subtree has a much wider node and taller measured nodes at every depth leaves the primary tree's positions, sizes and edges unchanged (toStrictEqual on the primary ids)
  - collapse in a floating tree: a collapsed floating descendant hides its children (no position, size or edge)
  - order and edges: a map with two floating roots (each with children) → positions keys are primary pre-order then each floating tree's pre-order in roots order (literal toStrictEqual list), and edges equal a literal toStrictEqual list in the same order with no pair between two roots
  - corrupt map: floating root without position, and one with x NaN → each throws, message contains the root id
  - contentBounds: a layout with a floating subtree at (5000, 5000) → bounds include every box of that subtree (maxX ≥ x + width and maxY ≥ y + height for each) and of the primary tree (minX = 0, minY ≤ 0); a hand-computed small case with literal expected bounds where maxX comes from a node's width (not its x); a floating root at a negative position drives minX/minY; empty layout → undefined; missing size → throws with the id
  - determinism / purity: deep-frozen map with floating roots accepted; two runs toStrictEqual
  - bites (red, then restored): (i) anchor ignored (floating trees at the origin) → "Move a floating root" fails; (ii) columns shared across trees (widest per depth over the whole forest) → independence fails; (iii) contentBounds from positions only (no width/height) → the literal bounds case fails; (iv) contentBounds over the primary tree only → the far-subtree case fails; (v) anchoring the floating root's centre instead of its top-left → anchoring fails; (vi) floating trees laid out without options.nodeSize / options.gap → anchoring fails
  - gates: pnpm test:unit ≥90% per file, typecheck, lint, boundaries, dead-code, duplicate-code, fmt:check exit 0
Non-goals: fit-to-content rendering and viewport math (6.2); drag and set_root_position dispatch (8.x); avoiding overlap between trees (user placement); memoisation (8.3)
Review focus: exact top-left anchoring; per-tree independence; options (nodeSize, gap) honoured for floating trees; bounds include widths/heights and every tree; #8 behaviour unchanged; the stale 3.1 scope comment in layout-forest.ts is rewritten
```

## Fixture — issue #13 (task 5.2)

```text
Change surface:
  - src/contexts/map/application/editor-store/editor-store.ts, extended in place.
  - The debounce and write logic MAY live in a new sibling, editor-store/autosave.ts, with a paired autosave.test.ts. It must not import editor-store.ts (no cycle), and its only domain imports are the MapRepository port and StorageUnavailableError.
  - Store tests go in a new editor-store-autosave.test.ts. Shared test helpers go in tests/support/ (reuse the existing ones, never copy).
  - No new dependency. application/ imports domain only (pnpm boundaries).
Must preserve:
  - Every #12 and #35 contract and test.
  - A store created without `repository` schedules nothing, calls no timer, and behaves exactly as before.
  - rename stamps updatedAt in state with the injected now (design D1).
  - The reducer never touches updatedAt.
Must add (exact names):
  - createEditorStore(options?: { now?: () => Date; newId?: () => NodeId; repository?: MapRepository }). The repository is injected, never imported from infrastructure/.
  - EditorState gains `readonly storageUnavailable: boolean` (initially false) and `flush(): Promise<void>`.
  - Exported const AUTOSAVE_DELAY_MS = 500.
Autosave rules (only when a repository is given):
  - Stable map: the latest state.map observed while groupOpen is false. Autosave only ever writes the stable map, never a map from inside an open History group. So the empty node of an open creation edit is never persisted, not even by flush().
  - Pending: the stable map changed by identity since the last write started. Changes that leave state.map's identity alone never make it pending: viewport, selection, menu, notice, beginGroup/endGroup with no ops, undo or redo on an empty stack.
  - Debounce: each time the stable map changes, the 500 ms timer restarts. When the timer fires with a save pending, one write runs. Ops inside a group do not restart the timer; closing the group publishes the new stable map, and that restarts it.
  - load(map) is not an edit. If a save is pending, load first starts the write of the current stable map (the previous map's last state), then makes the loaded map the baseline. The loaded map is never written just because it was opened.
  - A write puts { ...stable, updatedAt: now().toISOString() }, stamped when the write starts; every other field is as in state. The stamp is not written back into state, which avoids a save loop and keeps map identity stable for subscribers.
  - Concurrent writes are allowed; nothing serialises or cancels them. Storage keeps them in start order (IndexedDB readwrite transactions on one store; the in-memory adapter is synchronous).
  - On StorageUnavailableError: set storageUnavailable to true, and nothing else. No notice, no repository swap; only the 6.2 provider swaps. The flag survives load, because it is session state.
  - On any other rejection: set notice to "保存失败", unless notice already equals it (a repeated failure does not republish the notice). The edit stays in state.
  - After either failure: the written map becomes pending again only if the current stable map is still the exact object (by identity) that the write sent. The next change or flush() then retries; there is no automatic retry timer. A load (new baseline) or a newer stable change in between means no retry.
  - flush(): with a save pending, clear the timer and write immediately; resolve once that write settles. With nothing pending, resolve without calling put. flush() never rejects; failures are reported only through the state above. Without a repository it resolves at once.
Governing invariant: every map handed to put is a map that was in state outside an open group, with only updatedAt changed (stamped at write start). Every edit published outside a group is written within 500 ms of the last stable change, or reported (the flag or the notice).
Accepted edges:
  - cancelGroup restores an equal map under a new identity, which can cause one redundant put with a fresh updatedAt.
  - If the write that load started for the previous map fails, its "保存失败" lands in the new map's state. The same happens when a write already in flight at load fails. In both cases the previous map's unsaved edits are not retried and are lost; the notice reports it.
Sibling surfaces:
  - 6.2 route: creates the store with the session repository, registers pagehide → flush().
  - 6.3 banner/toast: reads storageUnavailable and notice; deduplicating toasts is its job beyond the single notice slot.
  - 4.1 and 4.2 MapRepository error contract (map-repository.ts doc comment). 4.2's dropped connection rejects with non-StorageUnavailable errors, so those must show "保存失败".
  - 7.4 and other showNotice callers share the notice slot; autosave never clears it.
  - 10.x library list reads updatedAt from the repository.
Seams under test: the createEditorStore public API with a stub/in-memory MapRepository and vi fake timers. No IndexedDB, no DOM, no real timers.
Required evidence (vitest, node env, fake timers):
  - spec "Rapid edits coalesce": ten ops dispatched 20 ms apart. At 499 ms after the last op, zero puts; at 500 ms, exactly one. Its roots toStrictEqual the state.map.roots after all ten. Also the AC case: three ops within 500 ms give exactly one put.
  - restart: ops 400 ms apart ×3 → no put until 500 ms after the third.
  - spec "Save stamps updatedAt": a loaded map with updatedAt T0 and an injected now giving T1 > T0. The put map's updatedAt === T1.toISOString(). id, title, createdAt and roots equal state. state.map.updatedAt is still T0. After advancing another 5 s, still exactly one put (no loop).
  - load and non-edits: load, then advance 10 s → zero puts. setViewport, select, openMenu, showNotice, beginGroup+endGroup with no ops, and undo on an empty stack, each followed by advancing 1 s → zero puts.
  - undo and redo each give one put with the undone/redone roots. rename gives one put with the new title, updatedAt stamped at write start.
  - groups: dispatch A, then createNode within 100 ms. At 500 ms the put contains A and not the new node's id. Advance 2 s more with the edit open → no further put. In a fresh store: dispatch A, call createNode before the timer fires, then flush() → exactly one put, which contains A and not the new node's id. flush() with the edit open and nothing pending → no put. commitTitle('x') then 500 ms → the put contains node x. cancelEdit instead → no put ever contains the new node's id. Explicit beginGroup / dispatch ×2 / endGroup → one put after endGroup + 500 ms, none during the group.
  - flush: with a pending save, put is called before the timer is advanced and flush resolves after it; advancing 1 s afterwards adds no put. With nothing pending, it resolves and put is not called. A store without a repository resolves.
  - no repository (fake timers): createEditorStore(), then load + dispatch → vi.getTimerCount() === 0 and storageUnavailable === false. A repository-backed store starts with storageUnavailable false.
  - load while pending: dispatch on map A, then load(B) at 100 ms → exactly one put, of A's map (A's id, the op applied), started synchronously during load. After advancing 10 s: B is never put, and the total is one put.
  - StorageUnavailableError from put → storageUnavailable true, notice stays null, the edit stays in state. A later load keeps storageUnavailable true.
  - any other rejection (an Error / DOMException-like) → notice "保存失败", the edit stays in state, storageUnavailable false. Two failing saves in a row → the notice is published once (count the subscriber calls where notice changed), and the second save did call put (it was retried). flush() after a failure re-puts the same content and resolves without rejecting, even if that put rejects.
  - in flight: the first put is held on a deferred promise while a second save fires. Both are called, in start order. Resolve the first, reject the second → notice "保存失败".
  - failure across load: A's write held on a deferred promise, load(B), then reject A's put → notice "保存失败". Then flush() and advance 10 s → zero puts of B (no retry, and B is never written).
  - bites (make each change, show the named case going red, then restore):
    (i) save on every state change instead of on map identity → the load/non-edit case fails
    (ii) a fixed throttle instead of a restart → the restart case fails
    (iii) no stamp → the stamp case fails
    (iv) the stamp written back into state → the no-loop case fails
    (v) the mid-group map written → the groups case fails
    (vi) StorageUnavailableError treated as a generic failure → the unavailable case fails
    (vii) load ignoring a pending save → the load-while-pending case fails
    (viii) a failed write not left pending → the retry assertion fails
  - gates: pnpm test:unit ≥90% per file, typecheck, lint, boundaries, dead-code, duplicate-code, fmt:check all exit 0.
Non-goals:
  - the pagehide listener and provider (6.2), banner and toast rendering (6.3), IndexedDB (4.2);
  - automatic retry or backoff; clearing the notice on a later success; serialising writes;
  - deferring a creation edit's own content (it is saved once committed).
Review focus: the stable-map rule (never a mid-group map, including in flush); identity gating and load as baseline (with the pending flush); the stamp not written back; the split between the two failure kinds; pending again after a failure; no change for stores without a repository; boundaries (no infrastructure import, no cycle).
```

## Fixture — issue #14 (task 6.0)

```text
Change surface:
  - vitest.config.ts: test.projects. Root keeps resolve.alias and coverage (provider, include, exclude, per-file thresholds, reportsDirectory) unchanged.
    - Root removes test.include and test.environment. vitest 5 merges inline projects with root arrays concatenated ("inline values win, arrays are concatenated"), so a root include of src/**/*.test.{ts,tsx} would also pull smoke.test.tsx into the node project.
    - project `node`: include src/**/*.test.ts, environment node
    - project `dom`: include src/**/*.test.tsx, environment jsdom, setupFiles tests/support/dom-shims.ts
    - both inherit the root config (extends: true) so the @ alias works
  - tests/support/dom-shims.ts (new): no-op browser APIs missing from jsdom that React Flow needs, plus Testing Library cleanup after each test
  - src/components/canvas/smoke.test.tsx (new): the smoke component test, with an inline trivial component
  - docs/engineering/architecture-discipline.md, TDD section: one subsection on the component-test tier
  - package.json + pnpm-lock.yaml: devDependencies jsdom, @testing-library/react, @testing-library/dom (the RTL peer), added via pnpm add -D
  - nothing in src/ outside the smoke test; no gate config is weakened (knip.json, constraints.yaml and the coverage thresholds are unchanged)
Must preserve:
  - every pre-existing src/**/*.test.ts runs in node with no shim globals (the node project has no setupFiles)
  - the coverage include/exclude and 90% per-file thresholds, byte-identical in meaning
  - the vitest.integration/contract configs, untouched
  - Stryker keeps running through @stryker-mutator/vitest-runner (decision in the archived ci-gate-hardening change)
Must add:
  - `.test.tsx` under src/ means jsdom; `.test.ts` means node. No docblock is needed (projects deviation in the proposal triage).
  - tests/support/dom-shims.ts installs each of the following on globalThis only when it is absent, never overwriting a real implementation:
    - ResizeObserver: a class whose observe/unobserve/disconnect do nothing; the callback is never invoked
    - window.matchMedia(query): returns { matches: false, media: query, onchange: null, addListener, removeListener, addEventListener, removeEventListener (all no-ops), dispatchEvent → false }
    - DOMMatrixReadOnly and DOMMatrix: one identity-matrix class (a=d=m11=m22=m33=m44=1, every other component 0, is2D true, isIdentity true) that ignores its constructor argument. React Flow reads `new DOMMatrixReadOnly(transform).m22` as the zoom; identity means zoom 1.
    - plus afterEach(cleanup) from @testing-library/react, because vitest globals are off and RTL's auto-cleanup does not register
  - These are inert stand-ins, not behavioural mocks. A test that needs real geometry (6.1 node measurement) adds its own per-test setup.
Governing invariant: a test file's environment is decided by its extension alone. Node tests never load the DOM environment or the shims, and every .tsx source under src/ is measured by the same per-file coverage gate.
Sibling surfaces:
  - stryker.config.mjs (vitest runner reads vitest.config.ts, so projects must work there)
  - scripts/check-fast.sh / pnpm check:fast (runs vitest; must still work with projects)
  - CI unit job (pnpm test:unit with coverage)
  - knip vitest plugin (reads environments and setupFiles from projects)
  - tsconfig and eslint coverage of tests/support/*.ts and .tsx tests
  - 6.1–6.3 and 9.x component tests are the consumers of this tier
  - constraints.yaml exemptions (unchanged; no new coverage exclude)
Seams under test: the smoke test through RTL render/screen/fireEvent; per-project vitest list; the coverage report
Required evidence:
  - smoke.test.tsx (dom project):
    - renders an inline counter component; getByRole('button', { name: '0' }), then fireEvent.click → the button reads '1' (React DOM events and state work under jsdom)
    - `document` and `window` exist
    - shims present and inert: new ResizeObserver(cb), then observe(document.body) and disconnect() → cb was not called (vi.fn calls length 0); matchMedia('(prefers-color-scheme: dark)') → matches false and media equal to the query; new DOMMatrixReadOnly('scale(2)').m22 === 1 and new DOMMatrix().isIdentity === true
    - cleanup: two tests each render the same text, and the second finds exactly one match (getAllByText length 1)
  - project split: `pnpm vitest list --project node` lists every pre-existing test file and no .tsx file; `--project dom` lists only src/components/canvas/smoke.test.tsx. The pre-existing test count equals main's (491 tests in 24 files on main at 24ae58a).
  - coverage probe (uncommitted, deleted afterwards; git status shows it gone):
    - a temporary src/components/canvas/coverage-probe.tsx rendered by a temporary probe test in the dom project → its coverage row ≥90% in the pnpm test:unit report
    - with the probe source present but never rendered → pnpm test:unit fails the per-file threshold naming coverage-probe.tsx
    - this proves .tsx sources under jsdom are measured and gated
  - knip: pnpm dead-code exit 0, with knip.json unchanged (git diff knip.json is empty). jsdom is found through the dom project's environment, @testing-library/dom as RTL's peer, and tests/support/dom-shims.ts through setupFiles.
  - check:fast: with the change uncommitted, pnpm check:fast runs vitest related in the dom project and reaches the smoke test, exit 0.
  - bites (each applied, shown red, then restored):
    (i) remove setupFiles from the dom project → the shim assertions fail
    (ii) dom project environment set to node → the smoke test fails (document is not defined)
    (iii) remove the cleanup → the cleanup case fails
  - gates: pnpm test:unit, typecheck, lint, boundaries, dead-code, duplicate-code, fmt:check, docs:check, install --frozen-lockfile, mutation, all exit 0
  - for each new devDependency: the resolved version, its npm publish time (≥3 days old) and its licence (MIT)
Non-goals:
  - any canvas component, or React Flow itself (6.1)
  - element measurement shims (offsetWidth/getBBox: 6.1 adds them when needed)
  - @testing-library/user-event and jest-dom matchers (added by the first task that needs them)
  - e2e
Issue acceptance criteria mapped to the deviations:
  - "smoke *.test.tsx under jsdom, pre-existing under node": the per-project vitest list plus pnpm test:unit
  - "≥90% for the smoke component file": the coverage probe (.tsx under jsdom is measured, and gated when unrendered)
  - "TDD section names the jsdom opt-in docblock and the shim file": the TDD section names the opt-in, which is the `.test.tsx` extension (dom project), and the shim file tests/support/dom-shims.ts; pnpm docs:check
  - "knip clean": pnpm dead-code exit 0 with knip.json unchanged
Review focus: node tests unaffected (no shims, no jsdom); coverage settings unchanged; shims inert and install-if-absent; knip clean without new ignores; Stryker and check:fast still work with projects; dependency versions, licences and release age; the three deviations are justified
```

## Fixture — issue #15 (task 6.1)

```text
Change surface (all new under src/components/canvas/ unless noted):
  - MindMapCanvas.tsx ('use client'): export function MindMapCanvas({ map }: { map: MindMap }). It wraps ReactFlowProvider around the view and imports '@xyflow/react/dist/style.css'.
  - MindNodeView.tsx: the custom node, memo-wrapped. Node styles go in a colocated CSS Module, but the contract classes are plain literal strings on the element (see MindNodeView below). A Module class name is hashed in Next and in Vitest (`_<name>_<hash>` proxy), so a Module may only add its own scoped class or style the literals through :global(...).
  - flow-elements.ts: pure toFlowElements(map, layout). Paired test is flow-elements.test.ts (node env).
  - node-sizes.ts: pure mergeNodeSizes(current, measurements). Paired test is node-sizes.test.ts (node env).
  - Component tests: MindMapCanvas.test.tsx and MindNodeView.test.tsx (dom project). Shared React Flow test setup goes in tests/support/ if more than one file needs it.
  - tests/support/dom-shims.ts: also sets globalThis.IS_REACT_ACT_ENVIRONMENT = true (typed global declaration), plus one smoke case asserting it (#14 handoff).
  - docs/engineering/architecture-discipline.md: the coverage bullet adds "except the route components exempted in constraints.yaml exemptions" (#14 handoff). The shim bullet adds that the setup marks the run as a React act environment, so updates triggered outside React (observer callbacks, timers, store writes) must be wrapped in act(...).
  - package.json + pnpm-lock.yaml: @xyflow/react as a runtime dependency. Use 12.12.1 (published 2026-11-02) or an older 12.x; MIT.
  - Imports stay within domain types and application/layout. No store, no infrastructure, no route.
Must preserve:
  - layoutForest and contentBounds are used as-is; no change to application/layout.
  - The coordinate convention: top-left positions, React Flow's default nodeOrigin [0, 0].
  - The node-environment tests: pure helpers run in the node project.
  - The existing smoke cases.
Must add:
  - toFlowElements(map, layout, measured) returns { nodes, edges }:
    - nodes: one per layout.positions entry, in that order:
      - { id, type: 'mindNode', position: layout.positions.get(id) (the same values), data: MindNodeData }
      - never width, height, style or measured fields taken from layout.sizes (#8 handoff: writing sizes back stops the layout from converging)
      - `measured: { width, height }` is set from the canvas's own measured sizes (the measurement state, never layout.sizes estimates), and only for ids whose measurement has a positive, finite width and height (the same test layoutForest uses to accept a size; a 0×0 measurement from a hidden container would otherwise mark the node visible at its estimate). toFlowElements takes them as a third argument.
        Reason (Phase 2 audit of PR #69): in xyflow, adoptUserNodes gives every new user-node object `measured` copied from the user node, and parseHandles drops handleBounds when `measured` is absent. A changed node object without `measured` therefore goes visibility: hidden and is re-observed, so every layout change makes the changed nodes blink for a frame. With `measured` present, handleBounds are kept, and React Flow's own observer still updates them when the element's size changes.
    - MindNodeData = { text: string; color: ColorToken | null; hasNote: boolean; hiddenCount: number }
      - hiddenCount is the number of all descendants in the map when the node is collapsed, else 0. It is counted from the map, because the layout drops hidden descendants.
      - hasNote is true when node.note is a non-empty string.
    - edges: one per layout.edges entry, { id: target, source, target }
    - a pure function, which throws on nothing: the layout already validated the map
  - mergeNodeSizes(current: ReadonlyMap<NodeId, NodeSize>, measurements: readonly { id: NodeId; width: number; height: number }[]) returns ReadonlyMap:
    - it returns `current` itself (same identity) when every measurement equals the stored entry;
    - otherwise it returns one new Map: all current entries plus the changed or new ones; later duplicates in one batch win.
    - It does not filter values (layoutForest already treats invalid sizes as estimates).
  - MindMapCanvas:
    - layout = layoutForest(map, { direction: 'LR', nodeSize: sizes }), with sizes held in React state, initially an empty Map.
    - The nodes and edges handed to <ReactFlow> are derived from map + layout on every render (useMemo allowed). React Flow's internal node state is never read back.
    - It renders nodesDraggable, nodesConnectable and elementsSelectable all false (read-only until 7.x/8.x), minZoom 0.25, maxZoom 2, and panOnDrag [1] (middle button). Space+drag panning keeps React Flow's default Space activation key. Wheel zoom is on.
    - nodeTypes is a module-level constant, which avoids React Flow's new-object warning.
    - Measurement: one ResizeObserver per canvas instance, shared by every node; nodes register through a React context.
      - Each callback batch maps entries to { id, width: borderBoxSize[0].inlineSize, height: borderBoxSize[0].blockSize } (offsetWidth/offsetHeight when borderBoxSize is absent), then calls setSizes(prev => mergeNodeSizes(prev, batch)) once.
      - Measuring never uses getBoundingClientRect, because it scales with zoom.
      - A node unobserves on unmount, and the observer disconnects when the canvas unmounts.
    - Fit-to-content: a button whose accessible name is "适应画布". It calls fitBounds with contentBounds(layout) converted to { x: minX, y: minY, width: maxX - minX, height: maxY - minY } and a padding. It is disabled when contentBounds is undefined (never for a valid map).
  - MindNodeView:
    - a box whose className contains the literal strings "mind-node" and, when color is set, "mind-node--color-<token>". These are the contract read by 9.2 and the e2e walk.
    - the title text
    - a collapse indicator, rendered only when hiddenCount > 0: text = hiddenCount, accessible name "已折叠 <n> 个节点", display only (no onClick, no map change)
    - a note indicator, rendered only when hasNote, with accessible name "有备注"
    - non-connectable target (Left) and source (Right) handles, so edges render. They are hidden with opacity or visibility, never display: none, because React Flow places edge ends from each handle's getBoundingClientRect.
    - The CSS Module sizes the box close to estimateNodeSize: 12 px horizontal padding, 32 px height, 14 px font, single line. Indicators sit inside the box so they are measured.
Governing invariant: the rendered nodes and edges are a pure function of (map, measured sizes). Each node's rendered position is layout.positions for those inputs. A measurement batch that changes nothing produces no new size map, so no new layout runs.
Sibling surfaces:
  - 6.2: the route mounts MindMapCanvas, owns the store viewport and the e2e scenarios (render without overlap, measured size, fit, zoom, space-drag).
  - 7.x: selection, editing and keyboard enable elementsSelectable and swap the title for an input.
  - 8.x: drag enables nodesDraggable and hit-tests layout rects.
  - 8.3: memoisation and the 500-node budget.
  - 9.1: the collapse menu item toggles `collapsed`.
  - 9.2: color theme variables style mind-node--color-<token>.
  - 9.3: the note panel.
  - layoutForest and contentBounds (3.1/3.2): their sizes fallback is what handles invalid measurements.
Seams under test:
  - toFlowElements and mergeNodeSizes (pure, node env)
  - MindMapCanvas and MindNodeView through Testing Library in jsdom. A per-test controllable ResizeObserver is installed with vi.stubGlobal and restored afterwards. Per-test container dimensions are stubbed as React Flow needs and restored afterwards.
  - React Flow internals are never mocked.
Required evidence:
  - flow-elements.test.ts (node):
    - sampleMap-style input: node ids and positions toStrictEqual layout.positions in order
    - without measurements, every node has exactly the keys id, type, position and data (no width, height or style). With a valid measurement for id x, only x also carries measured equal to that measurement. A 0, NaN or Infinity measurement never becomes measured. Other nodes and layout-only (estimated) sizes never appear as measured.
    - a node with note → hasNote true; with note '' or absent → false
    - color 'blue' → data.color 'blue'; none → null
    - collapsed with 4 descendants across 2 levels → hiddenCount 4 and none of the 4 ids among the nodes; expanded → 0
    - a floating root's node position toStrictEqual its stored position
    - edges toStrictEqual a literal list with id equal to target
  - node-sizes.test.ts (node):
    - identical measurements → the same Map identity (toBe)
    - one changed → a new Map that holds the old entries plus the changed one, while the input Map is unchanged
    - three entries in one batch → one new Map containing all three
    - duplicate id in a batch → the last value wins
  - MindNodeView / MindMapCanvas tests (dom), all with zero console.error and console.warn calls (spy, asserted in afterEach).
    - That spy cannot see React Flow's own devWarn: it prints only when NODE_ENV === 'development', which hides error002 (new nodeTypes object), error004 (container size) and error013 (missing styles). The nodeTypes constant and the stylesheet import are therefore review-only here, and 6.2's e2e captures console.warn.
    - Observer callbacks fired by a test run inside act(...).
    - Elements inside a node are queried with getByLabelText / getByText, or getByRole with { hidden: true }, because unmeasured React Flow node wrappers are visibility: hidden.
    - Rendered x/y are parsed as numbers from the node wrapper's transform. React Flow writes `translate(${x}px,${y}px)`, so the string is never compared verbatim.
    - The canvas observer is the one stubbed ResizeObserver instance that observed `.mind-node` elements; React Flow's own observers are ignored.
    - a collapsed node with 4 descendants shows "4" with the label "已折叠 4 个节点", and none of the 4 descendants' titles are in the document. Clicking the indicator leaves the rendered map unchanged.
    - only a node with a note shows "有备注".
    - a node with color 'blue' has class mind-node--color-blue; a node without color has no mind-node--color-* class.
    - measured feedback, with a controllable observer and a map of root r with child a:
      - before any callback, a's rendered x (from the node wrapper transform) = estimateNodeSize(r.text).width + DEFAULT_GAP
      - after one callback batch with r measured at width 300, a's x = 300 + DEFAULT_GAP
      - wrap the canvas in <Profiler>, fire the identical batch 3 more times → the commit count grows by at most 1 in total (bite iii grows it by 3)
      - exactly one stubbed observer instance observed `.mind-node` elements, and it observed every rendered node's element
      - an entry without borderBoxSize, with offsetWidth stubbed to 200 on r's element → a's x = 200 + DEFAULT_GAP
      - rerender with r collapsed → a's element is unobserved by the canvas observer
      - unmount → that instance's disconnect is called
      - the measured-feedback case passes again when rendered inside <StrictMode> (double mount: the observer must exist for the remount's registrations and must not stay disconnected)
    - zoom clamp: wheel events far past the limits on the pane → the .react-flow__viewport transform scale is exactly 2 after zooming in and exactly 0.25 after zooming out
    - floating root at (300, 200) → its node wrapper's parsed translate is (300, 200). A rerender with the root at (500, 200) → (500, 200), and the primary nodes' parsed positions are unchanged.
    - fit: with the container stubbed at 800×600 and a map with a floating subtree at (2000, 1000), click "适应画布" → under the resulting viewport transform, every rendered node box (layout position and size) lies inside [0, 800] × [0, 600]
    - props are the source of truth: rerender with a node's text changed → the new text is rendered and the old text is gone
    - no blink: after a measurement batch, every node wrapper is visibility: visible. A rerender with a changed map that moves nodes (a child added) keeps every previously measured node's wrapper visible (fails without measured, see bite viii)
    - a map with roots: [] (no laid-out node) → "适应画布" is disabled
  - smoke.test.tsx: one added case, globalThis.IS_REACT_ACT_ENVIRONMENT === true
  - bites (each applied, shown red, then restored):
    (i) hiddenCount counted from the layout instead of the map → the hiddenCount case fails
    (ii) layout.sizes written as node width/height → the no-size-keys case fails
    (iii) mergeNodeSizes always returns a new Map → the identity case fails
    (iv) minZoom/maxZoom removed → the zoom clamp case fails
    (v) fit over the primary tree only → the fit case fails
    (vi) sizes not passed to layoutForest → the measured-feedback case fails
    (vii) the act flag line removed → the smoke flag case fails
    (viii) measured omitted from the nodes → the no-blink case fails
  - red run: the new tests failing before the implementation exists
  - Stryker (#14 handoff): a scoped `pnpm mutation --mutate 'src/components/canvas/*.{ts,tsx}'` (excluding tests), run once, shows the dom-project component tests executing under the vitest runner (non-zero tests for the canvas files) and reports the score. The weekly run stays advisory.
  - gates: pnpm test:unit (each new src file ≥90%), typecheck, lint, boundaries, dead-code, duplicate-code, fmt:check, docs:check and install --frozen-lockfile all exit 0
  - @xyflow/react: resolved version, npm publish time (≥3 days old), licence
Non-goals:
  - the route, the store and viewport persistence (6.2)
  - the e2e scenarios (6.2)
  - selection, editing, keyboard, drag and menu (7.x–9.x)
  - color theme values (9.2)
  - memoisation beyond nodeTypes/useMemo, and the 500-node profile (8.3)
  - an initial fit or initial viewport (6.2 owns the viewport)
Review focus:
  - the measure→layout loop converges: shared observer, borderBoxSize, identity-preserving merge, sizes never written back
  - hiddenCount comes from the map
  - read-only flags, zoom limits and the pan buttons
  - fit uses contentBounds, including floating trees
  - zero console noise
  - boundaries (no store or infrastructure imports)
  - dependency version, licence and release age
```

## Fixture — issue #16 (task 6.2)

```text
Change surface:
  - src/app/providers/MapRepositoryProvider.tsx ('use client') + MapRepositoryProvider.test.tsx (dom):
    - The session repository context. It is mounted by src/app/layout.tsx around {children}.
  - src/app/maps/[id]/page.tsx (route file, coverage-exempt):
    - An async Server Component. It awaits params (Next 16: params is a Promise; read node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md) and renders <MapEditor key={id} id={id} />.
  - src/app/maps/[id]/error.tsx (route file, coverage-exempt):
    - A 'use client' segment error boundary. It shows the error state (below), never not-found.
    - Its props follow node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
  - src/app/maps/[id]/MapEditor.tsx ('use client') + MapEditor.test.tsx (dom): load and the state machine.
  - src/app/maps/[id]/MapStatus.tsx + its test: the one component for the not-found, future-version and error messages. error.tsx reuses it.
  - src/components/editor/EditorSession.tsx ('use client') + EditorSession.test.tsx (dom):
    - It owns the editor store, the context and the flush wiring.
    - 7.x–9.x read the store through it.
  - src/components/editor/EditorView.tsx (+ a CSS Module) + EditorView.test.tsx (dom):
    - The header, the canvas area and the ready marker.
  - .changeset/<name>.md: a minor changeset for the root package. This is the first user-visible route, and the repository rules (the AGENTS file) say a changeset accompanies every user-visible change.
  - e2e/map-editor.spec.ts + e2e/support/seed.ts:
    - Seed helpers. #18, #19 and #20 reuse them.
  - Unchanged: e2e/smoke.spec.ts and constraints.yaml (6.4); src/app/page.tsx (10.1).
  - No new dependency. fake-indexeddb (already a dev dependency) may be used in dom tests.
Must preserve:
  - `/` keeps rendering data-testid="app-ready", so the smoke walk stays green.
  - Editor store, autosave, the canvas and the IndexedDB adapter are used as-is.
  - Boundaries:
    - src/components never imports infrastructure; the repository reaches EditorSession as a MapRepository prop typed by the domain port;
    - only src/app imports infrastructure;
    - nothing imports src/app.
Must add:
  - MapRepositoryProvider({ children, open = openSessionRepository }) exposes useMapRepository(): RepositoryState.
    - RepositoryState = { status: 'opening' } | { status: 'ready'; repository: MapRepository } | { status: 'failed' }.
    - openSessionRepository() returns one module-level promise per session: `session ??= openIndexedDbMapRepository()`. It is called only from an effect, never at module level or during render, because SSR evaluates the module (#11 handoff). A rejected open stays rejected for the session.
    - In 6.2 an open failure (StorageUnavailableError or anything else) is the `failed` state, and the route shows the error state. The in-memory fallback and banner are 6.3 (#17), which changes this provider.
    - useMapRepository outside the provider throws.
  - MapEditor({ id }):
    - The repository state is opening → render the loading state.
    - It is failed → render the error state.
    - It is ready → in an effect, call repository.get(id), with a cancelled flag on unmount so no state update follows an unmount.
    - The result of get decides what renders:
      - undefined → not-found.
      - UnsupportedSchemaVersionError → future-version. Nothing is written.
      - Any other rejection (StorageUnavailableError included until 6.3) → the error state. Never not-found.
      - A map → <EditorSession map repository><EditorView /></EditorSession>.
  - MapStatus messages. Each one carries a link "返回导图列表" to "/":
    - not-found: "找不到这张导图" (spec map-library "Stale link")
    - future-version: "此导图由更新版本创建" (spec map-persistence "Future version")
    - error: "无法打开这张导图"
    - loading: "正在打开…" (no link)
  - error.tsx renders the error message. It catches render-time throws below the segment, such as layoutForest's "floating root <id> has no finite position" for a corrupt stored record (#9/#11 handoff).
  - EditorSession({ map, repository, children }):
    - It creates the store once per mount: useState initializer `createEditorStore({ repository })`, then `load(map)`. load is not an edit, so nothing is written on open.
    - It provides the store through EditorStoreContext.
    - useEditorStore(selector) is the React binding (`useStore` from 'zustand'). Used outside the session, it throws.
    - Effect: `addEventListener('pagehide', onPageHide)`, where onPageHide calls `void store.getState().flush()`.
    - Cleanup: remove the listener and call `void store.getState().flush()`. Client-side navigation fires no pagehide (#10 handoff).
    - flush reaches repository.put synchronously, with no await before it (#11 handoff; the store already guarantees this).
  - EditorView:
    - The root element carries data-testid="map-editor-ready" and fills the viewport height.
    - The header has <h1 data-testid="editor-title">{map.title}</h1>, read from the store. It shows the title, never the primary root text.
    - The canvas area has an explicit height (flex: 1 inside a 100dvh column), so React Flow's container is never 0 high (its error004).
    - <MindMapCanvas map={map from the store} />.
  - The e2e seed helper (e2e/support/seed.ts) writes raw IndexedDB records in the page context through the real browser IndexedDB, with no in-memory shortcut.
    - It uses the adapter's exported MAP_DB_NAME / MAP_DB_VERSION / MAP_STORE / MAP_SCHEMA_VERSION. It never retypes them.
    - It writes the envelope exactly as the adapter stores it, so it can also seed { schemaVersion: 2, map } and corrupt records.
    - It reads raw records back for the not-modified assertions.
    - Seeding protocol: the root-layout provider opens the DB on every page, so seeding never runs on an app page.
      1. Navigate to a same-origin page without the provider (/api/healthz).
      2. Open MAP_DB_NAME at MAP_DB_VERSION with an upgrade that creates MAP_STORE exactly as the adapter's upgrade does.
      3. Write the records.
      4. Close the connection.
      5. Navigate to /maps/<id>.
Governing invariant:
  - Every stored map either opens in the editor, exactly as stored, or ends in exactly one visible state (not-found, future-version or error).
  - Opening a map never writes to storage.
  - Leaving the editor by pagehide or by unmount starts a pending save synchronously.
  - Because that put's transaction is created before the next MapEditor effect calls get, IndexedDB orders the later read after the write. This satisfies the #13 handoff ("load only a map fetched after any earlier save has finished") and is evidenced by the synchronous-put cases.
Sibling surfaces:
  - 6.3 (#17): provider fallback, `storageUnavailable`, banner and toast; it changes the failed path.
    - Handoff comment on #17 (posted at merge): a `get` that rejects with StorageUnavailableError shows the error state in 6.2. 6.3 turns it into the banner state (#10 handoff).
  - 6.4 (#18): smoke walk on the ready marker and seed helper.
  - 7.x (#19–#23): read and dispatch through useEditorStore; #19 and #20 run the reload scenarios with the seed helper.
  - 10.1/10.2 (#30, #31): read data-testid="editor-title"; the library shares the provider.
  - 4.2 adapter: the envelope and error contract.
  - 5.2 autosave: flush.
  - 6.1 canvas: needs a container height.
  - Root layout: wraps every route.
Seams under test:
  - dom component tests through Testing Library:
    - the provider, with an injected open, plus openSessionRepository through fake-indexeddb;
    - MapEditor, with an InMemoryMapRepository or a stub repository, inside the provider with an injected open;
    - EditorSession, with a RecordingRepository-style stub and a probe child that dispatches through useEditorStore;
    - EditorView.
    The canvas test setup (tests/support/canvas.ts) is reused where the canvas mounts.
  - Playwright against `pnpm dev`, through the real browser IndexedDB.
Required evidence:
  - dom (zero console.error/warn, via failOnConsoleNoise):
    - provider:
      - opening, then ready with the injected repository;
      - the injected open rejects with StorageUnavailableError → failed, and with a plain Error → failed;
      - openSessionRepository returns the same promise on a second call, and under fake-indexeddb that promise resolves to a working repository (put then get round-trips one map);
      - useMapRepository outside the provider throws.
    - MapEditor:
      - loading text first;
      - seeded map → header shows the map title "标题A" while the root text is "根节点B"; the ready marker is present; the root text is rendered by the canvas;
      - unknown id → "找不到这张导图" with a link href "/";
      - get rejects UnsupportedSchemaVersionError → "此导图由更新版本创建", and the repository received no put;
      - get rejects a plain Error and get rejects StorageUnavailableError → each shows "无法打开这张导图", never "找不到这张导图";
      - provider failed → error state;
      - stale-effect guard: under <StrictMode>, the discarded first effect's get rejects with an Error after the live effect's get has resolved with the map. The editor stays ready and never shows "无法打开这张导图". Removing the cancelled flag makes it fail.
    - EditorSession:
      - the probe sees the loaded map;
      - opening and waiting 1 s on fake timers → zero puts;
      - dispatch an op through the probe, then fire `pagehide` on window → put is called synchronously (before any await or timer advance) with the edited roots;
      - with no pending save, pagehide → no put;
      - after a dispatch, unmount → put is called synchronously;
      - listener removed: capture dispatch through the probe, unmount (its flush puts), dispatch again on the captured dispatch, then fire pagehide → no synchronous put;
      - useEditorStore outside the session throws.
    - EditorView: the header testid text equals map.title; the ready marker is present.
    - MapStatus: each variant's text and link.
  - e2e, Chromium against pnpm dev. Each named scenario asserts zero console messages of type error and warning, plus zero pageerror. React Flow's devWarn goes to console.warn (#15 handoff). Each scenario saves a screenshot to .run/ui-evidence/<scenario>.png.
    - Stale link (spec map-library): /maps/does-not-exist shows "找不到这张导图", and a link to / navigates to /.
    - Future version (spec map-persistence): seed { schemaVersion: 2, map } under id v2 → "此导图由更新版本创建". After 1 s the raw record deep-equals the seed.
    - Seeded render:
      - a map with title "标题A", primary root "根节点B" with 2 children, and a floating root at (300, 200) with 1 child;
      - the header testid shows "标题A";
      - the primary root's React Flow wrapper translate parses to (0, 0) and the floating root's to (300, 200) in flow coordinates;
      - every node is visible;
      - after measurement no two node boxes overlap on screen;
      - edges attach to the measured handles (#15 handoff on handle bounds), in screen coordinates. React Flow's handle is 6 px wide and shifted out by translate(50%), so an edge meets the handle's outer side, not the node edge:
        - each path starts within 1 px of its source handle's bounding-rect right-middle and ends within 1 px of its target handle's left-middle;
        - each handle's centre is within 1 px of its node's right (source) or left (target) edge, at the node's vertical middle;
      - after 1 s the raw record deep-equals the seed (opening is not an edit).
    - Fit to content (spec canvas-layout):
      - a floating subtree at (1600, 900), within about 4× the 1280×720 viewport so the 25% floor can frame it (#9 handoff);
      - before the click, at least one node lies outside the viewport;
      - after clicking 适应画布, every node's bounding box lies inside the viewport.
    - Zoom clamps (spec canvas-layout): wheel-zoom in over the pane until the scale stops → the .react-flow__viewport scale is 2; then out → 0.25.
    - Space-drag pans (spec canvas-layout):
      - hold Space and drag 100 px right, starting over a node;
      - the viewport translate x grows by 100 (±1);
      - every node's flow-coordinate translate is unchanged;
      - no node has the .selected class.
    - Corrupt record:
      - seed a v1 map whose floating root has no position;
      - the page shows "无法打开这张导图" with a link to /, never "找不到这张导图";
      - this scenario allows only console errors whose text contains "has no finite position" (Next's caught-error report includes the thrown error), and asserts at least one was seen;
      - after 1 s the raw record deep-equals the seed (spec: SHALL modify nothing).
  - bites, each applied, shown red, then restored:
    (i) not-found returned for every rejection → the dom "never not-found on error" cases fail
    (ii) pagehide listener not registered → the EditorSession pagehide case fails
    (iii) no flush on unmount → the unmount case fails
    (iv) header shows the primary root text → the dom header case and the e2e seeded-render header assertion fail
    (v) the canvas area without an explicit height → the e2e console-warning assertion (React Flow error004) or the render assertions fail
    (vi) openSessionRepository without `??=` (a new open per call) → the identity case fails
  - red run: the new dom tests and e2e failing before the implementation.
  - pnpm changeset status lists the new changeset (exit 0).
  - gates, all exit 0: pnpm test:unit (every new non-route src file ≥ 90%), typecheck, lint, boundaries, dead-code, duplicate-code, fmt:check, docs:check, pnpm build (first build that compiles the canvas, its stylesheet import and CSS Modules), pnpm e2e (the smoke walk plus the new spec).
Non-goals:
  - the in-memory fallback, banner and toast (6.3);
  - smoke registration and constraints.yaml (6.4);
  - any editing interaction, and so the reload-after-edit scenarios, no-blink across an edit and edge endpoints after a rename (#19 and #20; handed off);
  - the library page (10.x);
  - viewport persistence (not specified for M1; the store's viewport stays unused until a task needs it);
  - validating stored maps on load (the error boundary covers the crash path; canonicalise-on-load stays with the #4 follow-up).
Review focus:
  - the session-singleton open (client only, once per session);
  - the never-not-found-on-error classification;
  - flush is synchronous on pagehide and on unmount, and the listener is cleaned up;
  - no write on open;
  - the error boundary covers corrupt records;
  - container height and zero console warnings in dev;
  - seed helper fidelity to the adapter envelope and constants;
  - boundaries (components never import infrastructure).
```

## Fixture — issue #21 (task 7.3)

```text
Change surface: src/components/canvas selection/keyboard handling and selected rendering; EditorView wiring if needed; paired DOM/unit tests; real-browser e2e selection scenarios; changeset and decision consequence or feature record.
Must preserve: map-prop rendering and existing measurement/layout/fit contracts, node handles, map.title header, no-write-on-open, all #16 browser scenarios, middle-button and Space-drag panning, zoom clamps, domain/store/autosave behavior.
Must add: click selects one node; Shift+click toggles and preserves last-click primary order; left-drag on empty canvas selects exactly fully enclosed visible nodes; Ctrl/Meta+A selects all visible nodes; Escape clears selection.
Must add: ArrowLeft selects parent, no-op on primary/floating roots; ArrowRight selects first visible child, no-op on collapsed/leaf nodes; ArrowUp/Down select previous/next sibling without wrap, no-op at edges and on roots. Arrows navigate from primaryId and replace selection with the single target; empty selection and missing targets are no-ops.
Governing invariant: the editor store is the sole selection authority; rendered selected IDs equal its visible selectedIds and selection-only interactions never change map/history/persistence.
Integration: reuse existing select/toggleSelect/setSelection/selectAll/clearSelection actions; do not write Zustand state directly or create a second selection store. Preserve current static map rendering; the editor supplies controlled interaction state/actions, not an infrastructure dependency.
React Flow: use one selection event path per gesture; prevent built-in keyboard deletion, positional arrow movement and selection shortcuts from bypassing the store. Node drag/connect remain disabled. Selected nodes have an observable, accessible selected state and visible indication.
Focus: handle keyboard input only for the canvas; ignore input, textarea, select and contenteditable targets/focus, active composition, and editing !== null. Unhandled shortcuts retain browser defaults. Handled navigation/selection keys prevent default scrolling/select-page behavior.
Pointer ordering: Space/middle pan never changes selection; Shift toggling never double-applies through a second React Flow callback; clicking a selected node without Shift reduces selection to that node.
Sibling surfaces: EditorSession/useEditorStore; existing selection.ts and store pruning; MindNodeView/flow-elements measurement; #19 F2 primary targeting and title edit; #20 creation focus; #22 delete; #23 undo; #24/#25 drag; #27 menu.
Seams under test: keyboard handler without React Flow, backed by a real createEditorStore; canvas DOM integration with real React Flow; /maps/[id] through real IndexedDB seed helper.
Required DOM evidence: each handled key changes the real store selection as specified; empty selection is safe; roots/leaf/collapsed/sibling boundaries; hidden descendants excluded from select-all; editing flag and text-focus gates preserve selection, history and default behavior. Select A then Shift+click B: Left selects only parent(B); with a mid-sibling primary, Up/Down select only its previous/next sibling regardless of the first selected ID.
Required DOM evidence: click, repeat click, Shift add/remove and last-click primary; selection projection follows store state; no duplicate toggle; selection never changes map identity, canUndo, or persisted roots.
Required browser evidence: spec Rubber-band selection, Arrow navigation, Arrow right on a collapsed node, Arrow left on a floating root; real click/Shift-click selects three nodes with last clicked primary, Ctrl/Meta+A and Escape work.
Required browser evidence: seed through e2e/support/seed.ts; fit before coordinate-sensitive gestures; assert exact selected ID sets, unchanged raw record, zero console errors/warnings/pageerrors and save screenshots under .run/ui-evidence/.
Required regression evidence: existing Space-drag, zoom, fit and measured-render scenarios stay green; add selection-preserving Space-drag over selected nodes so native pan cannot clear the store selection.
Test chronology: save each meaningful red/green command, exit and relevant failure before its production fix; no synthetic test-only production hooks and no bulk imagined-test phase.
Risk-pack commands: pnpm test:unit (affected files explicitly reported), pnpm typecheck, pnpm boundaries, pnpm lint (local .omp limitation tracked in #74), pnpm fmt:check, pnpm docs:check, pnpm decisions:check, pnpm e2e.
Non-goals: inline rename/F2, creation, delete, undo/redo, menus, drag mutations, storage fallback, note UI, persistence schema/config changes. #19 owns canceling a hidden rename editor when its input disappears (issue #21 handoff from #35); no rename UI is introduced here.
Implementation order: keyboard tracer red→green; controlled pointer selection and projection red→green; browser acceptance and preserved-pan evidence; parent verification and cross-review.
Rollback: revert this slice; persisted maps are unchanged because selection is session-only.
Review focus: exact store/render identity; click order and duplicate events; focus/IME gating; React Flow defaults; normalized viewport coordinates for rubber band; no edits or autosave from selection.
```

## Fixture — issue #19 (task 7.1)

```text
Change surface: canvas node title/input, canvas event wiring and controlled editor props; EditorView integration; paired tests, e2e scenarios, changeset and minimal decision consequence update.
Must preserve: static map rendering, measurement/no-blink and handle coordinates, map.title header independent of node text, #21 selection and pan/focus guards, store/history/autosave/adapter contracts and all prior browser scenarios.
Must add: double-click existing node opens that node's single-line input; F2 while canvas owns focus opens only primaryId; no selection is an F2 no-op. F2 retains selectedIds/primaryId, and double-click never applies a group rename.
Governing invariant: only the store's editing.id can commit; one changed nonempty title produces exactly one ungrouped update_node/history entry, Escape produces none, and focus transitions cannot commit the same edit twice.
Integration: use existing startEdit/commitTitle/cancelEdit via the controlled canvas seam, never direct reducer or Zustand state writes. editing !== null is isEditing; no duplicate boolean. Static consumers remain usable without EditorSession.
Input: autofocus/select existing text; local draft changes do not mutate map; Enter commits, Escape cancels, blur commits. Enter/Escape followed by blur/unmount is idempotent. Empty/whitespace or unchanged existing titles follow existing store no-op semantics. Nonempty text is stored verbatim, no maxlength/truncation.
Focus/IME: composing Enter/Escape must not terminate editing; input shortcuts remain native except the editor's terminal Enter/Escape. No canvas select-all/arrows/F2 or Space-pan side effect while typing. Restore canvas focus after Enter/Escape, but a blur commit must not steal focus from its destination.
Lifecycle: if a rename node is removed or becomes hidden, close/cancel its edit without a late blur commit; #35's hidden-rename handoff is handled in UI, not by changing store pruning. No creation lifecycle is implemented here.
Sibling surfaces: EditorSession and EditorView; selection-input and rubber-band gates; MindNodeView and measured handles; #20 creation uses the input next; #23 undo UI; #17 save notices; #35 editing actions; existing IndexedDB autosave and pagehide flush.
Seams under test: DOM interaction through real EditorSession/store and real canvas; public browser interactions on /maps/[id] with existing seedRecords/envelopeOf/readRecord. No browser global store exposure, injected test-only routes or mock persistence.
Required DOM evidence: double-click and F2 target correctly; three selected nodes F2 changes only primary and keeps selection; Enter and blur each dispatch one update_node, a real undo restores exactly the old title and clears canUndo, redo restores it; Escape and Escape→blur leave map/history unchanged; Enter→blur never doubles.
Required DOM evidence: editing state set/cleared, empty/unchanged titles no-op, 200-character text retained, composition Enter ignored until end, native field keys do not select/navigate; hidden/deleted node closes editing and late blur cannot rename another node.
History evidence split: Playwright exercises the named visible rename scenarios; exact one/no undo-entry behavior is asserted at the real-store DOM boundary. Do not add #23 undo shortcuts/buttons or omit history proof.
Required browser evidence: spec Commit a rename, Escape discards, Long title, Rename with three nodes selected (real click/Shift-click then F2); blur commit; assert changed node text and untouched peers/header; zero warning/error/pageerror and screenshots under .run/ui-evidence/.
Required persistence evidence: rename first node, wait 600 ms, rename second, initiate reload within 100 ms of second commit, assert first rename after reload through real IndexedDB. Preserve literal timing and measure it in the browser; use a same-page terminal key event plus immediate reload scheduling if protocol latency would otherwise violate 100 ms. No fake timers or in-memory shortcut. Second rename may survive or be lost; do not overconstrain it.
Required rendering evidence: long rename updates measured node geometry and connected edge endpoints, no hidden-node blink across committed rename; reuse existing geometry conventions rather than comparing transforms as raw strings.
Test chronology: vertical real red→green cycles saved to .workplans/19/review before each behavior fix, including duplicate-terminal-event and target-selection boundaries; no retrospective substitute.
Risk-pack commands: pnpm test:unit, pnpm typecheck, pnpm boundaries, pnpm lint (local installed .omp caveat #74), pnpm fmt:check, pnpm docs:check, pnpm decisions:check, pnpm e2e.
Non-goals: creation, new selection mechanics, delete/undo/menu shortcuts, note editor, fallback, schema/config changes or canonicalising persisted data.
Implementation order: Enter tracer; cancellation/blur/idempotence; F2/multi-selection/IME; lifecycle cancellation; real-browser persistence/rendering evidence; parent verification/review.
Rollback: revert UI slice; stored renamed text remains valid under the unchanged schema.
Review focus: single commit under terminal-event races, targeting and selection retention, native text focus/IME, hidden-input cleanup, real autosave timing, measured edges/no-blink.
```

## Fixture — issue #30 (task 10.1)

```text
Change surface: src/app/page.tsx Server Component shell; client composition for provider/router; shared library list/create components with paired tests; browser scenarios, changeset and decision consequence.
Must preserve: data-testid=app-ready on / in every load state; existing MapRepositoryProvider singleton; no components import src/app/infrastructure; editor header/ready testids, existing seed helpers and all prior UI behavior.
Must add: list every repository MapSummary with title and last-updated time in repository-provided recency/id-tie order; true empty list displays empty message and 新建导图 action; clicking entry opens /maps/<encoded id> through client navigation.
Must add: 新建导图 calls existing createMindMap with independent unique map/root IDs, title/rootText 新导图 and one clock value; await repository.put before navigating to editor. No TreeOp creates primary root; no new map factory or schema.
Governing invariant: create opens exactly the map successfully saved to the same session repository, and a failed/unfinished write never navigates; list read failure never appears as a successful empty library.
Async state: render loading while provider opens/list pending; provider failure/list rejection shows explicit error (not empty); cancellation ignores late results after unmount/repository change. Render no accidental console rejection.
Create state: disable/guard repeated activation while one creation write is pending; success navigates once; rejection shows 保存失败, retains library and permits another explicit attempt; no automatic retry or fallback. Creation timestamps come from factory, no adapter stamping.
Composition: app owns provider/router access, components accept repository and navigation callback. Reuse nanoid and createMindMap; list ordering belongs to repository, no second comparator implementation.
Sibling surfaces: /maps/[id] shared repository/load/title; #17 fallback uses this create path without a library banner; #31 rename/delete; #32 unavailable-home banner/session flows; repository list ordering and autosave unmount flush.
Required DOM evidence: ordered summary rows including equal-time tie from real repository, visible semantic time, true-empty message with create action; provider/list loading/error outcomes distinct; late list result ignored.
Required DOM evidence: deferred put prevents navigation, repeated activation creates/saves once, success passes saved id with factory shape/title/root/timestamps, rejected put shows 保存失败 and does not navigate or claim success; explicit retry after failure works.
Required browser evidence: spec Create from the empty state through real 新建导图 -> dynamic editor URL, single root 新导图, editor-title 新导图; raw IndexedDB record exists and matches those fields.
Required browser evidence: seed A10:00 and B11:00 through real seedRecords; / shows B before A with last-updated times; click A opens correct title; existing / smoke and stale-link return stay green.
Required evidence hygiene: zero warning/error/pageerror for new scenarios, screenshots .run/ui-evidence/, genuine vertical red→green logs .workplans/30/review; no production test-only hooks/routes or mocked browser storage.
Risk-pack commands: pnpm test:unit, pnpm typecheck, pnpm lint (local .omp caveat #74), pnpm boundaries, pnpm fmt:check, pnpm docs:check, pnpm decisions:check, pnpm e2e.
Non-goals: rename/delete, unavailable-home banner, fallback implementation, new APIs, account/sync, pagination/search, automatic retries, schema/dependency/config changes.
Rollback: revert UI slice; created maps remain valid persisted records. Review focus: save-before-navigation, single pending creation, read error versus empty, same repository identity, timestamp/order fidelity and unchanged editor behavior.
```

## Fixture — issue #17 (task 6.3)

```text
Change surface: src/app/providers/MapRepositoryProvider, editor get-state composition, two reusable notice components, EditorView wiring and paired tests/e2e, changeset and decision consequence.
Must preserve: one repository promise per browser session, client-effect-only open/SSR safety, provider opening/failed states for genuine errors, get undefined as not-found, future-version refusal/no writes, corrupt-record boundary, all library/editor/selection/rename contracts.
Must add: only open rejection StorageUnavailableError resolves to one shared new InMemoryMapRepository with storageUnavailable=true; successful IndexedDB resolves false. Other open failures remain failed, never silently fall back. Fallback starts empty and survives provider remount/StrictMode/SPA routes in the same document session.
Governing invariant: every library/editor consumer uses the same resolved repository; fallback is chosen only at initial open, never on a mid-session put/get error, and UI never implies a failed edit was saved.
Provider seam: expose ready repository and unavailable flag; migrate all consumers/tests atomically if the resolved shape changes. Reuse existing in-memory adapter, no proxy storage implementation or duplicate cache.
Banner: reusable props-driven StorageUnavailableBanner renders 未保存到浏览器 only when true, persistent and nondismissible. Editor shows one banner when provider-open unavailable OR store put-unavailable OR current reader get-unavailable.
Get handling: StorageUnavailableError shows banner plus unreadable/error state and back link, never not-found; generic errors remain error without unavailable flag; future version retains own state. Provider fallback unknown id legitimately shows not-found plus banner; opening a failed read writes nothing.
Notice: reusable props-driven notice/toast displays current store.notice, including 保存失败, with accessible alert and explicit dismiss through existing clearNotice. No auto-dismiss timer is added; therefore an old timer cannot clear a newer message (#46 handoff). Do not create a second notice channel or change autosave retry semantics.
Editor wiring: props/context provide provider status across composition boundary; shared components never import src/app/infrastructure. Keep fixed canvas sizing, no overlay hiding the header or text input.
Sibling surfaces: #30 library creates through session repository (no home banner here); #32 will render the shared banner for list/unavailable flows; autosave put classifications and notice slot; #19 inline input; #22 future primary-root notice; error/future/not-found routes.
Required DOM evidence: open success false flag; StorageUnavailable fallback same instance/promise across StrictMode/remount and working put/get; generic open rejection failed, no fallback; obsolete late effect results ignored.
Required DOM evidence: banner true/false; toast from real store save failure retains renamed map, explicit dismiss clears only current notice; a replacement notice is rendered and not auto-cleared; unavailable put shows banner without 保存失败 and never swaps repository.
Required DOM evidence: unavailable get banner+error/no not-found/no writes; unknown fallback id not-found+banner; version/generic errors unchanged; exactly one banner when provider and store both unavailable.
Required browser evidence Private mode: page.addInitScript blocks indexedDB.open before startup; navigate /, click 新建导图, enter editor without document reload, banner visible, real inline rename commits and stays visible after save window. Return through browser history/library and reopen to prove same fallback instance; full reload then not-found+banner and no persisted map.
Required browser evidence Write failure is visible: seed a real IndexedDB map normally; force only IDBObjectStore.put to reject for app writes (quota-style DOMException), perform real inline rename, wait for 保存失败 toast, edited text remains, stored raw record unchanged and no fallback/banner for generic quota failure.
Required browser evidence: zero warning/error/pageerror in both scenarios; screenshots .run/ui-evidence/. Fault injection is browser boundary-only, no test-only application globals/routes/repositories.
Evidence hygiene: vertical red→green saved .workplans/17/review; full prior browser regression stays green; local health start/stop.
Risk-pack commands: pnpm test:unit, pnpm typecheck, pnpm lint (local .omp issue #74), pnpm boundaries, pnpm fmt:check, pnpm docs:check, pnpm decisions:check, pnpm e2e.
Non-goals: library banner (#32), child creation (#20), autosave changes/retries, mid-session repository swapping, schema/config/dependency/API changes, durable memory fallback across full reload.
Rollback: revert fallback/notice wiring; persisted IndexedDB schema untouched. Review focus: one session identity; failure classification; honest no-save UI; reader/store flag combination; notice replacement; public private-mode proof.
```

## Fixture — issue #20 (task 7.2)

```text
Change surface: canvas keyboard creation handling and existing inline-input integration, controlled EditorView action seam, paired tests/e2e, changeset and decision consequence.
Must preserve: #19 input lifecycle, terminal idempotence/IME guard, #21 selection/focus/pan, #17 notices, map factory/root invariant, existing store creation/history/autosave semantics and all browser regression.
Must add: with exactly one selected visible node and no active editor, unmodified Tab calls createNode(selectedId) for last child; unmodified Enter creates next sibling at parent.children index+1, or last child on either primary/floating root.
Governing invariant: each keyboard creation owns one existing creation group; naming commits it once, abandoning cancels it entirely, and no provisional node/expansion leaks to persisted state.
Input gating: no selection/multi-selection, editing!=null, input/textarea/select/contenteditable focus, composition, modifier combinations and repeated keydown must not start creation or steal native text/tab behavior. Prevent default only for handled creation.
Integration: extend existing controlled actions/keyboard seam; use existing createNode, not dispatch add_children independently. Reuse parent lookup logic rather than duplicate traversal. Existing InlineTitleInput handles created edit; no second input implementation.
Creation lifecycle: new empty node immediately selected/input-focused; nonempty commit preserves full text and closes group; blank/whitespace Enter or blur and Escape remove it, restore prior selection, and restore collapsed parent. Terminal Enter/Escape+blur cannot double act.
History: real-store DOM with existing prior edit proves create+name is one undo entry, one undo restores exact precreation map/collapse/selection expectations and prior canUndo remains; redo restores named creation. Cancellation adds no entry and cannot undo prior changes.
Autosave: while group open, debounce/pagehide flush never saves unnamed node or temporary expansion; named group persists after closure; abandoned group never persists provisional content. Reuse store contract, no autosave edits.
Sibling surfaces: InlineTitleInput/EditorView live edit identity; selection-input primary/parent helpers; History grouping; autosave stable-map rule; #23 undo UI and blur-followed-click protection; #32 fallback child flow; menu create actions #27.
Required DOM evidence: Tab child, Enter middle sibling index, roots child/no root movement; collapsed parent third child focus; single selected/no selection/multiple/modifier/repeat/text/IME gates; input native Tab/Enter behavior.
Required DOM evidence: naming one group with exact undo/redo, empty/Escape/blur cancellation on collapsed parent and prior history, no duplicate terminal creation, provisional state absent from repository writes during open group and after cancel.
Required browser evidence: Tab adds child, Tab on collapsed node (expansion/focus/naming portion), Enter primary root, Enter floating root, Name new node (creation/naming portion), Empty new node discarded, plus Enter sibling order and Escape cancellation.
Approved cross-issue proof: #23 runs public Ctrl/Meta+Z for named creation and collapsed-parent re-collapse, and empty-create→Undo click preserving prior edit. No undo buttons/shortcuts or test-only browser store hooks in #20; DOM real-store undo assertions supply history proof here.
Required persistence browser evidence: seed starting map through real IndexedDB; create/name three nodes via public Tab/Enter, wait literal one second, reload; same text, parent relationships and sibling order in DOM/raw record. No direct dispatch or seeded replacement for newly created nodes.
Required evidence hygiene: zero warning/error/pageerror, screenshots .run/ui-evidence/, genuine red→green logs .workplans/20/review, fresh runtime health/start/stop, existing full e2e green.
Commands: pnpm test:unit, pnpm typecheck, pnpm lint (local .omp caveat #74), pnpm boundaries, pnpm fmt:check, pnpm docs:check, pnpm decisions:check, pnpm e2e.
Non-goals: undo toolbar/shortcuts, menus, drag, new selection mechanics, new store behavior, persistence/schema/dependency/config changes.
Rollback: revert shortcut wiring; any named persisted nodes remain valid. Review focus: native field focus, sibling index, key repeat, group cancellation/terminal ordering and no provisional saves.
```

## Fixture — issue #23 (task 7.5)

```text
Change surface: existing controlled canvas keyboard/actions seam, props-driven canvas toolbar, editor composition, paired tests/e2e, changeset and decision consequence.
Must preserve: store History/group/autosave semantics, canUndo/canRedo stack flags during open groups, #19 native inline editing/terminal idempotence, #20 create/cancel/focus, #21 selection/pan, static canvas consumers and all prior browser behavior.
Governing invariant: one public history gesture affects at most one committed history entry; a gesture dismissing an unfinished editor must never accidentally consume unrelated earlier history or call history while its creation group is open.
Shortcuts: Cmd/Ctrl+Z invokes existing undo; Cmd/Ctrl+Shift+Z invokes redo, without requiring a node selection. Reuse shared keyboard and composition/text-focus gates; no Ctrl+Y or parallel document shortcut handler. Existing canvas capture is the scope, including its toolbar; static canvases without history controls remain unaffected.
Text/IME boundary: editing!=null or input/textarea/select/contenteditable target or active focus, composition state/isComposing/keyCode229 leaves native key behavior unprevented and map history unchanged. Unsupported modifiers/keys are not consumed. Handle only the requested history mappings.
Toolbar: accessible buttons named exactly 撤销 and 重做, disabled iff respective canUndo/canRedo is false. Do not mask availability with editing state or change store flags. Normal idle click/keyboard activation calls existing action once; rerenders reflect history state.
Pointer ordering: permit natural pointerdown→input blur→click so the existing editor commits/cancels and closes its group first. A toolbar gesture that begins during editing is inert for map history, even if blur changes editing/availability before click. The next idle gesture must work; no timer heuristic, stale global suppression, blocked blur or second history implementation.
Required cancellation oracle: with prior rename A→B, Tab→leave new title empty→click 撤销 once removes the provisional node but leaves B, prior canUndo and prior redo state unchanged. A second idle 撤销 click restores A. Cover 重做 with available future similarly so cancelled creation does not consume future history. Pointer cancellation must not poison later independent keyboard/click activation.
Sibling surfaces: InlineTitleInput blur/Enter/Escape and live editing identity; creation open group; selection-input text/IME guards; React Flow toolbar event propagation; store prune after undo removes selected child; autosave stable record; static map rendering; future #22 delete and #24 drag reuse the same undo actions.
Required DOM evidence: real EditorSession/store flags drive both button disabled states across commit/undo/redo/new edit; both Ctrl and Meta undo/shift-redo mappings with no selected node; text/editing/IME/modifier boundaries do not prevent default or mutate history; static consumer stays inert.
Required DOM evidence: terminal editor events followed by toolbar activation cannot double act; pointer-start editing guard and subsequent independent activation; available redo survives abandoned creation; no group-open exceptions. Assert exact maps/history flags, not merely callback invocation.
Required browser evidence: original five named scenarios Undo a Tab-created child with Cmd/Ctrl+Z, Redo with Cmd/Ctrl+Shift+Z, Buttons reflect availability, Undo inside the editor, Reload clears history. Native text undo uses actual keyboard typing and changes the draft while committed map/history remain unchanged, not page.fill as a substitute for an undoable edit.
Transferred browser evidence: Name a new node full shortcut sequence proves one creation+naming undo; Tab on a collapsed node proves one undo removes new child and re-collapses parent with original two hidden children intact; empty-create→toolbar Undo preserves prior rename and second click undoes it. Use real public UI, not store globals/dispatch.
Persistence evidence: seed via real IndexedDB, create/name through public UI, wait actual autosave, reload preserves exact map content and shows both history buttons disabled; shortcut cannot change reloaded map. No fake clock or mocked repository in browser.
Evidence hygiene: genuine vertical red→green .workplans/23/review; screenshots .run/ui-evidence/ and zero warning/error/pageerror for new scenarios; full existing browser regression, fresh dev health and stop. OS Safari IME remains synthetic-only, not a native-browser claim.
Commands: pnpm test:unit, pnpm typecheck, pnpm lint (local .omp caveat #74), pnpm boundaries, pnpm fmt:check, pnpm docs:check, pnpm decisions:check, pnpm dead-code, pnpm duplicate-code, pnpm e2e.
Non-goals: History/store/autosave changes, other shortcuts, menus/drag/delete, new dependencies/schema/config/API or persistence of history.
Rollback: revert UI actions/toolbar; persisted maps remain valid. Review focus: event-time edit identity, first-click protection/second-click liveness, native text undo, collapsed creation group reversal and fresh reload flags.
```
