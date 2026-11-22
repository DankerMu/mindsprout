# Design

## Context

Change surface: ready `EditorView` header, existing `EditorSession` unmount flush, map-library and map-editor browser coverage.
Must preserve: map title header, native error/not-found links, autosave/undo and editor semantics; no new save protocol.
Must add: `next/link` named 返回导图列表 to `/` in the ready header, outside account `SessionMenu`.
Governing invariant: leaving the ready editor through the new link invokes the same unmount flush as other client navigation and never bypasses the repository's ordered save/read behavior.

## Goals / Non-Goals

**Goals:**

- A visible keyboard-focusable return link on every ready editor, including direct deep links.
- Immediate post-edit navigation retains the newest title/order and reopened tree.
- One navigation implementation shared by all editor entrypoints.

**Non-goals:**

- No admin return link, global navigation, breadcrumbs, map switcher, leave warning or autosave change.
- No title editing in the header or unification of other back-link wording.

## Decisions

- Place the link in `EditorView`, the owner of the ready editor header, rather than account-owned `SessionMenu` or the route composition root.
- Reuse `next/link` with `href="/"` and the exact existing 返回导图列表 wording used by status pages.
- Rely on `EditorSession` cleanup to call `flush()` on unmount; add no click-specific save, duplicate repository or delayed navigation.
- Sibling surfaces: normal ready editor, direct/deep opening, library ordering/title, reopen after navigation, not-found/error states and session-menu sign-out.
- Seams under test: accessible link in the ready header, real browser keyboard activation, immediate edited-tree return and persisted reload.
- Required evidence: direct editor → keyboard 返回导图列表 → `/`; edit → immediate return → newest list title/order → reopen shows latest tree; existing status back links and full E2E remain green with zero console errors.

## Risks / Trade-offs

- Client navigation could outrun persistence → verify actual saved library state and reopened tree through the existing ordered flush, without artificial waits.
- Duplicate names could hide the target → scope the link to the ready editor header and use exact accessible name.
- Link might appear on unreadable/error states → keep it inside the ready editor branch only.
- Review focus: link ownership, keyboard access, unmount timing, saved-state proof and unchanged status navigation.
