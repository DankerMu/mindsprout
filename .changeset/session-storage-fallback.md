---
'mindsprout': minor
---

Keep editing when browser storage cannot open by sharing one in-memory repository across library creation and editor navigation. The editor shows a persistent 未保存到浏览器 banner; fallback maps last only until the document is reloaded. Unavailable reads show the banner and an error rather than pretending the map does not exist.

Show the current editor notice, including 保存失败 after a failed write, with explicit dismissal. Failed saves retain edited text; generic write failures do not switch repositories. Notices have no automatic dismissal timer, so a replacement message is not cleared by an older notice.
