# database-lifecycle Specification

## Purpose

Keep local database setup and migration tests safe and meaningful across supported connection configurations, including PostgreSQL URLs without passwords.

## Requirements

### Requirement: Database setup redaction checks ignore absent credentials

The database setup integration test SHALL require complete database URLs and bootstrap secret sentinels to remain undisclosed. It SHALL additionally require a parsed URL password to remain undisclosed only when the password is nonempty; an empty password SHALL NOT become a forbidden substring or weaken checks for actual secrets.

#### Scenario: Empty password does not suppress ordinary diagnostics

- **WHEN** setup diagnostics are checked with a PostgreSQL URL whose password is empty
- **THEN** ordinary diagnostics without the complete URL or bootstrap sentinel are accepted
- **AND** output containing the complete URL or bootstrap sentinel is still rejected

#### Scenario: Nonempty password remains protected

- **WHEN** setup diagnostics are checked with a PostgreSQL URL containing a nonempty password
- **THEN** output containing the complete URL, that password or the bootstrap sentinel is rejected
- **AND** output containing none of those values is accepted
