# Spec Delta

## ADDED Requirements

### Requirement: Matching-identity autosave verification readiness

The matching-identity autosave acceptance walk SHALL establish that the actual root node is available for interaction after the editor becomes ready and before reading or manipulating that node. Editor-level readiness alone SHALL NOT be treated as proof of node-level availability, and the acceptance walk SHALL preserve every existing rename, autosave payload, matching-key and peer-preservation outcome.

#### Scenario: Editor ready before root-node interaction

- **WHEN** the acceptance walk opens a matching-identity map and observes the editor-ready state
- **THEN** it waits for the actual root node before the original text assertion and double-click interaction
- **AND** the renamed text, debounced save payload, matching storage key and unchanged peer record are still verified without a skipped or weakened assertion
