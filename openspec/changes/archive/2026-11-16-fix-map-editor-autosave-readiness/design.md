# Design

## Context

The failing test awaits `map-editor-ready` and immediately calls the synchronous `nodeWrapper('root')` query. `EditorView` places that marker on the outer editor, while `MindMapCanvas` mounts React Flow beneath it; the marker does not prove React Flow has committed its node wrappers. A neighboring stored-map test already awaits the concrete `rf__node-r`. CI supplied the red stack, while 20 focused and 10 full-suite local baseline runs passed and cannot establish that the race disappeared.

## Goals / Non-Goals

**Goals:**

- Synchronize the existing test with the actual node required by its interaction.
- Preserve every original autosave, identity, text and peer assertion.

**Non-Goals:**

- No production readiness signal, canvas lifecycle, helper API or autosave change without a deterministic production red.
- No increased timeout, retry, skip, sleep, new test abstraction or weakened assertion.

## Decisions

1. Replace only the initial synchronous root-text read with `expect((await screen.findByTestId('rf__node-root')).textContent).toBe('编辑前内容')`. `findByTestId` uses the existing Testing Library wait boundary and the same concrete-node pattern as the neighboring test; subsequent `nodeWrapper('root')` calls then operate on the committed wrapper.
2. Keep the original double-click, rename, fake-timer advance, save payload, target key and peer checks byte-for-byte in behavior. A node that never renders still fails the test at the required concrete condition, so this cannot convert a real render failure into a pass.
3. Do not change `map-editor-ready`: its existing consumers use editor-level readiness, and this issue has no evidence that the marker must imply React Flow node commit. Do not change `nodeWrapper`, which remains a useful synchronous query after the caller establishes readiness.
4. Alternatives rejected: a shared wait helper adds an abstraction for one call site; an arbitrary sleep or increased timeout changes timing rather than the missing condition; a production readiness signal expands scope without evidence of a consumer-visible defect.

## Risks / Trade-offs

The original CI race is not locally reproducible in 30 baseline runs, so the fix is justified by the recorded red stack and the explicit condition ordering, not by a claimed local red/green reproduction. The new wait proves the required condition is established before interaction; the final full coverage suite verifies no regressions but is not presented as proof that the intermittent root cause was otherwise eliminated.
