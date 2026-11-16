# Proposal

## Why

CI run43792218217 failed the existing matching-identity autosave test when `map-editor-ready` was visible but the synchronous React Flow root-wrapper query threw `node root is not rendered`. The marker and the asynchronously committed node are different readiness conditions; the test must wait for the concrete node it operates on rather than assuming the marker includes it.

## What Changes

- In the existing autosave acceptance test, wait for `rf__node-root` after the editor marker and before the original text/double-click/edit assertions.
- Preserve the node text, rename, 500ms autosave payload, matching key and peer-record assertions unchanged.
- Make no production/readiness-contract change and add no timeout increase, test retry, skip, weakened assertion or parallel implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-library`: the matching-identity autosave acceptance walk waits for its actual root node before interaction, while preserving the existing persistence outcome.

## Impact

Only `src/app/maps/[id]/MapEditor.test.tsx` and this change's artifacts are affected. No runtime source, API, dependency or user-visible behavior changes, so no changeset or new decision record is required. Evidence includes the original CI red stack, 20 focused plus 10 full-suite baseline runs that did not reproduce locally (not proof that the race vanished), and a final full `pnpm test:unit` coverage run.

## Issue #205 Fixture Triage

Issue type: bugfix
Fixture level: compact
Upstream suggested level: absent (compact: one isolated test-synchronization change with diagnosis and full-suite evidence)
Blast radius: an incorrect fix could hide a real canvas lifecycle defect or weaken matching-ID autosave/peer preservation; leaving the synchronous read can intermittently fail the required unit gate.
Selected risk packs: render-readiness ordering; autosave/key/peer preservation; test-evidence fidelity; scope control.
Evidence floor: retain CI `node root is not rendered` as the red observation; distinguish marker readiness from actual root commit and do not claim a production defect from green controls. Wait for `rf__node-root` before the unchanged interaction and assertions. Full unit coverage, lint/typecheck/format, dead-code/duplicate checks and strict OpenSpec validation pass. No production change unless a deterministic red demonstrates one, no increased timeout/retry/skip, no changeset or new decision record.
