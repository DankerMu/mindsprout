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

- New code: `src/contexts/map/{domain,application,infrastructure}` (the map context owns the `MapRepository` port and the browser adapters; `CONTEXT.md` map row revised accordingly), `src/components/canvas/`, `src/app/providers/` (repository provider), `src/app/page.tsx` (library), `src/app/maps/[id]/`; test scaffolding `tests/support/dom-shims.ts` (component-test tier, issue #14).
- New dependencies: `@xyflow/react` (canvas), `d3-hierarchy` + `@types/d3-hierarchy` (layout), `nanoid` (ids), `idb` (IndexedDB), `zustand` (editor store), `fake-indexeddb` (dev, persistence tests), `jsdom` + `@testing-library/react` + its peer `@testing-library/dom` (dev, component tests). All MIT.
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

## Fixture triage — issue #13 (task 5.2)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree): owns the persisted-state write and flush path and how its failures are surfaced
Blast radius: lost edits (a save never fires, or fires with a stale map), a half-made map persisted (an unnamed new node survives reload), save loops or a write per keystroke, opening a map rewriting its updatedAt, failures swallowed or reported as the wrong state (banner vs "保存失败")
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; Legacy compatibility / examples
Evidence floor: pnpm test:unit (fake-timer store cases in design "Fixture — issue #13", every existing editor-store case unchanged; ≥90% per file); pnpm typecheck; pnpm lint; pnpm boundaries; pnpm dead-code; pnpm duplicate-code; pnpm fmt:check
```

## Fixture triage — issue #14 (task 6.0)

```text
Issue type: test
Fixture level: expanded
Upstream suggested level: expanded (agree): shared test configuration (vitest.config.ts) that every later UI task and the mutation run depend on, plus new dev dependencies
Blast radius: existing node tests silently move to jsdom or stop running; UI files can't meet the per-file coverage gate; knip, the lockfile or Stryker break on the new dependencies; a later canvas task cannot render React Flow in tests
Selected risk packs: Config / project setup; Release / packaging / dependency compatibility; Legacy compatibility / examples; Documentation / migration notes
Evidence floor: pnpm test:unit (all existing tests in the node project, the smoke test in the dom project); pnpm typecheck; pnpm lint; pnpm boundaries; pnpm dead-code; pnpm duplicate-code; pnpm fmt:check; pnpm docs:check; pnpm install --frozen-lockfile; pnpm mutation; licence review
Deviations from the issue text:
  - Environment selection: two vitest projects instead of a `// @vitest-environment jsdom` docblock. A `dom` project runs src/**/*.test.tsx in jsdom with the shim setup file; a `node` project runs src/**/*.test.ts with no setup file. Reason: in a single-project config, `setupFiles` is global, so the issue's design would load the shim module, @testing-library/react and react-dom, and register a DOM cleanup hook, in every one of the 24 existing node test files. The shim would also need a `typeof window` guard. Projects scope the DOM setup to DOM tests and make the environment follow the file extension, so a forgotten docblock cannot exist. knip is clean either way: it reads both docblocks and `test.projects`.
  - Shim location: tests/support/dom-shims.ts instead of src/test/dom-shims.ts. Reason: tests/support/ is already the single home for test scaffolding. Under src/ the shim would need a paired test (scripts/check-test-pairing.sh) and 90% coverage of scaffolding, and it would create a second home for test helpers.
  - Smoke component: defined inside src/components/canvas/smoke.test.tsx. Reason: the issue's PR boundary says "no production code", and AGENTS.md forbids placeholder code, so a src component used only by a test would be fake production code. The per-file coverage criterion for a .tsx source under jsdom is instead proven by an uncommitted probe (design "Fixture — issue #14", Required evidence).
```

## Fixture triage — issue #15 (task 6.1)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact. Override: adds a runtime dependency (@xyflow/react) and the public canvas component that 6.2, 7.x, 8.x and 9.x build on, plus a measure→re-layout feedback loop whose convergence is a correctness property. These are the dependency and public-API expanded triggers; the same override was made for #8 and #9.
Blast radius: overlapping or misplaced nodes, a layout that never settles or re-lays out on every frame, wrong collapse counts or note/color indicators, zoom beyond 25–200%, fit-to-content cropping a floating subtree, React Flow state drifting from the map
Selected risk packs: Public API / CLI / script entry; Release / packaging / dependency compatibility; Concurrency / shared state / ordering; Resource limits / large input / discovery
Evidence floor: pnpm test:unit (node-env pure helpers plus jsdom component tests, ≥90% per file); pnpm typecheck; pnpm lint; pnpm boundaries; pnpm dead-code; pnpm duplicate-code; pnpm fmt:check; pnpm docs:check; pnpm install --frozen-lockfile; licence and release-age check for @xyflow/react
Also carried here, as #14 review handoffs (comment on #15):
  - tests/support/dom-shims.ts sets IS_REACT_ACT_ENVIRONMENT
  - the architecture-discipline coverage bullet names the route-component exemption
```

## Fixture triage — issue #16 (task 6.2)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override). This issue adds:
  - the composition root's session-wide repository provider (shared state, persisted-state access);
  - the public `/maps/[id]` route and its error states;
  - the flush-on-leave path for persisted edits;
  - the e2e seed infrastructure that #18–#20 reuse.
  These are the persisted-state, shared-entrypoint and public-surface expanded triggers.
Blast radius:
  - a map that silently shows not-found when it actually failed to load, or a crash instead of an error state;
  - opening a map that rewrites it;
  - edits lost when the user leaves the page or navigates away;
  - a second repository instance per page;
  - a canvas with zero height or React Flow warnings in dev.
Selected risk packs:
  - Public API / CLI / script entry
  - Concurrency / shared state / ordering
  - Error handling / rollback / partial outputs
  - File IO / path safety / overwrite (scoped to "opening never writes" in browser storage)
  - Release / packaging / dependency compatibility (first pnpm build of the canvas)
Evidence floor:
  - pnpm test:unit (dom tests for the provider, MapEditor, EditorSession, EditorView and MapStatus; ≥ 90% per non-route file)
  - pnpm e2e (the named scenarios with zero console errors and warnings)
  - pnpm build
  - pnpm typecheck, lint, boundaries, dead-code, duplicate-code, fmt:check, docs:check
Scope notes:
  - The provider's open failure renders the error state until 6.3 (#17) replaces it with the fallback. #17's text "the provider (6.2) always resolves IndexedDB" describes exactly this.
  - Also folds in the #15 handoff: the "Fixture — issue #15" header now reads toFlowElements(map, layout, measured).
```

## Fixture triage — issue #21 (task 7.3)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override: connects the shared editor selection state to pointer events, keyboard focus and React Flow's controlled projection).
Blast radius: selection drift between canvas and store; keyboard actions escaping a text field; hidden nodes selected; pan gestures changing selection.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: genuine red→green DOM behavior tests with real editor store; full unit per-file coverage ≥90%; real-browser selection scenarios with screenshots and zero unexpected console noise; typecheck, boundaries, lint, format, docs and decisions checks.
Scope: task 7.3 only. Existing canvas-editing Selection and Shortcuts requirements are the spec delta; no acceptance text changes.
Queue deviation: #21 precedes #19 because #19's three-selected-node F2 scenario needs this public selection UI; neither issue gains the other's behavior.
```

## Fixture triage — issue #19 (task 7.1)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override: first public edit path connects focus/IME and shared editing state to undo and persisted autosave).
Blast radius: duplicate commits, wrong-node rename under multi-selection, stuck editing after input removal, keystrokes leaking to canvas, renamed text lost after save window.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: genuine red→green real-store DOM integration, ≥90% per-file coverage, named browser scenarios through real IndexedDB, screenshots and zero unexpected browser noise, typecheck/boundaries/lint/format/docs/decisions.
Scope: existing-node title editing only; existing canvas-editing Inline title editing and map-persistence Autosave deltas remain the oracle.
Queue deviation: selection issue #21 landed first to make the three-selected-node scenario executable through real public UI.
```

## Fixture triage — issue #30 (task 10.1)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override: shared home entrypoint creates persisted maps and navigates only after a successful write).
Blast radius: duplicate maps from repeated create, navigation before persistence, unreadable library mistaken for empty, stale async list replacing newer state.
Selected risk packs: Public API / CLI / script entry; File IO / path safety / overwrite; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: genuine red→green component behavior tests with real repository where possible, ≥90% per-file coverage, real IndexedDB create/ordering browser scenarios and unchanged home smoke, zero browser noise/screenshots, typecheck/lint/boundaries/docs/decisions/format.
Scope: home list, empty state, create/open. Existing map-library Create/List delta is the oracle; rename/delete and unavailable-home banner remain separate tasks.
Queue deviation: #30 precedes #17 so the latter can create a fallback-session map through public UI before its private-mode inline rename.
```

## Fixture triage — issue #17 (task 6.3)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override: changes shared session repository resolution and user-visible persistence-failure classification).
Blast radius: different fallback stores across routes, false save assurance, lost in-session maps, open errors swallowed, stale notices clearing newer failures.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: genuine red→green DOM/provider integration, full ≥90% per-file coverage, real-browser blocked IndexedDB public create/rename and failed-write scenarios, zero unexpected console noise/screenshots, typecheck/lint/boundaries/format/docs/decisions.
Scope: provider fallback, editor banner and notice, unavailable get handling. Existing map-persistence Storage unavailable delta is oracle; library banner remains #32.
Queue prerequisite resolved: #30 public creation now bootstraps an empty fallback through real UI, no seed hook or implicit creation on unknown ids.
```

## Fixture triage — issue #20 (task 7.2)

```text
Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override: keyboard creation opens a shared undo group spanning input focus and autosave).
Blast radius: duplicate nodes, wrong sibling/root placement, unnamed nodes persisted, abandoned creation corrupting earlier history or collapse state.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: genuine red→green real-store DOM integration, ≥90% per-file coverage, public browser creation scenarios and real IndexedDB one-second reload, screenshots/zero browser noise, typecheck/lint/boundaries/format/docs/decisions.
Scope: creation shortcuts over existing createNode/commitTitle/cancelEdit, no new store semantics or undo UI.
Owner-approved scenario ownership: #23 executes public Cmd/Ctrl+Z portions of Name a new node and Tab on a collapsed node, plus empty-create→toolbar Undo protection. #20 proves complete history/collapse invariants with real-store DOM and public creation behavior. Spec/task wording unchanged; approvals posted on both issues.
```

## Fixture triage — issue #23 (task 7.5)

```text
Issue type: feature
Fixture level: expanded
Reason above suggested compact: toolbar pointerdown→blur→click crosses the live creation group and earlier history; owner-transferred public undo scenarios require cross-surface state evidence.
Blast radius: one gesture cancels a provisional node and accidentally undoes an unrelated entry; shortcuts steal native text undo or invoke history while a group is open.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: genuine red→green real-store DOM tests, ≥90% per-file coverage, original five browser scenarios plus owner-transferred creation/collapse/cancel regressions, real IndexedDB reload, screenshots/zero browser noise, existing full e2e and scoped checks.
Scope: task 7.5 UI adapters only; reuse store undo/redo and shared keyboard/input gates. No history, persistence or creation semantics changes.
```

## Fixture triage — issue #32 (task 10.3)

```text
Issue type: feature
Fixture level: compact
Reason: mechanical library wiring to #17's proven session fallback/banner; no new repository lifecycle or error classification.
Blast radius: the library falsely implies session maps are durable, or navigation/reload acceptance hides a second fallback instance.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: real-provider fallback DOM red→green, two named blocked-storage browser scenarios with public child creation and shared-session reopen, screenshots/zero browser noise, affected coverage and scoped gates.
Scope: library banner wiring, existing tests and release note; provider/repository/editor/autosave behavior unchanged.
```

## Fixture triage — issue #22 (task 7.4)

```text
Issue type: feature
Fixture level: expanded
Reason above suggested compact: destructive grouped store action crosses protected-root filtering, selection normalisation, editing ownership, undo/redo and persistence; owner resolved contradictory algorithm prose.
Blast radius: selecting the primary root either wrongly protects its selected descendants or deletes unrelated nodes; double-delete rejects a group; partial state or native text keys consume user history.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: exact-map store/DOM red→green, per-file≥90%, five public browser scenarios with real undo, stable grouped autosave proof, full browser regression and scoped gates.
Scope: task7.4 only; protect the root itself by excluding it before normalisation, as explicitly selected by owner. Existing scenario outcomes and generic topmostSelected contract unchanged.
```

## Fixture triage — issue #24 (task 8.1)

```text
Issue type: feature
Fixture level: expanded
Reason above suggested compact: first controlled drag bridges screen/flow coordinates, transient React Flow positions, authoritative layout, refusal/reset, TreeOp dispatch and public undo.
Blast radius: wrong grab-offset placement, stale drop target, silent primary-root/cycle mutation, refused nodes stranded at temporary coordinates, or React Flow moving multiple selected nodes before group drag exists.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: pure geometry/refusal/planning red→green, real-store/component interaction proof, named browser drag/undo/refusal and floating-root branches, per-file≥90%, real IndexedDB readback, screenshots/zero browser noise and full regression.
Scope: task8.1 single-node drag only; existing TreeOps/layout/history remain canonical. Group drag and 500-node profiling remain #25/#26.
```

## Fixture triage — issue #27 (task 9.1)

```text
Issue type: feature
Fixture level: expanded
Reason above suggested compact: a shared menu entrypoint combines selected-vs-targeted destructive actions, creation editing groups, layout coordinates and stale menu ownership.
Blast radius: right-click alters the wrong selection, deletes unrelated nodes, detaches at screen coordinates, runs against a stale map, or menu keys leak into canvas shortcuts.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: chronological vertical red→green registry and real-store DOM behavior, four named browser scenarios plus target/selection and native keyboard boundaries, exact undo/persistence, per-file≥90%, screenshots/zero browser noise and scoped gates.
Scope: six ops-only items and registry; existing canvas-editing Context menu/item scope/Detach and canvas-layout Collapse and expand deltas remain the oracle. Eight-item scenario belongs to #29; color and notes remain #28/#29.
```

## Fixture triage — issue #18 (task 6.4)

```text
Issue type: test
Fixture level: expanded
Upstream suggested level: expanded (agree: constraints.yaml gate-integrity Critical Path and AGENTS.md owner-governed note).
Blast radius: metadata claims a route is covered while the smoke walk only sees an app shell, or registering the editor loses home coverage/noise detection.
Selected risk packs: Config / project setup; Public API / CLI / script entry; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: fresh production smoke walks both routes with route-specific readiness, real seeded IndexedDB and screenshots/zero console errors; pnpm test:guardrails; scoped static/docs gates; full-depth cross-review and explicit owner acceptance of the AGENTS note before merge.
Scope: existing smoke.spec.ts plus two metadata/note edits; no new product scenario, source behavior, thresholds, dependencies or feature changes. Existing route spec remains the oracle.
```

## Fixture triage — issue #25 (task 8.2)

```text
Issue type: feature
Fixture level: expanded
Reason above suggested compact: normalized shared selection, multiple tree mutations in one undo group, controlled subtree previews and native cancellation ownership cross persisted state and ordering.
Blast radius: nested nodes move twice, grabbed-descendant offsets jump, group append order drifts, primary root slips through deletion-style filtering, partial groups persist, or abort leaves sibling previews/autopan alive.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: generalized planner and real-store DOM red→green; four named group browser scenarios plus primary/mixed-floating/native abort branches; exact single-node regressions retained; per-file≥90%, exact undo/persistence and zero browser noise.
Scope: task8.2 only; extend/rename existing drag path atomically. Owner chose drag-start visual y/x order with stable traversal ties; generic normalizer unchanged. Existing specs remain oracle.
```

## Fixture triage — issue #26 (task 8.3)

```text
Issue type: test/performance evidence
Fixture level: expanded
Reason above suggested compact: acceptance depends on a qualified native-frame oracle and possible shared-layout cache invalidation; raw frame slots were empirically shown to hide severe jank.
Blast radius: a fake passing performance number, a nonrepresentative/idle workload, or stale measured geometry from premature memoization.
Selected risk packs: Resource limits / large input / discovery; Public API / CLI / script entry; Legacy compatibility / examples; Documentation / migration notes; Concurrency / shared state / ordering (conditional memoization).
Evidence floor: exact500-node deterministic fixture used in real e2e seed; qualified native Performance recording, three retained two-second samples with p50≤16.7ms/p95≤33ms and named environment; no CI timing gate. Production changes require semantic regression coverage first.
Scope: task8.3 only. Existing caching is measured before any optimization; issue handoff corrects D11 cache inputs to map/nodeSize/gap. No budget relaxation.
```

## Fixture triage — issue #28 (task 9.2)

```text
Issue type: feature
Fixture level: expanded
Reason above suggested compact: the shared registry gains submenus, focus ownership crosses nested menus, and selected-node updates share one persisted history group.
Blast radius: parent selection hides child colors, a stale submenu updates the wrong map, keyboard input leaks to canvas actions, or selected styling masks the chosen token.
Selected risk packs: Public API / CLI / script entry; Concurrency / shared state / ordering; Error handling / rollback / partial outputs; File IO / path safety / overwrite; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: chronological real-store and DOM red→green, three named browser scenarios, native submenu keyboard/dismissal and light/dark rendering, exact one-step undo/persistence, affected per-file≥90% and full browser regression.
Scope: task9.2 only; six fixed semantic tokens plus clearing. Notes, free-form colors, a theme-switching UI and the independent existing disabled-menu focus defect remain separate.
```
