## ADDED Requirements

### Requirement: Cloud map-persistence purpose remains current

The `map-persistence` capability SHALL summarize maps as saved automatically and read back exactly in the signed-in user's cloud account, with a versioned envelope shared between browser and server. It SHALL NOT describe cloud sync as future work.

#### Scenario: Reader inspects the persistence summary

- **WHEN** a reader inspects the `map-persistence` Purpose
- **THEN** it states that maps survive reloads and browser restarts in the signed-in user's cloud account, are saved automatically and read back exactly, and use a versioned envelope shared between browser and server
- **AND** no requirement or scenario is changed by that summary correction
