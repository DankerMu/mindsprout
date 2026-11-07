---
'mindsprout': minor
---

Undo and redo map edits with Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z or the canvas buttons 撤销 and 重做. Button availability follows session history, which is cleared on reload without losing saved map content.

Text editing and IME keep native keyboard behavior. A toolbar pointer gesture that starts while naming a node only finishes that editor; it does not also consume map history. Cancelling an unnamed creation preserves earlier edits and redo entries, and the next idle activation works normally.
