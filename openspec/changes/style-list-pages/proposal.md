# Proposal: style-list-pages

Issue type: feature
Fixture level: compact
Upstream suggested level: compact (agree: local CSS/module presentation without state or persistence changes)
Blast radius: selector mistakes could hide controls, detach inline target context or alter unrelated pages; visual-only regressions could reduce readability.
Selected risk packs: Legacy compatibility; Documentation.
Evidence floor: computed-style and explicit-list-role browser assertions on both lists, actual screenshots with zero console errors, existing mutation/reset e2e, full unit/static/spec gates and required CI.

## Why

The map library and admin account list still use browser-default bullets, spacing and buttons, making otherwise complete list operations difficult to scan.

## What Changes

- Add one shared CSS module for the two existing page `<main>` elements; do not add global styles, dependencies or a design system.
- Style list rows, times, buttons, inputs and existing inline forms/dialogs while preserving HTML semantics, accessible names and operation behavior.
- Add one presentation requirement per capability, update existing browser evidence and ship a patch changeset.
