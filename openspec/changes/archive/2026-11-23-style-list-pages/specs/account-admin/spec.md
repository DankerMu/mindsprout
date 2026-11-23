# account-admin Specification Delta

## ADDED Requirements

### Requirement: Readable list presentation

The admin page SHALL present accounts without browser-default bullet markers, with consistent row spacing and wrapping, visually distinct creation times and clearly styled reset controls. Hiding markers SHALL NOT remove list semantics for assistive technology. Every reset control SHALL retain its existing account-specific accessible name and confirmation behavior.

#### Scenario: Account rows and reset controls are visually structured

- **WHEN** the administrator opens `/admin` and accounts exist
- **THEN** the list has no bullet markers, retains explicit list semantics for assistive technology, has rows with consistent spacing and wrapping, and visually distinguishable creation times and reset controls
- **AND** each reset control still identifies its account and preserves the existing confirmation and cancellation behavior
