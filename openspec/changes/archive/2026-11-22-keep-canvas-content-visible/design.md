# Design

## Context

Change surface: `MindMapCanvas`, its fit control and measured-size flow, editor viewport state, and canvas browser tests.
Must preserve: the primary root stays at layout origin; floating roots keep stored positions; manual fit frames all roots; Space/middle-drag panning, 25–200% wheel zoom, selection, and map persistence are unchanged.
Must add/change: one measured initial fit per map opening, capped at 100%; minimum pan for an off-screen creation/editing target; no unused viewport state remains.
Governing invariant: automatic viewport movement never changes map data and never overrides later manual navigation except to reveal the active creation/editing target.

## Goals / Non-Goals

**Goals:**

- Open new and existing maps with every visible node box inside the padded canvas when the measured content fits within the zoom limits; center oversized content at the 25% floor.
- Keep keyboard-created and title-edited nodes reachable without a manual fit.
- Make viewport ownership explicit and covered by tests.

**Non-goals:**

- No viewport persistence, layout algorithm change, minimap, AI-stream following, header navigation, or new dependency.

## Decisions

- Reuse the existing `contentBounds` rectangle and fit-button geometry rather than React Flow's independent `fitView` contract. This keeps manual and initial fitting on the same layout projection.
- Start the initial fit only after the first rendered node measurements replace estimates; run it once per map opening, not after every layout change. A single-node map remains at 100% rather than being enlarged.
- Use the existing zoom limits, with initial zoom no greater than 100%. Do not add a second viewport calculation or alter layout coordinates. If measured bounds cannot fit at 25%, center those bounds at 25%; the existing zoom floor takes precedence over full visibility.
- For an off-screen creation/editing target, apply the smallest translation that reveals its measured box with padding; preserve zoom and leave on-screen targets untouched.
- Prefer connecting the existing editor viewport state if that produces one owner without render feedback; otherwise remove the unused state and its tests. The implementer must record the chosen ownership in the required decision record.
- Sibling surfaces: measured layout, `contentBounds`, manual fit, canvas mount/map switching, editor store load, creation/editing state, and Playwright tests that currently click fit before acting.
- Seams under test: public canvas browser behavior first; focused unit tests only for viewport ownership and geometry edges that jsdom cannot establish.

## Risks / Trade-offs

- [Measurements arrive asynchronously or a map changes mid-fit] → Gate on the current map and complete measured set; prove stale work cannot move a replacement map.
- [Automatic movement fights manual pan/zoom] → Initial fit runs once; subsequent movement is limited to an off-screen active target and preserves zoom.
- [Fitting estimated rather than rendered boxes clips nodes] → Browser assertions use actual node and canvas rectangles after measurements settle.
- [A 500-node map regresses opening or rendering] → Assert 25% zoom, centered measured bounds, a visible primary root, and all 500 rendered nodes in the large-map browser scenario; check console output.
- Required evidence: opening a single node yields padded full visibility at 100%; opening/reopening siblings yields clickable in-canvas boxes; panning away then creating/editing reveals only the target with unchanged zoom; existing fit, pan, selection, and persistence checks remain green.
- Review focus: measured readiness, once-per-map semantics, zoom clamps, minimum-pan behavior, stale asynchronous work, and removal or connection of store viewport state.
