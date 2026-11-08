# Spec Delta

## MODIFIED Requirements

### Requirement: Unreadable map shows an error state

Opening `/maps/<id>` for a stored map that cannot be read or rendered SHALL show an error state with a link back to the library. It SHALL never show the not-found state or a blank page, and SHALL modify nothing. A stored map whose embedded ID differs from the requested route ID SHALL be rejected before mounting an autosave-capable editor; rejection SHALL issue no put and SHALL preserve both the requested record and any peer record named by the embedded ID. Matching-ID maps SHALL retain normal editing and autosave behavior.

#### Scenario: Corrupt record

- **WHEN** the stored record for `/maps/<id>` holds a floating root without a position
- **THEN** the page shows "无法打开这张导图" and a link to `/`, and not "找不到这张导图"

#### Scenario: Mismatched stored map identity

- **WHEN** a renderable v1 record under key A contains embedded map ID B, a distinct peer record exists under B, and the user opens `/maps/A`
- **THEN** the page shows the existing error state and back link without mounting a ready editor, issuing put, repairing or deleting either record
- **AND** raw records at A and B remain exactly unchanged after rejection and leaving the route

#### Scenario: Matching identity preserves normal persistence

- **WHEN** a record's embedded ID matches its requested route ID and the user edits a node title
- **THEN** the editor opens normally and autosaves the intended change under that same ID, without changing a distinct peer record
