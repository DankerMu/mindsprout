# Spec Delta

## ADDED Requirements

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
