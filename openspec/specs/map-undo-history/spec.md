# map-undo-history Specification

## Purpose

Undo and redo over applied TreeOps so that every change a user or an AI session makes can be reverted in predictable steps.

## Requirements

### Requirement: One applied op is one undo step

Each TreeOp dispatched outside a group SHALL create exactly one history entry; undo SHALL revert the most recent entry by applying its inverse ops and redo SHALL re-apply the most recently undone entry. The history SHALL expose `canUndo` and `canRedo` so the UI can show availability.

#### Scenario: Undo a rename

- **WHEN** the user renames node N from "A" to "B" and then triggers undo
- **THEN** N's text is "A" and redo is available

#### Scenario: Redo after undo

- **WHEN** the user undoes the rename and then triggers redo
- **THEN** N's text is "B" again

#### Scenario: Undo a multi-child add

- **WHEN** one `add_children` op inserting two nodes is dispatched and the user triggers undo once
- **THEN** both nodes are gone and `canRedo` is true

### Requirement: Grouped ops undo together

Ops dispatched between `beginGroup` and `endGroup` SHALL be applied immediately and SHALL form a single history entry; undoing it SHALL revert all of them in reverse order. `endGroup` after zero applied ops SHALL push nothing.

#### Scenario: Multi-select delete is one step

- **WHEN** three selected nodes are deleted as a group and the user triggers undo once
- **THEN** all three nodes are restored at their original parents and indices

#### Scenario: Empty group leaves no entry

- **WHEN** `beginGroup` is followed directly by `endGroup`
- **THEN** no history entry is added and `canUndo` is unchanged

### Requirement: Groups are atomic and never nested

`beginGroup` while a group is open SHALL throw `group-open`; `endGroup` or `cancelGroup` without an open group SHALL throw `no-group`; an op rejected by the reducer inside a group SHALL cancel the group (the inverses of the ops already applied in it are applied in reverse, no entry is pushed, the error propagates); `cancelGroup` SHALL perform the same revert on request; `undo` and `redo` while a group is open SHALL throw `group-open`.

#### Scenario: Nested beginGroup is rejected

- **WHEN** `beginGroup` is called while a group is open
- **THEN** it throws `group-open` and the open group is unaffected

#### Scenario: Rejected op cancels the group

- **WHEN** a group has applied two ops and the third dispatch is rejected with a `TreeOpError`
- **THEN** the map equals its state before `beginGroup`, no history entry was added, and the `TreeOpError` reaches the caller

#### Scenario: Cancelled group leaves no entry

- **WHEN** a group applies `add_children` and `update_node` and then `cancelGroup` is called
- **THEN** the map equals its state before `beginGroup`, no history entry was added and `canRedo` is unchanged

#### Scenario: Undo while a group is open

- **WHEN** `undo` is called between `beginGroup` and `endGroup`
- **THEN** it throws `group-open` and nothing changes

### Requirement: Creating a node is one undo step

Creating a node from the canvas SHALL open a group that ends when a non-empty title is committed and is cancelled when the title is committed empty or the editor is escaped, so that create-and-name is one entry and an abandoned node leaves none (design D3).

#### Scenario: Create and name is one step

- **WHEN** a node is created with Tab, titled "想法" and committed, and the user triggers undo once
- **THEN** the node is gone and one redo re-creates it with the title "想法"

#### Scenario: Abandoned node leaves no entry

- **WHEN** a node is created with Tab and committed with empty text
- **THEN** the node is gone and `canUndo` equals its value before the Tab

### Requirement: New ops clear the redo stack

Dispatching a new op or ending a non-empty group after an undo SHALL discard the redo history.

#### Scenario: Branching history

- **WHEN** the user undoes an op and then dispatches a different op
- **THEN** redo is unavailable

### Requirement: History is bounded and not persisted

History SHALL keep at most 200 entries, discarding the oldest; history SHALL NOT survive a page reload.

#### Scenario: Reload clears history

- **WHEN** the user makes changes, reloads the editor, and triggers undo
- **THEN** nothing changes, `canUndo` is false and the 撤销 toolbar button is disabled

#### Scenario: Cap at 200

- **WHEN** 201 ops are dispatched individually
- **THEN** exactly 200 undo steps are available

### Requirement: Undo of an op that touched a floating root restores its position

When undo reverts a detach, an attach, a delete of a floating root or a position change, the subtree SHALL return to its prior parent and index, or its prior roots index and position.

#### Scenario: Undo a detach

- **WHEN** node C was detached into a floating root and the user triggers undo
- **THEN** C is back under its original parent at its original index and no longer has a position

#### Scenario: Undo deleting a floating root

- **WHEN** floating root F at roots index 2, position (300, 200), was deleted and the user triggers undo
- **THEN** F is back at roots index 2 with position (300, 200) and its subtree
