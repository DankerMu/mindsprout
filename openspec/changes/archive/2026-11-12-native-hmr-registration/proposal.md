# Native HMR registration

## Why

Issue #79 interrupts editor hydration with repeated development document reloads. A real retained-session failure and an exact-version diagnostic native build demonstrate a selectable resource producer whose compute-entry registration is absent after cache restoration, yielding NotFoundVersion and Update::Missing on every subscription.

## What Changes

- Repair native registration ownership so restored resource publication establishes its complete lookup registration before becoming selectable.
- Retain the existing first-producer semantics, cache operation, legitimate HMR updates, readiness deadline and browser error assertions.
- Deliver an explicitly owner-approved same-version native repair for macOS arm64 and Linux x64 GNU, with source/patch/build/package digests, frozen-install verification and removal conditions. No manual installed-binary edits.
- Add behavioral native restore regression and real browser source-edit/restart verification; document the upstream maintenance responsibility and platform boundary.

## Capabilities

### New Capabilities

- `development-navigation`: development navigation reaches editor readiness across source invalidation and restored native resource registrations without reload loops.

### Modified Capabilities

None; application editing and persistence contracts remain unchanged.

## Impact

Upstream Next16.4.5 native resource map, version-pinned package overrides/lockfile, native build/verification scripts and CI, decision record and development instructions. Product source and browser storage formats remain unchanged.

## Risk triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent; expanded because native shared state, persistence, build supply chain and config are affected.
Blast radius: development HMR/resource availability and native package installation on supported platforms.
Selected risk packs: script entry; config; file IO; schema; auth/secrets; concurrency; resource limits; compatibility; errors/rollback; release/dependency compatibility; documentation.
Evidence floor: native real-backend semantic RED/GREEN; unchanged browser oracle; actual macOS/Linux addon loads and frozen installs; build/package provenance; full critical-path cross-review and guardrails. Owner authorized temporary native maintenance; consolidated functionality acceptance remains separate.
