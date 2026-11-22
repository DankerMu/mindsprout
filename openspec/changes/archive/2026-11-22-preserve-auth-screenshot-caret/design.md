# Design

## Context

See `proposal.md` for motivation. Two existing form-switch screenshots use Playwright's default caret behavior. The selected risk packs require expanded artifacts even though the production behavior and implementation scope do not expand.

## Goals / Non-Goals

Goals: make the two existing evidence captures non-mutating and verify that property during the actual screenshot calls, while retaining all existing browser assertions.

Non-goals: production hydration diagnosis, a new shared screenshot abstraction, new auth/native-submit behavior, timeouts, CI gates or product UI. No deterministic reproduction or root-cause claim is required for the unreproduced intermittent schedule.

## Decisions

- Set `caret: 'initial'` at both existing `page.screenshot` calls instead of accepting Playwright's default caret hiding. No helper is introduced for two calls.
- Verify both calls with a temporary page-side `MutationObserver` on the two credential inputs' `style` attributes, recording only mutations whose old/new serialized inline style contains `caret`. The observer spans screenshot start/end, including temporary changes that leave no residue. Remove the diagnostic before the production test is finalized.
- A pre-change observation of a caret mutation is a qualified harness red signal, not a deterministic reproduction of the original hydration error. A zero-mutation green observation plus the unchanged form/session/noise assertions is sufficient for this narrowly scoped option correction.
- If the pinned Playwright version's API cannot preserve caret as specified, stop rather than suppress hydration errors or filter console output.

Change surface: the single existing form-switch E2E scenario and its two evidence screenshots.
Must preserve: entered credentials, exact safe-return links, zero credential submissions, 401 session state, screenshots and zero unexpected console/page errors.
Must add/change: only explicit non-mutating caret options at those two calls.
Governing invariant: evidence capture cannot introduce caret-related inline-style mutation into either credential input.
Sibling surfaces: `/login` and `/register` screenshots in this scenario only; the separate native-submit and legacy-login paths are not being redesigned.
Seams under test: real browser screenshot invocation and transient input-style mutation observation, not source-text matching.
Required evidence: before/after mutation diagnostics and the focused browser scenario's credentials/session/console assertions; no fabricated timing claim.
Review focus: both call sites, transient mutation evidence, preservation of all old assertions, and the absence of production or CI weakening.

## Risks / Trade-offs

- Observer scheduling may miss a same-task transient mutation → use the observer's oldValue/current-style records as evidence and do not infer the original CI race from a zero observation.
- Expanded fixture overhead for two option changes → retain the narrow implementation; the added design governs evidence rather than adding modules.
- A green browser run cannot establish intermittent failure frequency → report it only as behavior and non-mutation evidence.

## Migration Plan

No deployment migration. Revert the two options if the supported pinned Playwright contract is disproved; keep the strict browser assertions intact.
