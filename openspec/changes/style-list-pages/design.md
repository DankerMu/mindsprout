# Design: style-list-pages

Change surface: one shared `src/components/list-page.module.css`, the existing home/admin page `<main>` elements, map-library/account-admin E2E, two ADDED spec deltas and a patch changeset.
Must preserve: DOM roles and accessible names, captured row/account identity, inline rename/delete location, focus/cancel/pending/error behavior, timestamps and `dateTime`, API/raw ordering, password reset and client-only loading.
Must add/change: local CSS-module selectors for page typography, bullet-free lists, consistent wrapping rows, readable times, clear buttons/inputs and inline mutation panels; no new runtime state, global theme, dependency or component copy.
Governing invariant: both pages share one presentation implementation while every existing semantic and mutation contract remains unchanged.
Sibling surfaces: SessionMenu/create/reset buttons inside the scoped page, same-title inline forms/dialogs, temporary-password dialog, timestamps, empty/error states and editor/login pages outside the scoped `<main>`.
Seams under test: actual `/` and `/admin` computed styles and screenshots; existing map-library mutation and account-admin reset browser scenarios.
Required evidence: browser assertions fail on the default `disc` list/flex/button presentation before the CSS, then prove `list-style-type: none`, flex rows and the shared button border/radius on both pages.
Required evidence: `.run/ui-evidence/map-library-ordering.png`, same-title rename/delete captures and `account-admin.png` show the final layout with zero unexpected console/page errors; existing identity, cancellation, focus and persistence assertions remain intact.
Non-goals: global CSS or themes, login/register/editor styling, admin navigation, responsive redesign, search/sort/pagination, API/state changes or a second list styling implementation.
Review focus: one scoped CSS module, no semantic/behavior drift, no selector leakage beyond the two pages, readable inline targets and complete real-browser evidence.

The shared module lives beside shared components and is imported only by the two route components. Descendant element selectors are scoped beneath the generated page class, so SessionMenu controls receive the same local treatment without modifying that shared component or affecting other routes.
