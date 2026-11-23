# Design: clear-save-recovery-notice

Change surface: `createAutosave.write`, `attachAutosave`, their existing unit seams, and the M2 recovery browser scenario.
Must preserve: debounce/flush behavior, pending-edit retry, error classification, notice strings/link target, and no request when no write is pending.
Must add/change: an `onSaved` notification after successful `repository.put`; conditional clearing of save-owned notices; two spec recovery clauses and a patch changeset.
Governing invariant: a successful save clears a save warning only when the map it sent is still the stable map, so an older success can never hide a newer edit's failure.
Sibling surfaces: HTTP 401 and generic failure retries, direct `createAutosave` consumers, `EditorView` notice/link derivation, overlapping writes, and manual `clearNotice`.
Seams under test: `createEditorStore` with `RecordingRepository` for independently settled overlapping writes; the in-memory HTTP repository for 401/500 recovery mapping; `createAutosave` for callback timing; existing Playwright two-device scenario for actual UI.
Required evidence: current stable 401→success and 500→success produce `notice === null` immediately after the real successful flush, before any no-op flush; an unrelated notice survives a real successful PUT.
Required evidence: with `RecordingRepository`, reject the newer write with `StorageUnauthorizedError` first and assert `SESSION_EXPIRED`; then resolve the older write and assert the notice remains. A later current-map successful retry clears it. The serialized HTTP test alone cannot prove this ordering.
Required evidence: a direct `onSaved` spy is not called before PUT resolution, is called exactly once afterward, and is not called by a no-op flush. `editor-store-autosave.test.ts` must fail against the old residual-notice behavior, then pass after the callback fix; `pnpm test:unit` retains per-file coverage.
Required evidence: `pnpm verify-ui "two devices, pending-edit recovery"` shows the recovered editor without its session warning/link and with zero unexpected browser errors.
Non-goals: session detection, re-login navigation, automatic session polling/retry, library-page notices, and notices unrelated to saving.
Review focus: identity-based stale-success guard; failure-after-success ordering; no-op flush behavior; unrelated-notice preservation; exact browser and spec evidence.

The callback is a notification, not a second persistence path. `write()` calls it only after `repository.put` resolves and `stable === sent`. `attachAutosave` reads the current notice and replaces it with `null` only for the two save-owned constants. No UI condition or generic notice API changes.
