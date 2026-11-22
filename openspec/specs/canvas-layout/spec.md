# canvas-layout Specification

## Purpose

Automatic placement of the primary tree and floating subtrees on an infinite canvas, with collapse, pan and zoom, so users never position tree nodes by hand.

## Requirements

### Requirement: Primary tree is laid out left-to-right automatically

The primary root SHALL be placed at the canvas origin and its descendants to the right, siblings stacked vertically in child order, with no overlapping node boxes. Node sizes SHALL be measured from the rendered node and fed back to the layout; before the first measurement an estimate from the text length SHALL be used.

#### Scenario: Three-level tree renders without overlap

- **WHEN** a map with a root, two children and three grandchildren is opened
- **THEN** every node box is to the right of its parent, siblings do not overlap, and child order top-to-bottom matches the children array order

#### Scenario: Adding a child reflows siblings

- **WHEN** a second child is added to a node that had one child
- **THEN** both children are repositioned so neither overlaps and the parent stays vertically centred on them

#### Scenario: Measured size replaces the estimate

- **WHEN** a node's rendered width is measured wider than its text-length estimate
- **THEN** the layout is recomputed with the measured width and its right-hand neighbours no longer overlap it

### Requirement: Floating subtrees are laid out from their own position

Each floating root SHALL be placed at its stored position and its subtree laid out LR relative to it; the primary tree's layout SHALL NOT move when a floating root is moved.

#### Scenario: Move a floating root

- **WHEN** a floating root's position changes from (300, 200) to (500, 200)
- **THEN** every node in that subtree shifts by (+200, 0) and primary-tree node positions are unchanged

### Requirement: Collapsed nodes hide their subtree

A node with `collapsed: true` SHALL render a collapsed indicator with its descendant count and SHALL contribute no descendants to the layout; expanding restores them. In M1 the indicator is display only: collapse and expand SHALL be toggled solely through the context-menu item 折叠/展开 (spec canvas-editing "Context menu"); clicking the indicator SHALL NOT change the map.

#### Scenario: Collapse and expand

- **WHEN** the user collapses a node with four descendants
- **THEN** the four descendants are not rendered, the node shows "4", and the layout closes the gap; expanding renders them again in the same order

### Requirement: Canvas pans and zooms

The canvas SHALL support panning (Space+drag or middle-button drag) and wheel zoom clamped between 25% and 200%, and SHALL offer a "fit to content" action that frames all roots.

#### Scenario: Fit to content

- **WHEN** the user triggers fit-to-content on a map with a floating subtree far from the primary tree
- **THEN** both the primary tree and the floating subtree are fully visible in the viewport

#### Scenario: Zoom clamps

- **WHEN** the user wheel-zooms in past 200% and then out past 25%
- **THEN** the zoom stops at 200% and then at 25%

#### Scenario: Space-drag pans

- **WHEN** Space is held and the canvas is dragged 100 px to the right over a node
- **THEN** the viewport shifts by 100 px, no node is moved and the selection is unchanged

### Requirement: Layout is deterministic

The same map and the same node sizes SHALL always produce the same positions.

#### Scenario: Re-layout without changes

- **WHEN** layout runs twice on an unchanged map with identical measured sizes
- **THEN** both runs produce identical positions for every node

### Requirement: Large maps stay responsive while dragging

On a generated 500-node map, dragging a leaf node for two seconds SHALL keep the median frame time at or below 16.7 ms and the 95th percentile at or below 33 ms, measured with the Chrome DevTools Performance panel on a production build on the developer's machine (design D11). This requirement is verified by a manual profiling note in the PR's Runtime evidence, not by CI.

#### Scenario: 500-node drag profile

- **WHEN** the 500-node fixture is opened in a production build and a leaf is dragged for two seconds under the Performance recorder
- **THEN** the recorded median frame is ≤ 16.7 ms and p95 ≤ 33 ms, and the PR's Runtime evidence states both numbers and the memoisation applied if a first run missed them

### Requirement: Opening a map frames its measured content

When a map is opened, the canvas SHALL frame its measured content with padding after rendered node sizes are available. Initial zoom SHALL remain between the existing 25% minimum and 100%; a single-node map SHALL open at 100%. When all visible node boxes can fit within those zoom limits, every box SHALL be inside the padded canvas. When measured content cannot fit at 25%, the canvas SHALL center the measured content bounds at 25% and SHALL NOT zoom below the floor. This initial framing SHALL occur once per map opening and SHALL NOT persist or restore a viewport across sessions.

#### Scenario: Single-node map opens without magnification

- **WHEN** a newly created map containing only its primary root is opened
- **THEN** the complete root box is inside the padded canvas below the header and the zoom is 100%

#### Scenario: Measured map opens fully visible

- **WHEN** a map with a primary tree and a floating subtree is opened or reopened without activating fit-to-content
- **THEN** every visible node box is inside the padded canvas, initial zoom is between 25% and 100%, and no viewport from a previous session is restored

#### Scenario: Oversized measured map respects the zoom floor

- **WHEN** the deterministic 500-node map, whose measured bounds cannot fit in the canvas at 25%, is opened
- **THEN** the zoom is exactly 25%, the measured content bounds are centered, the primary root is visible, and all 500 nodes remain rendered without zooming below the floor

#### Scenario: Later edits do not restart initial framing

- **WHEN** the user pans or zooms after the initial framing and then changes map content without creating or editing an off-screen node
- **THEN** the canvas does not refit the whole map or restore the initial viewport

### Requirement: Creation and title editing keep their target visible

When keyboard creation or title editing targets a node outside the current viewport, the canvas SHALL translate by the smallest amount needed to reveal that node's complete box with padding. This movement SHALL preserve zoom and SHALL NOT move any map node or persist a viewport. A target already fully visible SHALL NOT cause viewport movement.

#### Scenario: Two keyboard-created siblings remain reachable

- **WHEN** a user creates two children with Tab/Enter without first activating fit-to-content
- **THEN** both child boxes are inside the canvas below the header and either child can be selected with the mouse

#### Scenario: Off-screen editing target is revealed

- **WHEN** the user pans away from a node and creates or starts title editing for that node
- **THEN** the target's complete box becomes visible with padding and the zoom is unchanged

#### Scenario: Visible editing target does not move the canvas

- **WHEN** title editing starts for a node whose complete box is already visible
- **THEN** the viewport remains unchanged
