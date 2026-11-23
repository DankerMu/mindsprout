# Proposal: clear-save-recovery-notice

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent (expanded: autosave persisted state and overlapping request ordering)
Blast radius: stale success could hide a newer save failure; missing success leaves misleading session/failure notices.
Selected risk packs: Concurrency/shared state/ordering; Error handling/rollback; Documentation/migration notes.
Evidence floor: red→green autosave/store tests, full per-file unit gate, real M2 recovery browser test, static/spec/docs/decision checks and required CI.

## Why

After a 401 or generic save failure recovers, the editor persists the pending map but leaves the old warning and re-login link visible. Users cannot tell that saving has recovered.

## What Changes

- Notify the editor only when a successful write's `sent` map is still the current `stable` map and no newer edit remains pending.
- Clear only `SESSION_EXPIRED` or `SAVE_FAILED`; preserve unrelated notices and newer failures.
- Document the recovery transition in `account-auth` and `map-persistence`, and assert it in the existing two-device browser scenario.
