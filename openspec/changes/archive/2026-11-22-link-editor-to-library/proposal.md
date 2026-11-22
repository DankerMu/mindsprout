# Proposal

## Why

The ready editor has no route back to the library. Direct/deep links have no browser history to use, so switching maps requires editing the URL; error states already have a return entry that normal editing lacks.

## What Changes

- Add a visible keyboard-focusable `返回导图列表` link targeting `/` in the ready editor header.
- Verify immediate navigation after an edit preserves the latest list ordering/title and reopened tree through the existing unmount flush.
- Preserve not-found/error back-link behavior and autosave semantics; do not add a global header, admin link or leave-warning.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-library`: define normal-editing navigation back to the library.

## Impact

EditorView, paired component coverage, map-editor/library browser tests, changeset and map-library spec. No API or persistence format change.

## Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: absent (override: shared editor header plus unmount/save navigation ordering)
Blast radius: navigation before flush can lose edits; misplaced link can bypass ready editor or alter status-page behavior
Selected risk packs: concurrency/shared state/ordering; legacy compatibility/examples; documentation/migration notes
Evidence floor: deep-link keyboard navigation, immediate edited-tree return/reopen, newest list title/order, error-state regressions, full E2E and strict OpenSpec validation
Design.md included for link ownership and flush timing.
