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
