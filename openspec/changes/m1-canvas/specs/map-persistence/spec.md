# Spec Delta

## Purpose

Maps survive page reloads and browser restarts in the user's browser, saved automatically and read back exactly, with a versioned envelope that a later cloud sync can consume.

## ADDED Requirements

### Requirement: Autosave after every change

After an op is applied in the editor, the map SHALL be persisted within 500 ms of the last op. An edit older than that window SHALL never be lost; a pending save SHALL be flushed on `pagehide` as a best-effort attempt, so a reload inside the window MAY lose at most the last burst of edits (design D7).

#### Scenario: Reload after edits

- **WHEN** the user adds three nodes, waits one second, and reloads `/maps/<id>`
- **THEN** the three nodes are present with the same text, parents and order

#### Scenario: Edits older than the save window survive reload

- **WHEN** the user renames a node, waits 600 ms, renames another node and reloads within 100 ms of the second rename
- **THEN** the first rename is present after reload

#### Scenario: Rapid edits coalesce

- **WHEN** ten ops are dispatched within 200 ms
- **THEN** at most one write hits the store after the burst, and it contains the result of all ten ops

### Requirement: Saves stamp updatedAt

Every save and every rename SHALL set `updatedAt` to the current time in the application layer before writing; the repository SHALL store the map as given and the reducer SHALL never touch `updatedAt`.

#### Scenario: Save stamps updatedAt

- **WHEN** a map with `updatedAt` T0 receives an op and the autosave fires
- **THEN** the stored map's `updatedAt` is later than T0 and its `roots` equal the editor state

### Requirement: Persisted shape is versioned

Each stored map SHALL be wrapped as `{ schemaVersion, map }`; the current version is 1 and `map` is the client `MindMap` (no `ownerId`). A reader meeting a higher version SHALL refuse to load it with `UnsupportedSchemaVersionError` and the editor SHALL report the version instead of partially loading.

#### Scenario: Future version

- **WHEN** a stored record has `schemaVersion: 2`
- **THEN** the repository throws `UnsupportedSchemaVersionError`, opening that map shows "此导图由更新版本创建", and no data is modified

### Requirement: Floating roots and node attributes round-trip

Positions of floating roots, collapsed flags, colors and notes SHALL be stored and restored without loss.

#### Scenario: Floating root round-trip

- **WHEN** a floating root at (300, 200) with a collapsed child carrying a note is saved and the map is reopened
- **THEN** the root is at (300, 200), the child is collapsed and its note text is identical

### Requirement: Storage unavailable is visible

When browser storage cannot be opened, the app SHALL fall back to one in-memory repository shared by the library and the editor for the session, keep working, and show a persistent banner stating that changes are not being saved; a failed write SHALL show an error notice, never be swallowed.

#### Scenario: Private mode

- **WHEN** IndexedDB open fails
- **THEN** the editor loads, the banner "未保存到浏览器" is visible, and edits still work for the session

#### Scenario: Write failure is visible

- **WHEN** a `put` rejects (for example a quota error) after an edit
- **THEN** the editor shows the notice "保存失败" and the edit remains in the editor
