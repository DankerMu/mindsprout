# Proposal

## Why

The canvas opens at the library default viewport, so ordinary sibling layouts can place nodes outside the visible region. New nodes can likewise be created off-screen, blocking basic manual map editing.

## What Changes

- Fit the measured map content once when a map opens, with padding and zoom between the existing minimum and 100%.
- Bring a newly created or title-edited node into view with the smallest necessary pan, without changing zoom or refitting later edits.
- Either connect the editor viewport state to the canvas or remove it; do not persist viewport state.
- Add browser coverage for opening, reopening, sibling creation, and off-screen editing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `canvas-layout`: define initial framing and automatic visibility for nodes being created or edited.

## Impact

Affects the React Flow canvas, editor viewport state, canvas unit tests, and Playwright canvas coverage. No HTTP API, persisted schema, dependency, or layout-coordinate change.

## Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent (agree; shared canvas state and measurement ordering require expanded review)
Blast radius: broken viewport control can hide or move every map's nodes and regress manual pan, zoom, and selection
Selected risk packs: concurrency/shared state/ordering; resource limits/large input; legacy compatibility/examples; documentation/migration notes
Evidence floor: red-to-green behavior tests, `pnpm test:unit`, targeted Playwright canvas and large-map tests, `pnpm dead-code`, static checks, and strict OpenSpec validation
