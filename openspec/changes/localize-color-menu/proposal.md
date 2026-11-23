# Proposal

## Why

The Chinese node context menu exposes internal English color tokens and provides no visual color cue. Users and screen readers need Chinese accessible names, while stored tokens and theme behavior must remain unchanged.

## What Changes

- Map the six existing tokens to 红 / 橙 / 黄 / 绿 / 蓝 / 紫 for display only; keep `clear` as 无颜色 and preserve action ids, `update_node` payloads and persisted English tokens.
- Add optional display-only color metadata to menu actions and render an `aria-hidden` swatch. Reuse the existing node CSS-module variables and `mind-node--color-<token>` classes so swatches match node backgrounds in light and dark modes without duplicating hex values.
- Update unit/e2e locators and the canvas spec; assert Chinese accessible names, hidden swatches and computed-color parity in both themes. Add a patch changeset and capture UI evidence with zero console errors.

Issue type: feature
Fixture level: compact
Upstream suggested level: absent (agree with isolated menu presentation and existing token/CSS contracts)
Blast radius: color submenu labels/accessibility and swatch styling; stored map data and TreeOp behavior must not change.
Selected risk packs: UI/accessibility, theme compatibility, legacy persistence compatibility, test evidence.
Evidence floor: focused unit red→green for Chinese labels/swatches and unchanged color dispatch; context-menu e2e with light/dark computed swatch parity, screenshots and zero console errors; scoped static/OpenSpec checks and required CI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `canvas-editing`: color-menu display text and visual swatches are localized while semantic color tokens and grouped undo behavior remain unchanged.

## Impact

- Existing menu registry/action metadata, context-menu renderer, node CSS module, focused component/e2e tests, canvas-editing spec and one changeset.
- No domain/schema/persistence changes, i18n framework, dependency, API or workflow changes.
