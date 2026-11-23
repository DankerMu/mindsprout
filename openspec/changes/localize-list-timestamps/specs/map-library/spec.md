# map-library Specification Delta

## MODIFIED Requirements

### Requirement: List maps

The home page SHALL list every map of the signed-in user with its title and last-updated time (`MapSummary { id, title, updatedAt }`), most recently updated first. It SHALL never list another user's maps. An empty list SHALL show an empty-state message with the create action. The visible last-updated time SHALL use the shared Chinese `Intl.DateTimeFormat` with `dateStyle: 'medium'` and `timeStyle: 'short'` in the browser's local timezone, and SHALL NOT display the raw ISO string. The `<time dateTime>` attribute SHALL preserve the complete original `updatedAt` ISO value, and ordering SHALL continue to use the raw value rather than display text.

#### Scenario: Ordering

- **WHEN** maps A (updated 10:00) and B (updated 11:00) exist
- **THEN** the list shows B before A

#### Scenario: Only the user's own maps

- **WHEN** `alice` has map A and `bob` has map B, and `alice` opens `/`
- **THEN** the list shows A and not B

#### Scenario: Localized display preserves the machine timestamp

- **WHEN** a map's original `updatedAt` is an ISO instant that falls on different dates in UTC and the browser's local timezone
- **THEN** the visible time is the correct localized Chinese date and hour/minute without a raw `T…Z` string
- **AND** the same element's `dateTime` remains the original ISO instant and raw-value ordering is unchanged
