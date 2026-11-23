# Design: localize-list-timestamps

Change surface: one new `src/shared/format-timestamp.ts`, `MapLibrary`, `AdminUserList`, `MapLibrary.test.tsx`, `MapLibrary-mutations.test.tsx`, `AdminUserList.test.tsx`, existing map-library/map-editor/account-admin E2E, two spec deltas and a patch changeset.
Must preserve: ISO `dateTime` attributes, raw `updatedAt`/`createdAt`, API envelopes, raw-value ordering, list identity, operations, permissions and client-only data loading.
Must add/change: one reused formatter and visible localized text in the two existing time elements; no new dependency, state, configuration or timezone setting.
Governing invariant: the same ISO instant produces the correct Chinese browser-local date/time in both lists while its machine-readable value and ordering source remain byte-identical.
Sibling surfaces: library recency ordering and links/mutations, admin oldest-first ordering and reset controls, formatter consumers, client-only loading and browser console/hydration paths.
Seams under test: pure formatter with fixed UTC instant and explicitly selected process timezones; existing list components; real browser lists with explicit Playwright timezone.
Required evidence: UTC vs America/Los_Angeles vs Asia/Shanghai hardcoded results include the expected day boundary; tests never read the host's current clock.
Required evidence: both component suites show the shared formatted text, retain original ISO `dateTime`, and preserve existing order/action assertions.
Required evidence: `pnpm verify-ui "map-library"`, `pnpm verify-ui "map-editor"`, and `pnpm verify-ui "account-admin"` assert localized visible text + ISO attributes, regenerate library-return and both page screenshots, and report zero unexpected console errors.
Non-goals: Asia/Shanghai-only formatting, user timezone preferences, relative time/refreshes, API/database changes, list styling, search/sort/pagination or a second formatter.
Review focus: exactly one implementation, deterministic timezone proof, raw value/order preservation, client-only rendering and complete browser evidence.

The formatter instance is module-scoped so list rendering does not allocate a new `Intl.DateTimeFormat` per row. Tests reload that module with explicit `process.env.TZ` values rather than adding a production timezone parameter. Both lists render timestamps only after client-side data loading, so server HTML contains no locale/timezone-dependent timestamp text.
