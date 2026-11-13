# Spec Delta

## MODIFIED Requirements

### Requirement: Temporary native repair is reproducibly installed

The repair SHALL install through version-pinned package-manager metadata with integrity verification on macOS arm64 and Linux x64 GNU. Source revision, patch identity and built package digests MUST be traceable; unavailable or mismatched candidate artifacts MUST fail installation rather than silently loading the faulty native implementation. Every committed lockfile override that points at this repository's native release assets MUST resolve to a package entry whose tarball equals the override URL and whose integrity is a sha512 SRI value; a required check MUST fail, naming the override, when that does not hold, and MUST fail rather than pass when no such override is found.

#### Scenario: Frozen installation uses verified repair

- **WHEN** a clean supported environment installs the committed manifest and lockfile
- **THEN** the verified repaired native package loads and passes the native/runtime regression
- **AND** no uncommitted node_modules edits or diagnostic binding environment override is required

#### Scenario: Package integrity mismatch

- **WHEN** downloaded repair bytes differ from the committed package integrity
- **THEN** installation fails and no successful repair verification is reported

#### Scenario: Regenerated lockfile lost a native integrity

- **WHEN** a committed lockfile's `@next/swc-*` override entry has no `integrity`, a non-sha512 `integrity`, or no packages entry
- **THEN** the native lockfile check fails and names that override

#### Scenario: Selector finds no native override

- **WHEN** the lockfile overrides contain no URL under the repository's native release prefix
- **THEN** the check fails instead of passing vacuously
