# Spec Delta

## Purpose

Defines the MindMap forest model and the TreeOp protocol: the only way any actor (human UI or AI provider) changes a map, with the invariants the reducer enforces.

## ADDED Requirements

### Requirement: MindMap is a forest with one primary root

A MindMap SHALL hold an ordered list of roots whose first entry is the primary root; every further root is a floating subtree with a canvas position. Non-root nodes SHALL NOT carry a position.

#### Scenario: New map has exactly one root

- **WHEN** a map is created
- **THEN** its roots list contains one node, the primary root, and that node has no position

#### Scenario: Floating root carries a position

- **WHEN** an `add_root` op with text "灵感" and position (120, 40) is applied
- **THEN** the map has a second root with that text and position, and the primary root is unchanged

### Requirement: Every mutation is a TreeOp applied by the reducer

The system SHALL expose a pure reducer that takes a map and one TreeOp (`add_children`, `add_root`, `update_node`, `delete_node`, `move_node`, `set_root_position`, `replace_children`) and returns the new map plus the exact inverse op. The input map SHALL NOT be mutated.

#### Scenario: Applying then applying the inverse restores the map

- **WHEN** any valid op is applied to a map and the returned inverse is then applied to the result
- **THEN** the final map is structurally equal to the original map

#### Scenario: Input map is untouched

- **WHEN** an op is applied
- **THEN** the map object passed in is deep-equal to its state before the call

### Requirement: Ops are validated before they are applied

The reducer SHALL validate the op payload against the TreeOp schema and the map state, and SHALL reject invalid ops with a typed error naming the violated rule; a rejected op SHALL leave the map unchanged.

#### Scenario: Unknown node id

- **WHEN** `update_node` targets an id that does not exist in the map
- **THEN** the reducer throws an `unknown-node` error and returns no new map

#### Scenario: Malformed payload

- **WHEN** an op object is missing a required field (for example `move_node` without `id`)
- **THEN** schema validation fails before any tree traversal happens

### Requirement: Reparenting never creates a cycle

`move_node` SHALL be rejected when the new parent is the moved node itself or any of its descendants.

#### Scenario: Move a node under its own child

- **WHEN** `move_node` asks to place node A under node B, and B is a child of A
- **THEN** the reducer throws a `cycle` error and the map is unchanged

### Requirement: The primary root is protected

`delete_node` and `move_node` SHALL be rejected for the primary root. `update_node` on the primary root SHALL be allowed.

#### Scenario: Deleting the primary root

- **WHEN** `delete_node` targets `roots[0]`
- **THEN** the reducer throws a `primary-root-protected` error

#### Scenario: Renaming the primary root

- **WHEN** `update_node` sets the primary root's text to "新标题"
- **THEN** the primary root's text is "新标题" and its children are unchanged

### Requirement: Detaching and attaching floating subtrees

`move_node` with a `null` new parent SHALL detach the node with its subtree into a new floating root at the given position; `move_node` on a floating root with a non-null new parent SHALL attach the subtree under that parent and drop its position.

#### Scenario: Detach a child into a floating root

- **WHEN** `move_node` is applied to child C with `newParentId: null` and position (300, 200)
- **THEN** C is removed from its parent's children, appears as the last root with position (300, 200), and keeps all its descendants

#### Scenario: Attach a floating root under a node

- **WHEN** `move_node` is applied to floating root F with `newParentId` = node P
- **THEN** F is removed from the roots list, appears as the last child of P, and has no position

### Requirement: Deleting removes the whole subtree

`delete_node` SHALL remove the target node and all descendants; the inverse SHALL restore the subtree at the same parent and index.

#### Scenario: Delete a node with children

- **WHEN** `delete_node` targets node N that has three descendants
- **THEN** none of the four nodes remain in the map, and applying the inverse restores all four at N's original position among its siblings

### Requirement: Node ids are unique and caller-generated

Ops that create nodes SHALL carry caller-generated ids; the reducer SHALL reject an op that would introduce an id already present in the map.

#### Scenario: Duplicate id on add

- **WHEN** `add_children` includes a child whose id already exists anywhere in the map
- **THEN** the reducer throws an `invalid-target` error and the map is unchanged
