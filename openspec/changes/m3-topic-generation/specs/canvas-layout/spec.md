# Spec Delta

## ADDED Requirements

### Requirement: Layout changes animate and new nodes fade in

When a layout change moves a rendered node, the node SHALL transition to its new position over about 200 ms. A newly rendered node SHALL fade in over about 200 ms. Both SHALL settle at exactly the positions the deterministic layout computes. The live drag preview SHALL follow the pointer without transition. When the user prefers reduced motion, neither transition nor fade SHALL be applied.

#### Scenario: Sibling shifts smoothly

- **WHEN** a child is added above an existing sibling with motion allowed
- **THEN** the sibling moves to its new position through a transition and ends exactly at the computed layout position

#### Scenario: Drag preview is immediate

- **WHEN** a node is being dragged
- **THEN** the dragged nodes track the pointer without transition

#### Scenario: Reduced motion

- **WHEN** the user agent prefers reduced motion
- **THEN** layout changes and new nodes appear at their final positions without animation
