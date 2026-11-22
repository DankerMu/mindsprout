# Tasks

## Risk packs

- Public API / CLI / script entry: not selected; no public entrypoint changes.
- Config / project setup: not selected; no configuration or dependency changes.
- File IO / path safety / overwrite: not selected; viewport work performs no file IO.
- Schema / columns / units / field names: not selected; map and persistence formats stay unchanged.
- Auth / permissions / secrets: not selected; no identity or credential surface changes.
- Concurrency / shared state / ordering: selected; measurement completion, map identity, and viewport ownership determine correctness.
- Resource limits / large input / discovery: selected; initial framing must not break the 500-node opening scenario.
- Legacy compatibility / examples: selected; layout coordinates, manual fit/pan/zoom, selection, and persistence must remain intact.
- Error handling / rollback / partial outputs: not selected; no new fallible IO or output publication path.
- Release / packaging / dependency compatibility: not selected; no package or release surface changes.
- Documentation / migration notes: selected; canvas-layout requirements and the decision record ship with implementation.

## 1. Measured initial framing

- [x] 1.1 Add one focused failing browser scenario for single-node and measured multi-node opening, demonstrate it red against the pre-change canvas, then implement once-per-map measured framing and verify it green with the same scenario.
- [x] 1.2 Connect or remove editor viewport state according to `design.md`, add focused coverage for the chosen ownership and stale map/measurement ordering, and record the non-trivial decision using the decision-record lifecycle with `pnpm decisions:check`.

## 2. Creation and editing visibility

- [x] 2.1 Add a failing browser scenario for two keyboard-created siblings and reopening without manual fit, then implement the required visibility behavior and verify both children are visible and clickable.
- [x] 2.2 Add failing coverage for an off-screen creation/editing target, unchanged zoom, minimum necessary pan, and no movement for an already visible target; implement and verify each behavior red-to-green through the canvas interface.

## 3. Compatibility and integration evidence

- [x] 3.1 Update canvas-editing browser setup so initial visibility is tested rather than bypassed, retain explicit coverage of the fit control itself, and verify existing selection, pan/zoom, and unchanged-persistence assertions pass.
- [x] 3.2 Extend the deterministic 500-node browser input with explicit expected output: zoom is exactly 25%, the measured content bounds are centered, the primary root is visible, all 500 nodes remain rendered, and no zoom below the floor occurs; then verify selected risk packs and the full changed surface with `pnpm test:unit`, `pnpm e2e e2e/canvas-editing.spec.ts`, `pnpm e2e e2e/large-map.spec.ts`, `pnpm dead-code`, `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm build`, and `openspec validate keep-canvas-content-visible --strict --no-interactive`; capture UI screenshots and require zero console warnings/errors.
