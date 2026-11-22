# map-persistence Specification

## Purpose

Maps persist across page reloads and browser restarts in the signed-in user's cloud account, are saved automatically and read back exactly, and use a versioned envelope shared between browser and server.

## Requirements

### Requirement: Autosave after every change

After a stable map change, the application SHALL schedule a write to the signed-in user's cloud map store 500 ms after the last such change; each subsequent change SHALL restart the timer. Ops inside an open undo group (for example a node being created and named) count from when the group closes: their result is written only once the group ends, and never if the group is cancelled. A pending save SHALL be flushed on `pagehide` as a best-effort attempt. The flush request SHALL be allowed to outlive the page whenever its body fits the browser's keep-alive limit; a larger body is sent as an ordinary request. A reload MAY lose all pending changes since the last successful save, including edits older than 500 ms during continuous editing; the debounce interval SHALL NOT be represented as an upper bound on pending-edit age (design D7 of `m1-canvas`).

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

#### Scenario: Flush outlives the page

- **WHEN** a pending map whose serialised save body is at most 60,000 bytes is flushed on `pagehide`
- **THEN** the save request is issued as a keep-alive request; a larger body is issued as an ordinary request

### Requirement: Saves stamp updatedAt

Every save and every rename SHALL set `updatedAt` to the current time in the application layer before writing; the repository SHALL store the map as given and the reducer SHALL never touch `updatedAt`.

#### Scenario: Save stamps updatedAt

- **WHEN** a map with `updatedAt` T0 receives an op and the autosave fires
- **THEN** the stored map's `updatedAt` is later than T0 and its `roots` equal the editor state

### Requirement: Persisted shape is versioned

Each stored map SHALL be held, and transferred between browser and server, as `{ schemaVersion, map }`. The current version is 1. `map` is the client `MindMap`, and its owner is a server-side attribute that never appears in `map`. A reader meeting a higher version SHALL refuse to load it with `UnsupportedSchemaVersionError`, and the editor SHALL report the version instead of partially loading.

#### Scenario: Future version

- **WHEN** the store holds the requested map with `schemaVersion: 2`
- **THEN** reading it throws `UnsupportedSchemaVersionError`, opening that map shows "此导图由更新版本创建", and no data is modified

### Requirement: Floating roots and node attributes round-trip

Positions of floating roots, collapsed flags, colors and notes SHALL be stored and restored without loss.

#### Scenario: Floating root round-trip

- **WHEN** a floating root at (300, 200) with a collapsed child carrying a note is saved and the map is reopened
- **THEN** the root is at (300, 200), the child is collapsed and its note text is identical

### Requirement: Same-session persistence operations retain invocation order

Within one browser document session, the HTTP map repository SHALL preserve mutation invocation order and SHALL NOT let a later read bypass an earlier pending mutation. An idle `put` SHALL invoke fetch synchronously. When an earlier operation is pending, later operations SHALL wait for it to settle; a rejected operation SHALL NOT prevent later queued operations from running. Every deferred operation SHALL retain its adapter's Session binding and follow account-auth "Deferred map operations remain bound to the invoking account"; queue release SHALL NOT bypass that account check. Cross-device editing remains last-write-wins, and unload delivery remains best-effort.

#### Scenario: An older save cannot overwrite a newer edit or rename

- **WHEN** an older PUT is held before its backing-store mutation, a newer PUT for the same map is invoked, and the older PUT is then released
- **THEN** the newer PUT does not reach the backing store before the older operation settles, and a subsequent read returns the newer map

#### Scenario: A delayed save cannot resurrect a deleted map

- **WHEN** a PUT is held before its backing-store mutation, deletion of that map is invoked, and the PUT is then released
- **THEN** deletion runs after the PUT and a subsequent read reports the map as absent

#### Scenario: Navigation reads wait for a flushed mutation

- **WHEN** a PUT is held before its backing-store mutation and a list or get is invoked through the same session repository
- **THEN** the read waits for the PUT instead of returning stale pre-write state

#### Scenario: A failed operation does not poison the session queue

- **WHEN** a queued predecessor rejects and a later mutation is pending
- **THEN** the later mutation still runs and retains the existing error taxonomy

### Requirement: Save failures are visible

A save that fails for any reason other than an ended session SHALL show the error notice "保存失败" and SHALL never be swallowed. Examples are a network failure, a server error or a refused payload. The edit SHALL stay in the editor and remain pending until the next edit or flush retries it. Network failures SHALL NOT switch the editor to a different store.

#### Scenario: Write failure is visible

- **WHEN** a save request fails (the network is down or the server answers 500) after an edit
- **THEN** the editor shows the notice "保存失败", the edit remains in the editor, and the next edit after the network returns saves both changes
