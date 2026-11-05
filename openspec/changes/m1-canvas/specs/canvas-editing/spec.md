# Spec Delta

## Purpose

Direct manipulation of a map on the editor canvas: creating, editing, selecting, reorganising, annotating and colouring nodes with mouse and keyboard, without any AI involvement.

## ADDED Requirements

### Requirement: Create child and sibling nodes

The user SHALL be able to add a child to the selected node (Tab, context menu) and a sibling after it (Enter, context menu); on the primary root, "sibling" SHALL add a child instead. A new node SHALL be created with empty text and enter inline editing immediately.

#### Scenario: Tab adds a child

- **WHEN** node N is selected and the user presses Tab
- **THEN** a new node appears as N's last child, is selected, and its title input is focused

#### Scenario: Enter on the primary root

- **WHEN** the primary root is selected and the user presses Enter
- **THEN** a new child of the primary root is created, not a sibling

### Requirement: Inline title editing

Double-click or F2 on a node SHALL open a single-line editor; Enter SHALL commit one text update; Esc SHALL discard; blur SHALL commit. A committed empty title on a newly created node SHALL remove that node.

#### Scenario: Commit a rename

- **WHEN** the user double-clicks node N, types "新想法", and presses Enter
- **THEN** N's text is "新想法" and exactly one undo step was added

#### Scenario: Escape discards

- **WHEN** the user opens the editor on N, types, and presses Esc
- **THEN** N's text is unchanged and no undo step was added

#### Scenario: Empty new node is discarded

- **WHEN** a node created with Tab is committed with empty text
- **THEN** the node is removed and the creation plus removal leave no net undo step

### Requirement: Delete selection

Delete or Backspace (outside an editor) and the context menu SHALL delete every selected node with its subtree, except the primary root, as one undo step.

#### Scenario: Delete two selected subtrees

- **WHEN** nodes A and B (each with children) are selected and the user presses Delete
- **THEN** A, B and their descendants are gone, and one undo restores all of them

#### Scenario: Primary root in selection

- **WHEN** the selection includes the primary root and the user presses Delete
- **THEN** every other selected node is deleted, the primary root remains, and the user sees a notice that the primary root cannot be deleted

### Requirement: Selection

Click SHALL select a single node; Shift+click SHALL toggle a node in the selection; drag on empty canvas SHALL rubber-band select; Cmd/Ctrl+A SHALL select all visible nodes; Esc SHALL clear the selection; arrow keys SHALL move a single selection to parent (←), first child (→), previous (↑) or next (↓) sibling.

#### Scenario: Rubber-band selection

- **WHEN** the user drags a rectangle over three nodes on empty canvas
- **THEN** exactly those three nodes are selected

#### Scenario: Arrow navigation

- **WHEN** node N with two children is selected and the user presses →
- **THEN** N's first child is the only selected node

### Requirement: Drag to reparent, detach and reposition

Dragging one or more selected nodes and dropping on another node SHALL move them (with subtrees) under that node as one undo step; dropping on empty canvas SHALL detach a tree node into a floating root at the drop point, or reposition a floating root; a drop that would create a cycle SHALL be refused with the node snapping back.

#### Scenario: Reparent by drop

- **WHEN** the user drags node C and drops it on node P
- **THEN** C is the last child of P and one undo restores C's previous parent and index

#### Scenario: Detach to canvas

- **WHEN** the user drags node C and drops it on empty canvas at (400, 300)
- **THEN** C becomes a floating root at (400, 300) with its subtree intact

#### Scenario: Refused cycle

- **WHEN** the user drags node A and drops it on A's descendant D
- **THEN** nothing changes, A returns to its laid-out position, and no undo step is added

### Requirement: Context menu

Right-click on a node SHALL open a menu with: 添加子节点, 添加兄弟节点, 重命名, 删除, 折叠/展开, 设置颜色 (six tokens), 编辑备注, 脱离为浮动节点. Items that do not apply to the target (sibling/detach/delete on the primary root) SHALL be disabled. The menu SHALL be built from a registry so later features can add items.

#### Scenario: Menu on the primary root

- **WHEN** the user right-clicks the primary root
- **THEN** the menu shows all eight items with 添加兄弟节点, 删除 and 脱离为浮动节点 disabled

#### Scenario: Set color from the menu

- **WHEN** the user picks "blue" under 设置颜色 for node N
- **THEN** N renders with the blue token and one undo step was added

### Requirement: Color tokens

A node's color SHALL be one of six tokens (red, orange, yellow, green, blue, purple) or unset; the token SHALL map to theme colors in light and dark mode. Setting a color on a multi-selection SHALL apply to every selected node as one undo step.

#### Scenario: Group color

- **WHEN** three nodes are selected and the user sets "green"
- **THEN** all three carry the green token and one undo removes it from all three

### Requirement: Note panel

Selecting a single node SHALL show a side panel with a plain multi-line text area for its note; leaving the field SHALL commit one update; a node with a non-empty note SHALL show an indicator on the canvas. Markdown SHALL NOT be rendered.

#### Scenario: Add a note

- **WHEN** the user types two lines into the note panel of node N and clicks elsewhere
- **THEN** N's note contains both lines, N shows the note indicator, and one undo step was added

### Requirement: Shortcuts are inert while editing text

While a title editor or the note field has focus, canvas shortcuts (Tab, Enter, Delete, arrows, Cmd/Ctrl+A) SHALL act on the text field only.

#### Scenario: Delete inside the editor

- **WHEN** the user is editing a title and presses Backspace
- **THEN** a character is removed and no node is deleted
