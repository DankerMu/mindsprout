# Proposal

## Why

MindSprout's differentiator (node-level AI growth, streaming ops) needs a canvas that already behaves like a complete mind-map tool before any AI is attached; PRD §8 M1 acceptance is "手动建树、拖拽、布局、本地保存全部跑通，不接 AI 也能当一个普通导图工具用". Today the repo has only the engineering control plane and a placeholder home page.

## What Changes

- Introduce the `map` bounded context domain: `MindMap`, `MindNode`, the `createMindMap` factory and the `TreeOp` protocol with a pure reducer that applies ops and returns their inverses (decision 0003 — TreeOp is the only mutation path for tree state; map metadata `title`/`updatedAt` is set by the application layer). Zod schemas live in `domain/`, which needs decision 0005 (`zod` allowed in `domain/`, `.dependency-cruiser.cjs` + `constraints.yaml` + `AGENTS.md` amended by task 1.0).
- **BREAKING (model)**: `MindMap` becomes a forest — `roots[]` with `roots[0]` as the primary root and further roots as floating subtrees carrying a canvas position. This supersedes the single-root invariant in `CONTEXT.md`, the `MindMap` glossary entry, and `docs/TECH.md` §3; the change ships decision record 0004 and revises those documents (user decision, Stage 1 grill Q4–Q6).
- Extend `TreeOp` with `add_root`, `set_root_position`, and `move_node` detaching to a floating root (`newParentId: null`); `replace_children` is retained for AI use but gets no UI entry in M1.
- Undo/redo as one undo step per applied `TreeOp`, with an atomic grouping API (`beginGroup`/`endGroup`/`cancelGroup`) used by multi-select batch operations and by node creation (create + name = one step) (moved from PRD M6 to M1 — grill Q2); 撤销/重做 toolbar buttons and shortcuts.
- Automatic left-to-right tree layout for the primary tree and for each floating subtree relative to its own position; collapsed nodes hide their subtree.
- Canvas editing UI on `/maps/[id]`: inline title editing, keyboard shortcuts (standard set), multi-select (delete / group-reparent / color over the top-most selected nodes; rename and collapse stay single-node), eight-item registrable context menu, six-token color palette with a 无颜色 entry, plain-text multi-line note panel, collapse/expand, drag-to-reparent, detach-to-floating.
- Map library on `/`: create, open, rename, delete maps; maps persist in the browser (IndexedDB) with a `schemaVersion`, autosave debounced after each op (edits older than the 500 ms window are never lost; a shared in-memory fallback plus banner when storage is unavailable).
- Register `/maps/[id]` in the Playwright key-path walk (`constraints.yaml` `verification.key_ui_paths` marks it pending).

## Capabilities

### New Capabilities

- `map-tree-ops`: the forest model, TreeOp protocol and reducer invariants (no cycles, primary root undeletable, inverse ops).
- `map-undo-history`: undo/redo over applied ops, grouping, history bounds.
- `canvas-layout`: automatic LR layout, floating subtree placement, collapse, pan/zoom.
- `canvas-editing`: node creation/editing/deletion, selection, keyboard shortcuts, context menu, color, note, drag-to-reparent and detach.
- `map-persistence`: browser persistence of maps with schema versioning, autosave and reload fidelity.
- `map-library`: the map list page — create, open, rename, delete.

### Modified Capabilities

- (none — no existing specs under `openspec/specs/`)

## Impact

- New code: `src/contexts/map/{domain,application,infrastructure}` (the map context owns the `MapRepository` port and the browser adapters; `CONTEXT.md` map row revised accordingly), `src/components/canvas/`, `src/app/providers/` (repository provider), `src/app/page.tsx` (library), `src/app/maps/[id]/`, `src/test/dom-shims.ts` (component-test tier).
- New dependencies: `@xyflow/react` (canvas), `d3-hierarchy` + `@types/d3-hierarchy` (layout), `nanoid` (ids), `idb` (IndexedDB), `zustand` (editor store), `fake-indexeddb` (dev, persistence tests), `jsdom` + `@testing-library/react` (dev, component tests). All MIT.
- Documents revised in this change: `CONTEXT.md` (invariants: forest, metadata vs tree state; map and account context rows: `MapRepository` port owned by map), `openspec/glossary.md` (`MindMap`), `docs/TECH.md` §2/§3/§4/§6/§10, `docs/PRD.md` §8 (undo/redo row), `docs/engineering/architecture-discipline.md` (aggregate-root sentence), `decisions/implemented/architecture/0003-treeop-single-mutation-protocol.md` (consequence: store location), new `decisions/implemented/architecture/0004-mindmap-forest-with-primary-root.md`; task 1.0 adds `decisions/implemented/architecture/0005-zod-in-domain.md` and amends `.dependency-cruiser.cjs`, `constraints.yaml` `module_boundaries` and `AGENTS.md ## Directory Map`.
- Verification surfaces: `e2e/smoke.spec.ts` gains `/maps/[id]`; `constraints.yaml` `key_ui_paths` status updated; `vitest.config.ts` gains `setupFiles` for the jsdom component-test tier. The 500-node drag budget (design D11) is review-only Runtime evidence. No API routes, no database schema, no AI calls.

## Fixture triage — issue #2 (task 1.0)

```text
Issue type: refactor
Fixture level: expanded
Upstream suggested level: expanded (agree — constraints.yaml is a Critical Path: gate integrity)
Blast radius: a wrong rule either lets any npm package into domain/ (silent purity loss) or keeps rejecting zod and blocks 1.1
Selected risk packs: Config / project setup; Documentation / migration notes; Release / packaging / dependency compatibility
Evidence floor: pnpm boundaries (zod probe passes, react probe fails on domain-is-pure, probes deleted); regex layout/subpath check; pnpm decisions:check; pnpm docs:check; pnpm test:guardrails; pnpm fmt:check
```
