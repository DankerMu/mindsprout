# Proposal: poll-saved-records

Issue type: test
Fixture level: compact
Upstream suggested level: absent (compact: only e2e assertion timing changes. The concurrency and legacy packs are selected because the tests observe the autosave race and spec-coupled waits, but no concurrency, persistence or compatibility code changes, which is what the expanded triggers name)
Blast radius: a wrong change either keeps the CI false-red race on required E2E, or turns a negative "nothing was saved" proof into one that passes immediately.
Selected risk packs: Concurrency / shared state / ordering; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: `pnpm verify-ui "keyboard node creation"` green locally; a delayed-PUT red/green proof for the floating-root test; the grep audit below; strict OpenSpec validation; one green CI E2E job on the PR (a rerun does not count).
design.md omitted: compact level.

## Why

Issue #287. Four e2e sites prove that an edit **was saved** by sleeping a fixed time and then reading the stored record once. Autosave waits 500 ms after the last change and then issues a network PUT, so on a slow CI runner the single GET can land before the PUT and read the previous record (main push run 45433931261 attempt 1, `node-creation.spec.ts:158`).

## What Changes

- Replace each positive "single read after a fixed sleep" with `expect.poll(() => readRecord(...))` carrying the same matcher, the pattern already used at `node-creation.spec.ts:134`, `undo-redo.spec.ts:148` and `m1-acceptance.spec.ts:138`:
  - `e2e/node-creation.spec.ts:157-158` Enter on a floating root: drop the 600 ms sleep.
  - `e2e/node-creation.spec.ts:202-203` Enter inserts the next sibling: drop the 600 ms sleep.
  - `e2e/node-creation.spec.ts:239,265` Reload after edits: keep the one-second user wait (spec scenario "waits one second, and reloads"), poll until the record matches before reloading, then take `saved` and keep the post-reload `toEqual(saved)` comparison.
  - `e2e/inline-title.spec.ts` Edits older than the save window survive reload: **unchanged** (see tasks Non-goals). With the debounced PUT held 1 s in the browser, the pre-change test still passes, because the `pagehide` keep-alive flush (`src/components/editor/EditorSession.tsx`) writes both renames during the reload. The fixed-sleep race this issue fixes does not reach this test.
- Leave every negative proof (sleep past the debounce, then assert the record still equals the seed or baseline) unchanged; polling would make them pass immediately.
- No production code, Playwright config, retries or timeout changes. If a poll times out (no PUT, or a PUT with stale content), stop and report it as a possible product save defect; do not change product code in this issue.
