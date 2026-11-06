---
'mindsprout': minor
---

Browse saved maps on `/` with titles and last-updated times, newest first, and open a map from its list entry. An empty library offers 新建导图, which saves a map titled 新导图 with one root of the same name before opening its editor. Creation accepts only one pending attempt; a failed save keeps the library visible and permits an explicit retry. Loading and read failures have distinct states rather than appearing as an empty library.

Leaving the library or switching its repository suppresses late create navigation and error UI without cancelling the save; a committed map remains available on the next visit.
