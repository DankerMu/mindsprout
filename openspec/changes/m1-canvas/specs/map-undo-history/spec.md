# Spec Delta

## Purpose

Undo and redo over applied TreeOps so that every change a user or an AI session makes can be reverted in predictable steps.

## ADDED Requirements

### Requirement: One applied op is one undo step

Each TreeOp dispatched outside a group SHALL create exactly one history entry; undo SHALL revert the most recent entry and redo SHALL re-apply the most recently undone entry.

#### Scenario: Undo a rename

- **WHEN** the user renames node N from "A" to "B" and then triggers undo
- **THEN** N's text is "A" and redo is available

#### Scenario: Redo after undo

- **WHEN** the user undoes the rename and then triggers redo
- **THEN** N's text is "B" again

### Requirement: Grouped ops undo together

Ops dispatched between `beginGroup` and `endGroup` SHALL form a single history entry; undoing it SHALL revert all of them in reverse order.

#### Scenario: Multi-select delete is one step

- **WHEN** three selected nodes are deleted as a group and the user triggers undo once
- **THEN** all three nodes are restored at their original parents and indices

### Requirement: New ops clear the redo stack

Dispatching a new op after an undo SHALL discard the redo history.

#### Scenario: Branching history

- **WHEN** the user undoes an op and then dispatches a different op
- **THEN** redo is unavailable

### Requirement: History is bounded and not persisted

History SHALL keep at most 200 entries, discarding the oldest; history SHALL NOT survive a page reload.

#### Scenario: Reload clears history

- **WHEN** the user makes changes, reloads the editor, and triggers undo
- **THEN** nothing changes and undo is reported unavailable

#### Scenario: Cap at 200

- **WHEN** 201 ops are dispatched individually
- **THEN** exactly 200 undo steps are available

### Requirement: Undo of an op that touched a floating root restores its position

When undo reverts a detach or a position change, the subtree SHALL return to its prior parent and index, or its prior position.

#### Scenario: Undo a detach

- **WHEN** node C was detached into a floating root and the user triggers undo
- **THEN** C is back under its original parent at its original index and no longer has a position
