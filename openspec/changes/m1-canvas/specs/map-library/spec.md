# Spec Delta

## Purpose

The home page lists the user's maps and lets them create, open, rename and delete maps stored in the browser.

## ADDED Requirements

### Requirement: Create a map

The home page SHALL offer "新建导图"; creating SHALL call the domain factory `createMindMap` to produce a map titled "新导图" whose primary root text is "新导图", save it, and navigate to its editor.

#### Scenario: Create from the empty state

- **WHEN** there are no maps and the user clicks 新建导图
- **THEN** the editor at `/maps/<new id>` opens with a single root node titled "新导图" and the header shows the title "新导图"

### Requirement: List maps

The home page SHALL list every stored map with its title and last-updated time (`MapSummary { id, title, updatedAt }`), most recently updated first; an empty list SHALL show an empty-state message with the create action.

#### Scenario: Ordering

- **WHEN** maps A (updated 10:00) and B (updated 11:00) exist
- **THEN** the list shows B before A

### Requirement: Open, rename, delete

Clicking a list entry SHALL open its editor; rename SHALL update the map title and `updatedAt` through the application layer (not a TreeOp, not an undo step; the primary root text stays independent); delete SHALL ask for confirmation and then remove the map from storage.

#### Scenario: Rename from the list

- **WHEN** the user renames map A to "读书笔记"
- **THEN** the list shows "读书笔记" first (its `updatedAt` is newest) and reopening A shows that title in the editor header with the primary root text unchanged

#### Scenario: Delete with confirmation

- **WHEN** the user chooses delete on map A and confirms
- **THEN** A is no longer listed and `/maps/<A id>` shows the not-found state

### Requirement: Unknown map id

Opening `/maps/<id>` for an id not in storage SHALL show a not-found state with a link back to the library, not an error page.

#### Scenario: Stale link

- **WHEN** the user opens `/maps/does-not-exist`
- **THEN** the page shows "找不到这张导图" and a link to `/`

### Requirement: Unreadable map shows an error state

Opening `/maps/<id>` for a stored map that cannot be read or rendered SHALL show an error state with a link back to the library. It SHALL never show the not-found state or a blank page, and SHALL modify nothing.

#### Scenario: Corrupt record

- **WHEN** the stored record for `/maps/<id>` holds a floating root without a position
- **THEN** the page shows "无法打开这张导图" and a link to `/`, and not "找不到这张导图"

### Requirement: Library works without storage

When browser storage is unavailable the library SHALL show the same "未保存到浏览器" banner as the editor, list the maps created in this session from the shared in-memory repository, and 新建导图 SHALL still open a working editor; a full reload of such an editor URL SHALL show the not-found state together with the banner.

#### Scenario: Create with storage blocked

- **WHEN** IndexedDB is blocked and the user clicks 新建导图, adds a child, and navigates back to `/`
- **THEN** the banner is visible on both pages, the list shows the new map, and reopening it from the list shows the child

#### Scenario: Reload with storage blocked

- **WHEN** IndexedDB is blocked and the user reloads `/maps/<id>` of a map created in this session
- **THEN** the page shows "找不到这张导图" and the banner "未保存到浏览器"
