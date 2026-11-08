# Spec Delta

## Purpose

Defines the MindMap forest model and the TreeOp protocol: the only way any actor (human UI or AI provider) changes a map's tree state, with the invariants the reducer enforces.

## ADDED Requirements

### Requirement: MindMap is a forest with one primary root

A MindMap SHALL hold an ordered list of roots whose first entry is the primary root; every further root is a floating subtree with a canvas position. Non-root nodes SHALL NOT carry a position. A map with a primary root SHALL be obtainable only through the domain factory `createMindMap`; no TreeOp creates a primary root.

#### Scenario: New map has exactly one root

- **WHEN** `createMindMap({ title: "新导图", rootText: "新导图" })` is called
- **THEN** its roots list contains one node, the primary root, with text "新导图", no children and no position, and the map's title is "新导图"

#### Scenario: Floating root carries a position

- **WHEN** an `add_root` op with text "灵感" and position (120, 40) is applied
- **THEN** the map has a second root with that text and position, and the primary root is unchanged

### Requirement: Tree state and map metadata are separate

`title`, `createdAt` and `updatedAt` are map metadata, not tree state: the reducer SHALL NOT read or modify them, and applying an op SHALL leave them byte-identical. The application layer sets `updatedAt` when it saves or renames a map (spec map-persistence, map-library).

#### Scenario: Reducer leaves metadata untouched

- **WHEN** any valid op is applied to a map whose `updatedAt` is "2026-11-05T10:00:00.000Z"
- **THEN** the returned map has the same `id`, `title`, `createdAt` and `updatedAt` as the input

### Requirement: Every mutation is a TreeOp applied by the reducer

The system SHALL expose a pure reducer that takes a map and one TreeOp (`add_children`, `add_root`, `update_node`, `delete_node`, `move_node`, `set_root_position`, `replace_children`) and returns the new map plus the exact inverse: an ordered list of one or more ops that restores the input map. The input map SHALL NOT be mutated.

#### Scenario: Applying then applying the inverse restores the map

- **WHEN** any valid op is applied to a map and the returned inverse ops are then applied in order to the result
- **THEN** the final map is structurally equal to the original map

#### Scenario: Input map is untouched

- **WHEN** an op is applied
- **THEN** the map object passed in is deep-equal to its state before the call

#### Scenario: Inverse of a multi-child add

- **WHEN** `add_children` inserts two children X and Y under P
- **THEN** the inverse is `[delete_node(Y), delete_node(X)]` and applying it leaves P's children as before

### Requirement: Ops are validated before they are applied

The reducer SHALL validate the op payload against the strict TreeOp schema (unknown keys rejected) and then against the map state, and SHALL reject invalid ops with a `TreeOpError` whose `code` names the violated rule (`invalid-op`, `unknown-node`, `primary-root-protected`, `cycle`, `invalid-target` — the rejection table in design D2); a rejected op SHALL leave the map unchanged.

#### Scenario: Unknown node id

- **WHEN** `update_node` targets an id that does not exist in the map
- **THEN** the reducer throws a `TreeOpError` with code `unknown-node` and returns no new map

#### Scenario: Malformed payload

- **WHEN** an op object is missing a required field (for example `move_node` without `id`)
- **THEN** schema validation fails with code `invalid-op` carrying the schema issues, before any tree traversal happens

#### Scenario: Creation payload cannot carry a position

- **WHEN** `add_children` includes a child object with a `position` field
- **THEN** schema validation fails with code `invalid-op`

### Requirement: Creation payloads carry whole subtrees

`add_children`, `add_root` and `replace_children` SHALL accept `NewNode` payloads that may carry `note`, `color`, `collapsed` and nested `children`, so that a deleted subtree can be restored by its inverse without loss.

#### Scenario: Add a subtree in one op

- **WHEN** `add_children` inserts a node with `collapsed: true` and two nested grandchildren under P
- **THEN** P's new child is collapsed and has both grandchildren in payload order

### Requirement: Partial updates can clear optional fields

`update_node` SHALL leave every absent field untouched; `note: null` and `color: null` SHALL remove the field; the inverse SHALL restore the previous value or `null` when the field was absent.

#### Scenario: Clear a color

- **WHEN** `update_node { color: null }` is applied to a node carrying "blue"
- **THEN** the node has no color and the inverse is `update_node { color: "blue" }`

#### Scenario: Inverse of setting a color on an uncoloured node

- **WHEN** `update_node { color: "green" }` is applied to a node without a color
- **THEN** the inverse is `update_node { color: null }` and applying it removes the color

#### Scenario: Expanded is stored as no flag

- **WHEN** `update_node { collapsed: false }` is applied to a collapsed node, or `add_children` inserts a `NewNode` carrying `collapsed: false`
- **THEN** the stored node has no `collapsed` field (the reducer never stores `collapsed: false`), and the inverse of `update_node { collapsed: true }` on a node without the flag, `update_node { collapsed: false }`, restores a node deep-equal to the original

### Requirement: Reparenting never creates a cycle

`move_node` SHALL be rejected when the new parent is the moved node itself or any of its descendants.

#### Scenario: Move a node under its own child

- **WHEN** `move_node` asks to place node A under node B, and B is a child of A
- **THEN** the reducer throws a `TreeOpError` with code `cycle` and the map is unchanged

### Requirement: The primary root is protected

`delete_node`, `move_node` and `set_root_position` SHALL be rejected for the primary root. `update_node` on the primary root SHALL be allowed.

#### Scenario: Deleting the primary root

- **WHEN** `delete_node` targets `roots[0]`
- **THEN** the reducer throws a `TreeOpError` with code `primary-root-protected`

#### Scenario: Positioning the primary root

- **WHEN** `set_root_position` targets `roots[0]`
- **THEN** the reducer throws a `TreeOpError` with code `primary-root-protected` and the map is unchanged

#### Scenario: Renaming the primary root

- **WHEN** `update_node` sets the primary root's text to "新标题"
- **THEN** the primary root's text is "新标题" and its children are unchanged

### Requirement: Detaching and attaching floating subtrees

`move_node` with a `null` new parent SHALL detach a tree node with its subtree into a new floating root at the given position (at roots index `index`, default last); `move_node` on a floating root with a non-null new parent SHALL attach the subtree under that parent and drop its position. The inverse of an attach SHALL restore the floating root at its previous roots index and position.

#### Scenario: Detach a child into a floating root

- **WHEN** `move_node` is applied to child C with `newParentId: null` and position (300, 200)
- **THEN** C is removed from its parent's children, appears as the last root with position (300, 200), and keeps all its descendants

#### Scenario: Attach a floating root under a node

- **WHEN** `move_node` is applied to floating root F (roots index 2, position (300, 200)) with `newParentId` = node P
- **THEN** F is removed from the roots list, appears as the last child of P, has no position, and the inverse is `move_node { id: F, newParentId: null, position: (300, 200), index: 2 }`

### Requirement: Only floating roots carry and change position

`set_root_position` SHALL be accepted only for floating roots; `move_node` with `null` SHALL be accepted only for nodes that are not already roots; the `move_node` schema SHALL be a discriminated union on `newParentId` so that `position` is required with `null` and forbidden with a node id.

#### Scenario: Position a non-root node

- **WHEN** `set_root_position` targets a child node
- **THEN** the reducer throws a `TreeOpError` with code `invalid-target` and the map is unchanged

#### Scenario: Detach a node that is already floating

- **WHEN** `move_node` with `newParentId: null` targets floating root F
- **THEN** the reducer throws a `TreeOpError` with code `invalid-target` (callers use `set_root_position`)

#### Scenario: Detach without a position

- **WHEN** `move_node` carries `newParentId: null` and no `position`
- **THEN** schema validation fails with code `invalid-op`

#### Scenario: Reparent with a position

- **WHEN** `move_node` carries a non-null `newParentId` and a `position`
- **THEN** schema validation fails with code `invalid-op`

### Requirement: Deleting removes the whole subtree

`delete_node` SHALL remove the target node and all descendants; the inverse SHALL restore the subtree, including collapsed flags, at the same parent and index, or — for a floating root — at the same roots index with the same position.

#### Scenario: Delete a node with children

- **WHEN** `delete_node` targets node N that has three descendants
- **THEN** none of the four nodes remain in the map, and applying the inverse restores all four at N's original position among its siblings

#### Scenario: Delete a collapsed node with grandchildren

- **WHEN** `delete_node` targets node N with `collapsed: true`, one child and two grandchildren
- **THEN** the inverse is a single `add_children` whose `NewNode` carries `collapsed: true` and the nested grandchildren, and applying it restores N collapsed with the same descendants at the same index

#### Scenario: Delete a floating root

- **WHEN** `delete_node` targets floating root F at roots index 2 with position (300, 200) and two children
- **THEN** F and its subtree are gone, the inverse is `add_root` with F's subtree, position (300, 200) and index 2, and applying it restores F at roots index 2 with position (300, 200) and both children

### Requirement: Node ids are unique and caller-generated

Ops that create nodes SHALL carry caller-generated ids; the reducer SHALL reject an op that would introduce an id already present in the map (outside the subtree the op replaces) or duplicated inside the payload.

#### Scenario: Duplicate id on add

- **WHEN** `add_children` includes a child whose id already exists anywhere in the map
- **THEN** the reducer throws a `TreeOpError` with code `invalid-target` and the map is unchanged

#### Scenario: Duplicate id inside one payload

- **WHEN** `add_children` includes two nodes (at any nesting) with the same id
- **THEN** the reducer throws a `TreeOpError` with code `invalid-target` and the map is unchanged

### Requirement: replace_children swaps a node's subtree

`replace_children` SHALL replace the whole child list of `parentId` with the supplied `NewNode` subtrees; ids that exist only inside the replaced subtree MAY be reused by the payload; any other existing id or a duplicate inside the payload SHALL be rejected with `invalid-target`; a supplied node carrying `position` SHALL fail schema validation (`invalid-op`); the inverse SHALL be `replace_children` with the previous children.

#### Scenario: Reuse of replaced ids is accepted

- **WHEN** P has children [a, b] and `replace_children` supplies [a (new text), c]
- **THEN** P's children are a and c in that order and b no longer exists

#### Scenario: External duplicate is rejected

- **WHEN** `replace_children` on P supplies a node whose id belongs to a node outside P's subtree
- **THEN** the reducer throws a `TreeOpError` with code `invalid-target` and the map is unchanged

#### Scenario: Inverse restores the old children

- **WHEN** P's children [a, b] are replaced by [c] and the inverse is applied
- **THEN** P's children are a and b again with their original descendants
