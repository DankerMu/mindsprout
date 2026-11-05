# Spec Delta

## Purpose

The home page lists the user's maps and lets them create, open, rename and delete maps stored in the browser.

## ADDED Requirements

### Requirement: Create a map

The home page SHALL offer "新建导图"; creating SHALL produce a map whose primary root text is "新导图" and SHALL navigate to its editor.

#### Scenario: Create from the empty state

- **WHEN** there are no maps and the user clicks 新建导图
- **THEN** the editor at `/maps/<new id>` opens with a single root node titled "新导图"

### Requirement: List maps

The home page SHALL list every stored map with its title and last-updated time, most recently updated first; an empty list SHALL show an empty-state message with the create action.

#### Scenario: Ordering

- **WHEN** maps A (updated 10:00) and B (updated 11:00) exist
- **THEN** the list shows B before A

### Requirement: Open, rename, delete

Clicking a list entry SHALL open its editor; rename SHALL update the map title (and the primary root text stays independent); delete SHALL ask for confirmation and then remove the map from storage.

#### Scenario: Rename from the list

- **WHEN** the user renames map A to "读书笔记"
- **THEN** the list shows "读书笔记" and reopening A shows that title in the editor header

#### Scenario: Delete with confirmation

- **WHEN** the user chooses delete on map A and confirms
- **THEN** A is no longer listed and `/maps/<A id>` shows the not-found state

### Requirement: Unknown map id

Opening `/maps/<id>` for an id not in storage SHALL show a not-found state with a link back to the library, not an error page.

#### Scenario: Stale link

- **WHEN** the user opens `/maps/does-not-exist`
- **THEN** the page shows "找不到这张导图" and a link to `/`
