# Spec Delta

## Purpose

Maps survive page reloads and browser restarts in the user's browser, saved automatically and read back exactly, with a versioned envelope that a later cloud sync can consume.

## ADDED Requirements

### Requirement: Autosave after every change

After an op is applied in the editor, the map SHALL be persisted within 500 ms of the last op; a pending save SHALL be flushed when the page is unloaded.

#### Scenario: Reload after edits

- **WHEN** the user adds three nodes, waits one second, and reloads `/maps/<id>`
- **THEN** the three nodes are present with the same text, parents and order

#### Scenario: Rapid edits coalesce

- **WHEN** ten ops are dispatched within 200 ms
- **THEN** at most one write hits the store after the burst, and it contains the result of all ten ops

### Requirement: Persisted shape is versioned

Each stored map SHALL be wrapped as `{ schemaVersion, map }`; the current version is 1. A reader meeting a higher version SHALL refuse to load it and report the version instead of partially loading.

#### Scenario: Future version

- **WHEN** a stored record has `schemaVersion: 2`
- **THEN** opening that map shows "此导图由更新版本创建" and no data is modified

### Requirement: Floating roots and node attributes round-trip

Positions of floating roots, collapsed flags, colors and notes SHALL be stored and restored without loss.

#### Scenario: Floating root round-trip

- **WHEN** a floating root at (300, 200) with a collapsed child carrying a note is saved and the map is reopened
- **THEN** the root is at (300, 200), the child is collapsed and its note text is identical

### Requirement: Storage unavailable is visible

When browser storage cannot be opened, the editor SHALL keep working in memory and SHALL show a persistent banner stating that changes are not being saved; a failed write SHALL show an error notice, never be swallowed.

#### Scenario: Private mode

- **WHEN** IndexedDB open fails
- **THEN** the editor loads, the banner "未保存到浏览器" is visible, and edits still work for the session
