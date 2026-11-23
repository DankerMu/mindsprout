# Proposal: localize-list-timestamps

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: shared timestamp units/presentation and compatibility across two lists)
Blast radius: incorrect timezone conversion or duplicate formatters could misidentify recency/account age; changing raw values could break ordering or hydration.
Selected risk packs: Schema/units/field names (display only); Legacy compatibility; Error handling/fallback for accepted arbitrary timestamp strings; Documentation.
Evidence floor: deterministic cross-timezone unit tests, invalid-string fallback with valid sibling rows/actions, both list component contracts, real library/admin browser evidence, full unit/static/spec gates and required CI.

## Why

Library and admin timestamps expose raw UTC ISO strings with milliseconds, forcing users to convert timezones and making the lists hard to scan.

## What Changes

- Add one shared `Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })` implementation for both lists.
- Render browser-local Chinese date/time text while preserving each `<time dateTime>` as the original ISO string.
- Keep API values, ordering, list identity and all operations unchanged; add two spec deltas and a patch changeset.
