# map-library Specification Delta

## ADDED Requirements

### Requirement: Readable list presentation

The signed-in home page SHALL present maps without browser-default bullet markers, with consistent row spacing and wrapping, visually distinct timestamps and clearly styled action controls. Existing inline rename forms and delete confirmations SHALL remain visibly associated with the row that initiated them.

#### Scenario: Map rows and controls are visually structured

- **WHEN** a signed-in user's library contains maps
- **THEN** the list has no bullet markers, rows have consistent spacing and wrapping, and timestamps and action controls are visually distinguishable

#### Scenario: Inline mutations retain their visual target

- **WHEN** a user opens rename or delete confirmation from a map row, including one of two same-title rows
- **THEN** the form or confirmation remains within that initiating row and its controls remain visible and usable without changing the captured map target
