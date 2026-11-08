# Design

## Context

1. See proposal.md for the wrong-target autosave risk. IndexedDB get returns the stored v1 map; put writes under map.id. The library row uses the database key, so readable metadata does not establish editor identity.
2. Change surface: StoredMap's successful get outcome before setLoaded ready and EditorSession construction. The MapEditor route already receives the requested string ID and has an error state.
3. Governing invariant: a loaded map may enter an autosave-capable editor only when its embedded ID equals the requested route ID; rejection must leave source and peer records untouched and issue no put.

## Goals / Non-Goals

4. Must preserve: missing-ID not-found, future-version presentation, storage-unavailable banner behavior, repository selection, initial loading, discarded/unmounted load cancellation, matching-ID editing and normal autosave.
5. No automatic repair, deletion, re-keying, migration, broader map validation or repository swapping. No changes to library rename/delete, persistence adapters/ports or autosave timing.
6. Sibling surfaces: renameMap already validates its captured ID; normal InMemoryMapRepository writes cannot create a key/embedded-ID mismatch. Both remain unchanged. EditorSession load/flush and raw IndexedDB put identity are reviewed as consumers, not redesigned.

## Decisions

7. Validate identity at the editor load boundary, after the existing cancelled-result guard and before ready. This protects every repository supplied to the editor without changing adapter read contracts or the adjacent rename behavior.
8. Undefined remains not-found; an ID mismatch uses the existing generic error state and back link. Do not throw a new unhandled promise rejection or show a storage-unavailable banner solely for corrupt identity.
9. Rejecting mismatches in the IndexedDB adapter is an alternative, but broadens read semantics beyond the editor and does not cover arbitrary other repository implementations. Central migration/canonicalization is out of scope.
10. Decision0016 records this data-integrity boundary, alternatives and non-repair guarantee. Author must recheck active-record supersession and next ID at write time; existing0003 and0011 remain valid, not retired.

## Verification

11. First tracer: seed real v1 row A containing an otherwise renderable map with id B, plus a distinct peer B. A native route regression expects the existing error state and no ready editor; run it RED on unchanged source before implementation.
12. After rejection, read raw A and B without the adapter and require deep equality to their exact seeds; use the existing delayed no-write observation and return-navigation boundary to cover deferred/teardown work. Keep both recoverable.
13. Component coverage uses the real MapEditor/provider with its existing ScriptedGetRepository/RecordingRepository seam: mismatched get result shows error, not ready/not-found; puts stays empty through pagehide/unmount. Do not mock the system under test.
14. A matching-ID native record still opens, accepts a real title edit and autosaves under its own ID; verify the intended stored content and an untouched peer. Reuse existing seeding/read helpers and production behavior, not an echoed repository mock.
15. Add a mismatched late result to the existing discarded StrictMode-result coverage so identity validation cannot override an active successful load. Preserve all existing load-state cases.
16. Native tests retain console warning/error/pageerror checks and screenshots. Production-mode verification follows the existing owner-approved issue79 exception; no HMR fix or retry/timeout change is claimed.
17. Scoped commands: both affected component/native browser files, changed-source per-file coverage, lint/typecheck/boundaries/docs/decisions/format and strict fixture validation; CI owns exhaustive checks. Parent executes, leaves do not run checks mid-flight.

## Risks / Trade-offs

18. A corrupt row remains listed when its summary is readable. This is intentional preservation, not a repair feature; existing explicit confirmed deletion remains available outside this change.
19. A stale load must not set either ready or error after cancellation. Keep identity validation inside the live-result guard and verify the sibling stale-result paths.
20. Real IndexedDB and component no-put evidence complement each other: unchanged records alone do not prove the absence of a same-value put, while an injected port alone does not prove browser persistence behavior.
21. High-risk data-integrity review covers every diff line with correctness, invariant-state, test-evidence+spec-compliance and security-perf+integration seats; owner accepts the functional rejection/normal-save evidence before merge.

## Migration Plan

22. No stored-data migration. Deploy the load guard atomically with regression coverage and record0016. Revert the isolated change if required; no data restoration is performed by this patch.
