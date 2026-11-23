# Design: preserve-login-smoke-caret

Change surface: `e2e/smoke.spec.ts`, a shared E2E credential-hydration helper extracted from `e2e/m2-acceptance.spec.ts`, one MODIFIED account-auth spec delta and the OpenSpec fixture. No production file or changeset (test-only).
Must preserve: standalone smoke screenshots and route coverage, zero unexpected console/page errors, existing M2 after-load Scheduler proof, hydrated authentication and all production form behavior.
Must add/change: explicit `caret: 'initial'` only on the `/login` smoke screenshot and deterministic observation of both credential inputs during a real post-load hydration hold.
Governing invariant: browser evidence never changes credential input caret state, including while SSR is visible and the mount-effect hydration marker is still absent.
Sibling surfaces: home/editor/admin smoke routes remain on their existing screenshot options; M2 uses the same hold/release helper; account-auth form-switch captures remain unchanged.
Seams under test: actual `/login` SSR-to-hydration path with `data-hydrated` absent during capture, input-style MutationObserver, existing M2 Scheduler regression and strict console collectors.
Required evidence: before the option, the `/login` scenario fails by recording `transparent` caret writes (and any real hydration mismatch remains unfiltered); after `caret: 'initial'`, the same held path records no caret writes, retains `login.png`, releases hydration to `data-hydrated=true` and ends with zero unexpected errors.
Required evidence: `pnpm verify-ui "route /"` covers all four smoke routes; `pnpm verify-ui "M2 authentication waits for hydration after load"` remains 1/1; unit/lint/typecheck/boundaries/docs/decisions/OpenSpec and required CI pass.
Non-goals: production form changes, global screenshot audit, retrying until green, arbitrary sleeps/networkidle, console suppression, independent session-username timeout investigation or a second Scheduler hold implementation.
Review focus: meaningful red/green mechanism proof, exact post-load hold rather than a guessed wait, no duplicated helper, unchanged strict assertions and scoped `/login` option only.

The existing M2 init-script logic moves verbatim into `e2e/support/credential-hydration.ts` with wait/release helpers. The smoke observer records only non-empty inline caret colors on username/password inputs; it collects no credential values.
