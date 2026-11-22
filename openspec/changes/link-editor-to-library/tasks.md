# Tasks

## Risk packs

- Public API / CLI / script entry: not selected; no HTTP or CLI contract changes.
- Config / project setup: not selected; no dependency or configuration changes.
- File IO / path safety / overwrite: not selected; fixed same-origin `/` navigation introduces no path parser or file operation.
- Schema / columns / units / field names: not selected; stored map shape is unchanged.
- Auth / permissions / secrets: not selected; existing signed-in library behavior and session menu are unchanged.
- Concurrency / shared state / ordering: selected; client navigation must preserve the existing unmount flush and ordered save/read behavior.
- Resource limits / large input / discovery: not selected; one constant header link adds no unbounded work.
- Legacy compatibility / examples: selected; status links, editor header/title, autosave and library behavior must remain intact.
- Error handling / rollback / partial outputs: not selected; existing save-failure handling is unchanged and no new side effect is introduced.
- Release / packaging / dependency compatibility: not selected; no package changes.
- Documentation / migration notes: selected; map-library requirement and patch changeset ship with the UI change.

## 1. Ready-editor navigation

- [x] 1.1 Add component coverage for a visible keyboard-focusable `返回导图列表` link with `href="/"` in the ready header, implement it in `EditorView` with `next/link`, and verify the paired test and coverage.
- [x] 1.2 Add browser coverage for direct-opening and keyboard activation, plus edit → immediate return → newest title/order → reopen latest tree; verify persisted state, screenshots and zero console errors without weakening existing status-link assertions.

## 2. Delivery evidence

- [x] 2.1 Add the required patch changeset and verify `pnpm test:unit`, full `pnpm e2e`, `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm docs:check`, and strict OpenSpec validation.
