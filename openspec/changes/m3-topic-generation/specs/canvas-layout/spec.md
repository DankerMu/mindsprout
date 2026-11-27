# Spec Delta

## ADDED Requirements

### Requirement: Layout changes animate and new nodes fade in

The canvas SHALL animate layout changes as follows:

- When a layout change moves a rendered node, the node SHALL transition to its new position with a 200 ms transform transition.
- A newly rendered node SHALL fade in from opacity 0 to 1 over 200 ms.
- Both SHALL settle exactly at the positions the deterministic layout computes.
- The live drag preview SHALL follow the pointer without transition.
- When the user prefers reduced motion, neither the transition nor the fade SHALL be applied.

#### Scenario: Sibling shifts smoothly

- **WHEN** a child is added above an existing sibling with motion allowed
- **THEN** the sibling's computed style carries the 200 ms transform transition and its box settles exactly at the computed layout position

#### Scenario: New node fades in

- **WHEN** a node is created with motion allowed
- **THEN** the new node's content carries the 200 ms opacity fade-in and settles at opacity 1

#### Scenario: Drag preview is immediate

- **WHEN** a node is being dragged
- **THEN** the dragged nodes carry no transform transition

#### Scenario: Reduced motion

- **WHEN** the user agent prefers reduced motion
- **THEN** layout changes and new nodes appear at their final positions without transition or fade
