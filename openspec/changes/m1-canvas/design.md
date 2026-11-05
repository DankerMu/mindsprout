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

| op                  | payload                                                                                                                 | notes                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_children`      | `parentId`, `children: NewNode[]`, `index?`                                                                             | inserts whole subtrees at `index` (default: append); ids are generated by the caller (`nanoid`) so the op is replayable                                                                           |
| `add_root`          | `node: NewNode`, `position`, `index?`                                                                                   | creates a floating root at roots index `index` (≥ 1, default: append); never creates a primary root                                                                                               |
| `update_node`       | `id`, `text?`, `note?: string \| null`, `color?: ColorToken \| null`, `collapsed?`                                      | partial update: an absent field is untouched, `null` clears `note`/`color`; `position` is not updatable here                                                                                      |
| `delete_node`       | `id`                                                                                                                    | rejected for `roots[0]`; deletes the subtree (tree node or floating root)                                                                                                                         |
| `move_node`         | `{ id, newParentId: NodeId, index? }` \| `{ id, newParentId: null, position, index? }` (discriminated on `newParentId`) | non-null: reparent (attaches a floating root and drops its position); `null`: detach a tree node into a floating root at `position` (roots `index` ≥ 1, default: append); rejected for `roots[0]` |
| `set_root_position` | `id`, `position`                                                                                                        | floating roots only                                                                                                                                                                               |
| `replace_children`  | `parentId`, `children: NewNode[]`                                                                                       | swaps the whole child list; retained for AI (M3+); no M1 UI                                                                                                                                       |

`applyOp(map, op): { map, inverse: TreeOp[] }` is a pure function in `domain/`. `inverse` is the ordered list of ops that restores the input map exactly (most ops invert to one op; `add_children` with n children inverts to n `delete_node`s in reverse order). It throws a typed `TreeOpError` with a `code` instead of silently no-op-ing (AGENTS.md: misconfiguration fails loud):

| rejection                                                                                                                                                                                                                               | `TreeOpError.code`                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| payload fails the Zod schema: missing field, unknown key (e.g. `position` on a `NewNode`), `move_node` with `null` and no `position`, `move_node` with a non-null parent and a `position`                                               | `invalid-op` (wraps the `ZodError` issues; no tree traversal happens) |
| `id`, `parentId` or `newParentId` not present in the map                                                                                                                                                                                | `unknown-node`                                                        |
| `delete_node`, `move_node` or `set_root_position` targeting `roots[0]`                                                                                                                                                                  | `primary-root-protected`                                              |
| `move_node` whose new parent is the moved node or one of its descendants                                                                                                                                                                | `cycle`                                                               |
| `add_children` / `add_root` / `replace_children` introducing an id already in the map (for `replace_children`: outside the replaced subtree) or duplicated inside the payload                                                           | `invalid-target`                                                      |
| `set_root_position` on a node that is not a floating root; `move_node` with `null` on a node that is already a floating root; `index` out of range (`add_root`/detach `index` 0 or > `roots.length`, child `index` > `children.length`) | `invalid-target`                                                      |

Inverses: `add_children` → `delete_node` per inserted child (reverse order); `add_root` → `delete_node`; `update_node` → `update_node` with the previous values (`null` when `note`/`color` was absent, `false` when `collapsed` was absent); `delete_node` → `add_children` with the removed subtree as a `NewNode` (including `collapsed` and all descendants) at the original `index`, or `add_root` with the subtree, its `position` and its roots `index`; `move_node` → `move_node` back to the original parent and index, or `{ newParentId: null, position, index }` when the node was a floating root; `set_root_position` → `set_root_position` with the previous position; `replace_children` → `replace_children` with the previous children as `NewNode`s.

Zod schemas for every op live beside the types in `domain/` so M3 provider output validation reuses them (Important Development Note 2). Importing `zod` from `domain/` is currently rejected by `.dependency-cruiser.cjs` `domain-is-pure` (`dependencyTypesNot: ['core']` blocks every npm import); task 1.0 amends that rule to allow `zod` alone, mirrors the allowance in `constraints.yaml` `module_boundaries` and `AGENTS.md ## Directory Map`, and ships decision record 0005 ("zod is a schema language, not a framework; the TreeOp schema is a domain contract"). Re-exporting `zod` through `src/shared/` was rejected: it would satisfy the rule text while hiding the dependency the rule exists to make visible.

Alternative: immutable snapshot history (zundo) — rejected: snapshots of a 500-node map per keystroke-level op cost memory, and inverse ops make "one op = one undo step" and AI-session grouping trivial. `docs/TECH.md` §2 drops the zundo mention.

### D3. Undo history as an inverse-op stack with explicit groups (grill Q2, Q8)

`History { past: Entry[], future: Entry[] }`, `Entry = { ops: TreeOp[], inverses: TreeOp[][], label }` (`inverses[i]` is the inverse list of `ops[i]`). Undo applies `inverses[n-1] … inverses[0]`, each list in its own order; redo re-applies `ops` in order. `dispatch(op)` outside a group applies, pushes `{ ops: [op], inverses: [inverse] }` and clears `future`. History is capped at 200 entries (oldest dropped). `canUndo` / `canRedo` are derived flags the UI binds to (D10). History lives in the Zustand editor store, not in the persisted map.

**Groups.** `beginGroup(label)` opens a group; every `dispatch` until `endGroup()` is applied immediately but recorded into the open group; `endGroup()` pushes one entry holding all of them (and clears `future`). Rules, each with a scenario in spec map-undo-history:

- `beginGroup` while a group is open throws `group-open`; `endGroup`/`cancelGroup` with no open group throw `no-group`.
- A `dispatch` whose op is rejected by the reducer inside a group **cancels the group**: the inverses of the ops already applied in that group are applied in reverse, no entry is pushed, and the `TreeOpError` is rethrown. Groups are atomic — "one AI session is one undo unit" (CONTEXT.md) only holds if a half-applied session can never be left behind. The M1 UI never relies on this path: it filters the primary root and normalises the selection (D5) before dispatching.
- `cancelGroup()` does the same revert on request and pushes nothing.
- `endGroup()` after zero applied ops pushes nothing.
- `undo()` / `redo()` while a group is open throw `group-open`; M1 groups are synchronous so the UI never hits this, and M3 decides whether streaming sessions auto-close.

Multi-select delete / group reparent / color use groups through one store helper `runGrouped(label, fn)` (begin, run, end; cancel on throw) (grill Q9); M3 AI sessions reuse the primitives.

**Node creation is a group.** Tab / Enter / 添加子节点 call `createNode(parentId, index?)`: `beginGroup('add node')`, dispatch `add_children` with an empty-text node, select it and open the inline editor. When the parent is collapsed, `createNode` first dispatches `update_node { id: parentId, collapsed: false }` inside the same group so the new child is rendered and its editor can take focus; that expand is part of the creation entry, so one undo removes the child and re-collapses the parent, and `cancelGroup()` re-collapses it too. Committing a non-empty title dispatches `update_node` and `endGroup()` — creating and naming a node is **one** undo step. Committing an empty title, or pressing Esc on a node created this way, calls `cancelGroup()`: the node is removed and no entry exists. Renaming an existing node is a single ungrouped `update_node` on commit; Esc discards without dispatching.

### D4. Layout: d3-hierarchy `tree()` per root, LR by axis swap (grill Q3)

`layoutForest(map, { direction: 'LR', nodeSize, gap })` → `{ positions: Map<NodeId, {x,y}>, edges }`. Primary tree is laid out from origin; each floating subtree is laid out from its own `position`. Collapsed nodes contribute no descendants. Node dimensions are measured (`ResizeObserver` in the custom node component, task 6.1) and fed back as `nodeSize` per node; a first pass uses estimated width from text length so the first paint has no jump. The function is pure and lives in `application/layout/`, tested without React.

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
