# Design

## Context

See `proposal.md`. Menu action ids and `mind-node--color-<token>` are existing contracts. `MindNodeView.module.css` already owns the six light/dark color values; the context menu currently renders label text only. LSP was attempted for the exported `MenuItem` type but no TypeScript language server is installed; source search found only the local registry/union usage.

## Goals / Non-Goals

**Goals:**

- Separate display labels/swatch metadata from semantic color tokens.
- Reuse the node's exact theme colors without adding a second palette.
- Preserve keyboard ownership, grouped dispatch/undo and stored data.

**Non-Goals:**

- No general i18n framework, new palette/theme, domain/schema or persistence change.

## Decisions

- Keep a module-local `Record<ColorToken, string>` for 红 / 橙 / 黄 / 绿 / 蓝 / 紫. `label` uses the mapping; `id`, dispatch `color` and `clear` behavior remain as before.
- Add optional `colorToken?: ColorToken` to the internal menu action metadata. `resolveAction` already spreads fields, so no resolver or runner change. The renderer shows a swatch only when this field is present; the accessible name remains the Chinese label alone and the swatch is `aria-hidden`.
- Apply the existing CSS-module `node` class plus the literal token class to the swatch. A small `swatch` class in the same module changes only geometry (width/height/padding/margin/display), so the existing token variables and dark media query supply identical backgrounds. No hex or second color mapping is introduced.
- Update component tests to locate all six Chinese names and assert swatch token classes/hidden semantics while retaining blue dispatch/undo assertions. E2E `chooseColor` continues accepting semantic tokens but maps them to Chinese names for menu clicks. Extend the existing theme test to compare each swatch's computed background with the corresponding node in light and dark modes and save menu screenshots.
- Add a patch changeset; update the existing Context menu and Color tokens requirements so English remains only the semantic token, not user-facing text.

Must preserve: six token ids, null clearing, grouped update/undo, keyboard focus, CSS contract classes and persistence.
Governing invariant: presentation may change, but the semantic token dispatched and stored must remain exactly unchanged.
Sibling surfaces: menu registry/resolver, renderer, CSS module, unit tests, e2e helper/theme test and spec scenarios.
Required evidence: unit red-before/green-after, unchanged dispatch/undo, computed swatch/node parity in both themes, screenshots and zero console errors, scoped static/OpenSpec and required CI.
Review focus: no token/schema drift, accessible naming, exact theme parity, no duplicated palette, test discovery and UI evidence.

## Risks / Trade-offs

- Reusing the node class requires overriding its box geometry for a small inline swatch; token/color declarations remain untouched and the e2e computed-color assertion guards the coupling.
- Optional metadata is presentation-only and must not become a second source of truth for dispatch; the existing `color` variable remains authoritative for `update_node`.
