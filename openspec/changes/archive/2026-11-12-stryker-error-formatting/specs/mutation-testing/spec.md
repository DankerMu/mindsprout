## ADDED Requirements

### Requirement: Collected runner errors are always reportable

Formatting a collected error for a mutation report SHALL NOT throw. When a value cannot be converted with `String`, the formatter MUST return its `name: message` and stack when present, or the object tag otherwise, and the runner MUST return its original error result with every collected message.

#### Scenario: Unstringifiable value in the Vitest error set

- **WHEN** a Vitest run collects a null-prototype error-like value together with an ordinary `Error`
- **THEN** the runner returns an error result instead of throwing
- **AND** its error message contains the formatted null-prototype value and the ordinary error's message
- **AND** values that were already formattable produce the same text as before
