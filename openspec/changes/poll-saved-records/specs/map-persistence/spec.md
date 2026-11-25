# map-persistence Specification Delta

## ADDED Requirements

### Requirement: Browser save evidence waits for the stored record

Browser tests that prove an edit **was saved** SHALL NOT do it by reading the signed-in user's stored record once after a fixed delay. They SHALL either wait until the stored record matches the expected map, bounded by the assertion timeout, or read it once after an event that orders the read after the write, such as an observed completed save response or a reload whose editor already shows the edit. Tests that prove an edit was **not** saved SHALL keep waiting past the 500 ms debounce before asserting the stored record is unchanged. User-facing waits named by a scenario (such as waiting one second before reloading, or 600 ms between renames) SHALL be kept.

#### Scenario: Saved edit is proven after a slow write

- **WHEN** a node is created and named, and the browser's map write reaches the server later than 600 ms after naming
- **THEN** the save proof still passes once the stored record contains the named node, and fails if no write containing it arrives within the assertion timeout
