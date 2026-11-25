# Tasks

## 1. Positive save proofs poll the stored record

- [x] 1.1 `e2e/node-creation.spec.ts` "Enter on a floating root" and "Enter inserts the next sibling after the middle node": remove `waitForTimeout(600)` and turn the following `expect(await readRecord(...)).toMatchObject(X)` into `await expect.poll(() => readRecord(page, MAP.id)).toMatchObject(X)` with X unchanged.
- [x] 1.2 `e2e/node-creation.spec.ts` "Reload after edits": keep `waitForTimeout(1000)`; poll `readRecord` until it matches `expected` before `page.reload()`; then `const saved = await readRecord(...)` and keep `expect(await readRecord(...)).toEqual(saved)` after reload.
- [x] 1.3 `e2e/inline-title.spec.ts` "Edits older than the save window survive reload": left unchanged after task 1.4 found no red (see Non-goals).
- [x] 1.4 Red/green proofs for the race (no product change, temporary code only): delay the browser's map PUT by ~1 s (`page.route` on `PUT /api/maps/**`, wait, then `route.continue()`).
  - Floating root: the pre-change version fails at the single `readRecord` after `waitForTimeout(600)` (`children: []`, same signature as CI run 45433931261); the polled version passes.
  - Save window, as an experiment: the pre-change version and a `:258`-only-polled version both **pass** under the delay; the stored record holds both renames, stamped inside the reload window. The pagehide flush writes them, so no fix was shipped there.

## 2. Negative proofs unchanged

- [x] 2.1 Do not touch the sleep-then-assert-unsaved sites: `node-creation.spec.ts` "Empty new node is discarded" and "Escape cancels creation" (`expectSavedBaseline`), `inline-title.spec.ts` Escape discards, `canvas-editing.spec.ts` selection afterEach, `map-editor.spec.ts` `expectUnmodified`, `context-menu.spec.ts:140-141`, `:238-239` and `:377-378`, `group-drag.spec.ts` `expectRefused`, `single-node-drag.spec.ts` `expectCancelledDrop` and its sibling.
- [x] 2.2 Audit: `grep -n -A2 "waitForTimeout\|setTimeout(resolve" e2e/node-creation.spec.ts e2e/inline-title.spec.ts` — every remaining hit is followed by a negative assertion, the Reload-after-edits one-second user wait, or the unchanged inline-title save-window wait (Non-goals).

## 3. Qualification

- [x] 3.1 `pnpm verify-ui "keyboard node creation"` and (unchanged) `pnpm verify-ui "Edits older than the save window"` pass with zero console noise.
- [ ] 3.2 `pnpm fmt:check`, `pnpm lint`, `pnpm typecheck`, `openspec validate poll-saved-records --strict --no-interactive`; required CI green on the PR head with the E2E job passing on its first attempt. Test-only: no changeset, no decision record.

## Risk packs

- Selected: Concurrency / shared state / ordering - the GET-vs-debounced-PUT race itself; tasks 1.1-1.4 (1.4 is the deterministic red/green proof).
- Selected: Legacy compatibility / examples - negative proofs and spec-coupled timings (one-second wait, 600 ms window, <100 ms reload) must keep their meaning; tasks 1.2, 1.3, 2.1, 2.2.
- Selected: Documentation / migration notes - map-persistence ADDED requirement for save evidence; no user-visible changeset.
- Not selected: Public API / CLI / script entry - no route, script or command changes.
- Not selected: Config / project setup - `playwright.config.ts` (retries 0, timeouts) untouched.
- Not selected: File IO / path safety / overwrite - only existing screenshot paths.
- Not selected: Schema / columns / units / field names - matchers keep their shapes.
- Not selected: Auth / permissions / secrets - signed-in fixture unchanged.
- Not selected: Resource limits / large input / discovery - default `expect.poll` timeout bounds each wait; a missing or stale PUT still fails red.
- Not selected: Error handling / rollback / partial outputs - no error paths change.
- Not selected: Release / packaging / dependency compatibility - no dependency changes.

## Non-goals

- `e2e/inline-title.spec.ts` save-window test (issue erratum item 1). With the debounced PUT held in the browser it stays green, because the `pagehide` keep-alive flush stores the first rename along with the second. A server that applies the flush after the reloaded page's GET is a different race. Nothing evidences it: it is absent from the 194 counted CI E2E runs. Changing the test without a red run would only lengthen the spec's 600 ms wait.
- Product save behavior. If any poll times out (no PUT or stale PUT content), stop and report a possible product defect instead of changing product code.
- Raising sleeps, adding Playwright retries, or editing `playwright.config.ts`.
- The false-green risk of negative proofs on slow machines (separate issue if wanted).
- #286 (Darwin native HMR readiness).
