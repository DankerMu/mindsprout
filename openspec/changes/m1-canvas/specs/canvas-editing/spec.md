# Spec Delta

## Purpose

Direct manipulation of a map on the editor canvas: creating, editing, selecting, reorganising, annotating and colouring nodes with mouse and keyboard, without any AI involvement.

## ADDED Requirements

### Requirement: Create child and sibling nodes

The user SHALL be able to add a child to the selected node (Tab, context menu) and a sibling after it (Enter, context menu). On any root — the primary root or a floating root — Enter SHALL add a child instead, because a root has no sibling list; the menu item 添加兄弟节点 SHALL be disabled on every root. A new node SHALL be created with empty text and enter inline editing immediately; creation and naming SHALL be one undo step (design D3). When the parent is collapsed, creation SHALL first expand it (`update_node { collapsed: false }`) inside the same undo group, so the new child is visible and editable, and one undo SHALL remove the child and re-collapse the parent; a cancelled creation SHALL re-collapse it too.

#### Scenario: Tab adds a child

- **WHEN** node N is selected and the user presses Tab
- **THEN** a new node appears as N's last child, is selected, and its title input is focused

#### Scenario: Tab on a collapsed node

- **WHEN** collapsed node N (two hidden children) is selected and the user presses Tab
- **THEN** N expands, a new node appears as N's third child with its title input focused, and after naming it one Cmd/Ctrl+Z removes the new child and leaves N collapsed again

#### Scenario: Enter on the primary root

- **WHEN** the primary root is selected and the user presses Enter
- **THEN** a new child of the primary root is created, not a sibling

#### Scenario: Enter on a floating root

- **WHEN** floating root F is selected and the user presses Enter
- **THEN** a new child of F is created and F stays a floating root at its position

#### Scenario: Name a new node

- **WHEN** a node created with Tab is titled "想法" and committed with Enter, and the user presses Cmd/Ctrl+Z once
- **THEN** the node is gone (creation and naming were one undo step)

### Requirement: Inline title editing

Double-click or F2 on a node SHALL open a single-line editor for that node only, whatever the selection; Enter SHALL commit one text update; Esc SHALL discard; blur SHALL commit. The title SHALL accept any length. A committed empty title, or Esc, on a node created in this session and not yet named SHALL remove that node and leave no history entry (design D3 `cancelGroup`).

#### Scenario: Commit a rename

- **WHEN** the user double-clicks existing node N, types "新想法", and presses Enter
- **THEN** N's text is "新想法" and exactly one undo step was added

#### Scenario: Escape discards

- **WHEN** the user opens the editor on existing node N, types, and presses Esc
- **THEN** N's text is unchanged and no undo step was added

#### Scenario: Long title

- **WHEN** the user commits a 200-character title on node N
- **THEN** N's text is the full 200 characters

#### Scenario: Empty new node is discarded

- **WHEN** a node created with Tab is committed with empty text
- **THEN** the node is removed and the creation plus removal leave no net undo step (the 撤销 button state equals its state before the Tab)

#### Scenario: Rename with three nodes selected

- **WHEN** three nodes are selected and the user presses F2
- **THEN** only the primary (last clicked) selected node enters editing and committing changes only that node

### Requirement: Delete selection

Delete or Backspace (outside an editor) and the context menu SHALL delete the selection as one undo step. The selection SHALL first be normalised to its top-most nodes (a node whose ancestor is selected is skipped — it goes with its ancestor), the primary root SHALL be skipped with the notice "主根不能删除", and floating roots SHALL be deletable. Nothing is dispatched for the primary root, so the group never hits a reducer rejection.

#### Scenario: Delete two selected subtrees

- **WHEN** nodes A and B (each with children) are selected and the user presses Delete
- **THEN** A, B and their descendants are gone, and one undo restores all of them

#### Scenario: Primary root in selection

- **WHEN** the selection includes the primary root and the user presses Delete
- **THEN** every other selected node is deleted, the primary root remains, and the user sees the notice "主根不能删除"

#### Scenario: Select all then Delete

- **WHEN** the user presses Cmd/Ctrl+A and then Delete on a map with a primary tree and one floating root
- **THEN** only the primary root remains (childless), and one undo restores every node including the floating root at its position

#### Scenario: Delete a floating root from the canvas

- **WHEN** floating root F with two children is selected and the user presses Delete
- **THEN** F and its children are gone and one undo restores F at its previous position

### Requirement: Selection

Click SHALL select a single node; Shift+click SHALL toggle a node in the selection; drag on empty canvas SHALL rubber-band select; Cmd/Ctrl+A SHALL select all visible nodes; Esc SHALL clear the selection; arrow keys SHALL move a single selection to parent (←, a no-op on any root), first child (→, a no-op on a collapsed node — its children are not rendered and the selection SHALL stay visible), previous (↑) or next (↓) sibling.

#### Scenario: Rubber-band selection

- **WHEN** the user drags a rectangle over three nodes on empty canvas
- **THEN** exactly those three nodes are selected

#### Scenario: Arrow navigation

- **WHEN** node N with two children is selected and the user presses →
- **THEN** N's first child is the only selected node

#### Scenario: Arrow left on a floating root

- **WHEN** floating root F is selected and the user presses ←
- **THEN** F stays the only selected node

#### Scenario: Arrow right on a collapsed node

- **WHEN** collapsed node N with two hidden children is selected and the user presses →
- **THEN** N stays the only selected node and no hidden node is selected

### Requirement: Undo and redo shortcuts and buttons

Cmd/Ctrl+Z SHALL undo and Cmd/Ctrl+Shift+Z SHALL redo the editor history; the toolbar SHALL show 撤销 and 重做 buttons that do the same and are disabled when `canUndo` / `canRedo` is false. Both shortcuts SHALL be inert while a text field has focus.

#### Scenario: Undo a Tab-created child with Cmd/Ctrl+Z

- **WHEN** the user creates and names a child with Tab and presses Cmd/Ctrl+Z
- **THEN** the child is gone and the 重做 button is enabled

#### Scenario: Redo with Cmd/Ctrl+Shift+Z

- **WHEN** the user presses Cmd/Ctrl+Shift+Z after that undo
- **THEN** the child is back with its title and the 重做 button is disabled

#### Scenario: Buttons reflect availability

- **WHEN** the editor opens a freshly loaded map
- **THEN** both 撤销 and 重做 buttons are disabled

### Requirement: Drag to reparent, detach and reposition

Dragging one or more selected nodes and dropping on another node SHALL move them (with subtrees) under that node as one undo step; dropping on empty canvas SHALL detach a tree node into a floating root at the drop point, or reposition a floating root. The dragged set SHALL be the selection normalised to its top-most nodes (descendants of a dragged node move with it). A drop SHALL be refused — the nodes snap back, nothing is dispatched, no undo step is added — when it would create a cycle, when the primary root is in the dragged set, or when the target is a dragged node or a descendant of one. A group drop on empty canvas SHALL detach each top-most tree node as its own floating root, each offset from the drop point by its laid-out offset from the grabbed node, and reposition floating members by the same delta, all as one undo step.

#### Scenario: Reparent by drop

- **WHEN** the user drags node C and drops it on node P
- **THEN** C is the last child of P and one undo restores C's previous parent and index

#### Scenario: Detach to canvas

- **WHEN** the user drags node C and drops it on empty canvas at (400, 300)
- **THEN** C becomes a floating root at (400, 300) with its subtree intact

#### Scenario: Refused cycle

- **WHEN** the user drags node A and drops it on A's descendant D
- **THEN** nothing changes, A returns to its laid-out position, and no undo step is added

#### Scenario: Group drag

- **WHEN** nodes A and B (different parents, each with a child) are selected and dropped on node P
- **THEN** A and B are P's last two children with their children intact, and one undo restores both to their previous parents and indices

#### Scenario: Nested selection moves once

- **WHEN** node A and its child D are both selected and dropped on node P
- **THEN** A is P's last child, D is still A's child, and one undo restores A

#### Scenario: Drop on a selected node is refused

- **WHEN** nodes A and B are selected and the user drops them on B
- **THEN** nothing changes, both snap back, and no undo step is added

#### Scenario: Group detach to canvas

- **WHEN** nodes A and B (A laid out 80 px above B) are selected, grabbed by A, and dropped on empty canvas at (400, 300)
- **THEN** A is a floating root at (400, 300), B is a floating root at (400, 380), and one undo restores both

### Requirement: Context menu

Right-click on a node SHALL open a menu with: 添加子节点, 添加兄弟节点, 重命名, 删除, 折叠/展开, 设置颜色 (six tokens plus 无颜色), 编辑备注, 脱离为浮动节点. 添加兄弟节点 and 脱离为浮动节点 SHALL be disabled on every root (primary or floating); 删除 SHALL be disabled on the primary root only. 重命名, 折叠/展开 and 编辑备注 SHALL act on the right-clicked node only, regardless of the selection; 删除 and 设置颜色 SHALL act on the whole selection when the target is selected. 脱离为浮动节点 SHALL act on the right-clicked node only, regardless of the selection: it SHALL dispatch one `move_node { id: target, newParentId: null, position }` where `position` is the target's current laid-out canvas position, so the node stays where it is with its subtree and only its parent link is cut; one undo SHALL restore it under its previous parent at its previous index. The menu SHALL be built from a registry so later features can add items.

#### Scenario: Menu on the primary root

- **WHEN** the user right-clicks the primary root
- **THEN** the menu shows all eight items with 添加兄弟节点, 删除 and 脱离为浮动节点 disabled

#### Scenario: Menu on a floating root

- **WHEN** the user right-clicks floating root F
- **THEN** 添加兄弟节点 and 脱离为浮动节点 are disabled, 删除 is enabled, and choosing 删除 removes F with its subtree

#### Scenario: Detach from the menu

- **WHEN** the user right-clicks child C (laid out at (x, y), with one child) and chooses 脱离为浮动节点
- **THEN** C is a floating root at (x, y) with its subtree intact, C's previous parent no longer lists it, and one undo restores C under its previous parent at its previous index

#### Scenario: Set color from the menu

- **WHEN** the user picks "blue" under 设置颜色 for node N
- **THEN** N renders with the blue token and one undo step was added

#### Scenario: Clear a color from the menu

- **WHEN** node N carries "blue" and the user picks 无颜色 under 设置颜色
- **THEN** N renders without a color token, one undo step was added, and undo restores "blue"

#### Scenario: Collapse with three nodes selected

- **WHEN** three nodes with children are selected and the user right-clicks one of them and chooses 折叠
- **THEN** only the right-clicked node is collapsed, the other two remain expanded, and one undo step was added

### Requirement: Color tokens

A node's color SHALL be one of six tokens (red, orange, yellow, green, blue, purple) or unset; the token SHALL map to theme colors in light and dark mode; clearing SHALL dispatch `update_node { color: null }`. Setting or clearing a color on a multi-selection SHALL apply to every selected node as one undo step.

#### Scenario: Group color

- **WHEN** three nodes are selected and the user sets "green"
- **THEN** all three carry the green token and one undo removes it from all three (restoring any previous token)

### Requirement: Note panel

Selecting a single node SHALL show a side panel with a plain multi-line text area for its note; leaving the field SHALL commit one update (an emptied note dispatches `note: null`); a node with a non-empty note SHALL show an indicator on the canvas. Markdown SHALL NOT be rendered.

#### Scenario: Add a note

- **WHEN** the user types two lines into the note panel of node N and clicks elsewhere
- **THEN** N's note contains both lines, N shows the note indicator, and one undo step was added

### Requirement: Shortcuts are inert while editing text

While a title editor or the note field has focus, canvas shortcuts (Tab, Enter, Delete/Backspace, arrows, F2, Cmd/Ctrl+A, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) SHALL act on the text field only.

#### Scenario: Delete inside the editor

- **WHEN** the user is editing a title and presses Backspace
- **THEN** a character is removed and no node is deleted

#### Scenario: Undo inside the editor

- **WHEN** the user is editing a title, types, and presses Cmd/Ctrl+Z
- **THEN** the text field's own undo runs and the map history is unchanged
