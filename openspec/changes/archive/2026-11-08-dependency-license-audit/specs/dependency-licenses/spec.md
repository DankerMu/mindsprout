# Spec Delta

## Purpose

Enforce the repository's approved declared-license policy for production and development dependencies, including transitive and installed optional packages, on the platform running the audit.

## ADDED Requirements

### Requirement: Audit the complete installed dependency tree

The license audit SHALL inspect the native unfiltered installed-package inventory, including direct/transitive production and development dependencies and optional packages installed on the current platform. It SHALL return success only when every reported package version is approved. The scope SHALL be documented as installed-tree metadata auditing, not all-platform lockfile or legal-compliance certification.

#### Scenario: Installed tree complies

- **WHEN** every installed package version has an approved declared license or exact registered exception
- **THEN** the audit exits0 and reports a compliant inventory

#### Scenario: An unapproved dependency is present

- **WHEN** a direct or transitive production/development dependency declares an unapproved license
- **THEN** the audit exits1 and identifies the package, version and license; the CI audit step fails

### Requirement: Exceptions preserve package version identity

Exceptions SHALL match complete package name, exact version and exact declared license together and SHALL record a reason and exit condition. MPL-2.0 and LGPL-3.0-or-later SHALL NOT be globally permitted by registering package-specific exceptions. Every version in a grouped inventory entry SHALL be checked independently.

#### Scenario: Exact exception is used

- **WHEN** an installed package matches a registered name, version and license exactly
- **THEN** that version is accepted without allowing unrelated packages with the same license

#### Scenario: Another version or identity is not registered

- **WHEN** a grouped entry includes a second unapproved version, or a package name or declared license differs from the registered exception
- **THEN** the unmatched version or identity is rejected even if another entry matches

### Requirement: Invalid audit inputs fail closed

Missing or malformed policy, empty or malformed inventory, missing exception rationale/exit condition and a failed inventory command SHALL cause a nonzero error, never a compliant result. License matching SHALL be exact; unknown, unlicensed and unapproved composite expressions SHALL NOT be accepted through substring or case-insensitive matching.

#### Scenario: Inventory is absent or acquisition fails

- **WHEN** the inventory is empty, malformed or cannot be acquired
- **THEN** the audit exits2 and does not report compliance

#### Scenario: Policy or license semantics are ambiguous

- **WHEN** policy fields are invalid or a license is unknown, UNLICENSED or an unapproved composite expression
- **THEN** invalid policy exits2 and an unapproved license exits1; neither is silently repaired or treated as approved

### Requirement: The license policy is an executable gate

The canonical policy SHALL live in constraints.yaml and be enforced by the documented license command, the local check path and CI. Documentation SHALL describe the same scope and package-specific exception policy. Existing thresholds, required-check identities and application behavior SHALL remain unchanged.

#### Scenario: Native CI rejects a forbidden fixture dependency

- **WHEN** an owned unmerged verification PR introduces the pinned registry dependency tinymce8.0.1 declaring GPL-2.0-or-later without an exception
- **THEN** the CI license step rejects that package, and the fixture is not merged into the canonical branch
