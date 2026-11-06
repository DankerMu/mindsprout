---
'mindsprout': minor
---

Rename existing nodes by double-clicking or pressing F2 on the canvas. F2 edits only the last-clicked primary node and preserves a multi-selection. Enter saves, Escape discards, and leaving the input saves without moving focus away from its destination.

Titles accept any length, including 200 characters, and nonempty text is saved verbatim. Blank or unchanged titles leave the existing title and history untouched. Input composition and native text shortcuts do not trigger canvas actions; IME confirmation marked by keyCode 229 keeps the title draft open even after composition ends. Hidden or deleted edit targets discard their drafts. Committed renames use the existing undo history and browser autosave.
