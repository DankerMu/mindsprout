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

## Fixture triage — issue #3 (task 1.1)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree — schema/data-shape trigger; this is the persisted and provider-facing contract)
Blast radius: a wrong schema either admits malformed ops into the reducer (every later slice) or rejects valid provider output in M3
Selected risk packs: Schema / columns / units / field names; Public API / CLI / script entry; Error handling / rollback / partial outputs; Config / project setup (amendment: test-file exemption on domain-is-pure, decision 0006)
Evidence floor: pnpm test:unit (reject + accept + factory scenarios, ≥90% per file); pnpm boundaries; pnpm test:guardrails; pnpm decisions:check; pnpm typecheck; pnpm lint; pnpm dead-code
```

## Fixture triage — issue #4 (task 1.2)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree — persisted data shape and the protocol M3 providers emit; shared-state trigger)
Blast radius: a wrong reducer or inverse corrupts every saved map and makes undo restore a different tree than the user had
Selected risk packs: Schema / columns / units / field names; Public API / CLI / script entry; Error handling / rollback / partial outputs; Concurrency / shared state / ordering
Evidence floor: pnpm test:unit (scenario + rejection + untouched-input + seeded round-trip property, ≥90% per file); pnpm boundaries; pnpm typecheck; pnpm lint; pnpm dead-code; pnpm duplicate-code; pnpm fmt:check
```

## Fixture triage — issue #5 (task 1.3)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree — completes the persisted data shape and provider protocol; shared-state trigger)
Blast radius: a wrong move/attach/detach or replace inverse corrupts saved maps, creates cycles, or makes undo restore a different forest
Selected risk packs: Schema / columns / units / field names; Public API / CLI / script entry; Error handling / rollback / partial outputs; Concurrency / shared state / ordering
Evidence floor: pnpm test:unit (scenarios + rejections + untouched input + seven-op seeded round-trip property, ≥90% per file); pnpm boundaries; pnpm typecheck; pnpm lint; pnpm dead-code; pnpm duplicate-code; pnpm fmt:check
```

## Fixture triage — issue #6 (task 2.1)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override — History, HistoryEntry, HistoryError are a cross-issue public API consumed by #7, #12 and #23; public API is an expanded trigger)
Blast radius: a wrong undo order or a half-applied undo leaves the editor showing a tree the user never had; #7 groups and the #12 store build on this API
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; Resource limits / large input / discovery
Evidence floor: pnpm test:unit (five spec scenarios + atomicity + cap, ≥90% per file); pnpm boundaries; pnpm typecheck; pnpm lint; pnpm dead-code; pnpm fmt:check
```

## Fixture triage — issue #7 (task 2.2)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override — extends the cross-issue History public API consumed by #12/#35/#23, and owns group atomicity: a half-applied group would leave a tree no undo step can restore)
Blast radius: a group that leaks a partial op set, clears redo on cancel, or lets undo run mid-group corrupts the user's history; every multi-select action and every M3 AI session rides on this
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs
Evidence floor: pnpm test:unit (eight spec scenarios + guards + atomicity, ≥90% per file); pnpm boundaries; pnpm typecheck; pnpm lint; pnpm dead-code; pnpm fmt:check
```

## Fixture triage — issue #12 (task 5.1a)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override — the store is the shared-state entrypoint every later UI issue (5.2, 6.x, 7.x, 8.x, 9.x, #35) dispatches through, and it adds a runtime dependency)
Blast radius: a store that mutates state outside applyOp, desynchronises map and History, or swallows group rejections corrupts every edit and undo in the editor
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; Release / packaging / dependency compatibility
Evidence floor: pnpm test:unit (node env; dispatch/undo/groups/runGrouped/rename/viewport/notice, ≥90% per file); pnpm boundaries; pnpm typecheck; pnpm lint; pnpm dead-code (knip: zustand used, no unused deps); pnpm duplicate-code; pnpm fmt:check; pnpm install --frozen-lockfile consistency
```

## Fixture triage — issue #35 (task 5.1b)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override — extends the shared editor-store public API every 6.x–9.x issue reads (selection, editing, creation group), owns the creation-group atomicity, and adds the runtime dependency `nanoid` handed off from #12)
Blast radius: a creation group left open or half-cancelled, a selection pointing at deleted or hidden nodes, or a wrong topmostSelected corrupts history, breaks every shortcut gated on isEditing, or makes group delete/drag act on the wrong nodes
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; Release / packaging / dependency compatibility
Evidence floor: pnpm test:unit (node env; selection, topmostSelected, creation group, rename editing, pruning, rejection, ≥90% per file); pnpm boundaries; pnpm typecheck; pnpm lint; pnpm dead-code (nanoid used); pnpm duplicate-code; pnpm fmt:check; pnpm install --frozen-lockfile; import inventory (no react / bare zustand in application/)
```

## Fixture triage — issue #10 (task 4.1)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (persisted state; the port and its contract suite are what 4.2 IndexedDB, 5.2 autosave, 6.2/6.3 provider and fallback, and 10.x library consume)
Blast radius: a port or contract that allows stamping, shares mutable state with callers, orders the library wrongly, or leaks extra fields into MapSummary silently corrupts saved maps or the library list once 4.2/5.2 build on it; the in-memory adapter is also the real session fallback when IndexedDB is unavailable (D7), not only a test double
Selected risk packs: Public API / CLI / script entry; Schema / columns / units / field names; Concurrency / shared state / ordering; Error handling / rollback / partial outputs
Evidence floor: pnpm test:unit (contract suite against InMemoryMapRepository, error classes, type assertions, ≥90% per file); pnpm boundaries; pnpm typecheck; pnpm lint; pnpm dead-code; pnpm duplicate-code; pnpm fmt:check; import inventory (domain files import only ./types; adapter imports only ../../domain/*)
```

## Fixture triage — issue #11 (task 4.2)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (persisted state and a versioned file format)
Blast radius: this is the only durable store in M1 — a wrong envelope, a lost or reinterpreted record, an error mapped to the wrong class (open failure not surfacing as StorageUnavailableError, a corrupt record read as "not found") or a list that breaks on one bad record loses user maps or hides them from the library; the schemaVersion 1 envelope is the format M2 sync must read
Selected risk packs: Public API / CLI / script entry; Schema / columns / units / field names; File IO / path safety / overwrite; Error handling / rollback / partial outputs; Release / packaging / dependency compatibility; Legacy compatibility / examples
Evidence floor: pnpm test:unit (contract suite under fake-indexeddb, envelope shape, reopen round-trip, version and corrupt-record paths, three open-failure paths, list tolerance; ≥90% per file); pnpm typecheck; pnpm lint; pnpm boundaries; pnpm dead-code (idb used, fake-indexeddb used by tests); pnpm duplicate-code; pnpm fmt:check; pnpm install --frozen-lockfile; licence review (ISC, Apache-2.0 on the allowlist; no CI licence audit)
```

## Fixture triage — issue #8 (task 3.1)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (pure function, no persistence or entrypoint) — override: layoutForest, its returned sizes and the coordinate convention (top-left positions, root at origin, per-tree columns) are a public API read by 3.2, 6.1 rendering and 8.x hit-testing, an expanded trigger
Blast radius: overlapping or misordered nodes on the canvas, a layout that jumps between renders, or hidden descendants getting positions (and so becoming drag targets); no data is touched
Selected risk packs: Public API / CLI / script entry; Release / packaging / dependency compatibility
Evidence floor: pnpm test:unit (spec scenarios, no-overlap property over a generated tree, collapse, determinism, size fallback; ≥90% per file); pnpm typecheck; pnpm lint; pnpm boundaries; pnpm dead-code (d3-hierarchy used; @types/d3-hierarchy is evidenced by typecheck since knip ignores @types/*); lockfile resolves d3-hierarchy 3.1.2; pnpm duplicate-code; pnpm fmt:check; pnpm install --frozen-lockfile; licence review (ISC, MIT)
```

## Fixture triage — issue #9 (task 3.2)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (pure function, no persistence or entrypoint) — override: extends the public layout API (floating placement under the #8 coordinate convention) and adds contentBounds, which 6.2 fit-to-content reads; a public-API expanded trigger, same as #8
Blast radius: floating subtrees drawn at the wrong place or jumping when another tree changes, the primary tree moving when a floating root is dragged, or fit-to-content cropping a far subtree; no data is touched
Selected risk packs: Public API / CLI / script entry; Legacy compatibility / examples
Evidence floor: pnpm test:unit (spec "Move a floating root", far-subtree bounds, anchoring, per-tree independence, every #8 case unchanged except the two named in design "Must preserve"; ≥90% per file); pnpm typecheck; pnpm lint; pnpm boundaries; pnpm dead-code (contentBounds consumed by its test); pnpm duplicate-code; pnpm fmt:check
Deviation from the issue text: `contentBounds(layout)` takes no nodeSize — it reads `layout.sizes` (the size actually used, estimate included), per the #8 integration handoff; a raw nodeSize has no entry for unmeasured nodes
```
