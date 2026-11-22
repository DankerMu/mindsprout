## ADDED Requirements

### Requirement: Cloud map-library purpose remains current

The `map-library` capability SHALL summarize its operations as managing the signed-in user's cloud maps, not browser-local storage.

#### Scenario: Reader inspects the capability summary

- **WHEN** a reader inspects the `map-library` Purpose
- **THEN** it states that the home page lists the signed-in user's cloud maps and lets them create, open, rename and delete maps
- **AND** no requirement or scenario is changed by that summary correction
