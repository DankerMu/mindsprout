# Proposal

## Why

Issue86 records native mouse presses on disabled Delete or menu padding moving focus to BODY while the menu stays open, so Arrow/Escape no longer reach the menu. Preserve usable menu keyboard focus without changing action ownership or title-input behavior.

## What Changes

- Contain the browser's mouse-focus default at the existing menu boundary.
- Add native-browser regressions for disabled-item and padding presses, plus enabled-action and native title-input compatibility.
- Add a patch changeset; no dependency, schema, application-store or CI changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `canvas-editing`: menu pointer presses preserve keyboard navigation and dismissal.

## Impact

`src/components/canvas/ContextMenu.tsx`, the existing menu browser suite plus a focus-specific suite with shared fixtures, and a patch changeset. Existing menu unit tests remain compatibility coverage. No production interface changes or architectural decision; the local event-default correction is decision-record exempt.

## Triage

- Issue type: bugfix.
- Fixture level: expanded.
- Upstream suggested level: absent; expanded because the menu's shared pointer entrypoint controls native focus across enabled/disabled actions and submenus.
- Blast radius: menu focus, click activation and keyboard dismissal; no persistence or mutation semantics change.
- Selected risk packs: Concurrency / shared state / ordering; Legacy compatibility / examples; Error handling / rollback / partial outputs; Documentation / migration notes.
- Evidence floor: native mouse and keyboard Playwright regression, screenshots and zero console noise; existing menu unit suite, scoped static checks, required CI and review.
