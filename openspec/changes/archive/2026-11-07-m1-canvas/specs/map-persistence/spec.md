# Spec Delta

## Purpose

Maps survive page reloads and browser restarts in the user's browser, saved automatically and read back exactly, with a versioned envelope that a later cloud sync can consume.

## ADDED Requirements

### Requirement: Autosave after every change

After a stable map change, the application SHALL schedule a write 500 ms after the last such change; each subsequent change SHALL restart the timer. Ops inside an open undo group (for example a node being created and named) count from when the group closes: their result is written only once the group ends, and never if the group is cancelled. A pending save SHALL be flushed on `pagehide` as a best-effort attempt. A reload MAY lose all pending changes since the last successful save, including edits older than 500 ms during continuous editing; the debounce interval SHALL NOT be represented as an upper bound on pending-edit age (design D7).

#### Scenario: Reload after edits

- **WHEN** the user adds three nodes, waits one second, and reloads `/maps/<id>`
- **THEN** the three nodes are present with the same text, parents and order

#### Scenario: Edits older than the save window survive reload

- **WHEN** the user renames a node, waits 600 ms, renames another node and reloads within 100 ms of the second rename
- **THEN** the first rename is present after reload

#### Scenario: Rapid edits coalesce

- **WHEN** ten ops are dispatched within 200 ms
- **THEN** at most one write hits the store after the burst, and it contains the result of all ten ops

#### Scenario: Continuous edits restart the save delay

- **WHEN** under a controlled clock, stable edits occur at 0, 400 and 800 ms after the last successful save, without an explicit flush
- **THEN** advancing to 1299 ms starts no debounced write; advancing to 1300 ms starts one write

#### Scenario: Opening a map is not an edit

- **WHEN** a map is opened in the editor and no op is applied
- **THEN** nothing is written and its stored `updatedAt` is unchanged

#### Scenario: Unnamed new node is not saved

- **WHEN** a node created with Tab is still being named and a save or a `pagehide` flush runs
- **THEN** the written map does not contain the unnamed node, and every edit made before the Tab is in it

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
