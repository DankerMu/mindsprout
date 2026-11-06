# naming-guard Specification

## Purpose

Which added paths the code-canonicality naming guard (`.git-hooks/check-naming.sh`, pre-commit and Claude Code write-time) rejects: forbidden name suffixes and scratchpad directories, with the single OpenSpec archive exemption (decision 0007).

## Requirements

### Requirement: Scratchpad directories are rejected except under the OpenSpec archive

The naming guard SHALL reject an added or renamed path that has a path segment named in `constraints.yaml` `code_canonicality.scratchpad_directories.paths`. The one exception is a segment that belongs to a leading prefix listed in `exempt_prefixes`. `exempt_prefixes` holds exactly `openspec/changes/archive/`, OpenSpec's fixed archive directory. Below an exempt prefix, scratchpad segments SHALL still be rejected. The forbidden-suffix rule SHALL apply to the whole path whether or not it is under an exempt prefix.

#### Scenario: OpenSpec archive is committed

- **WHEN** `openspec/changes/archive/2026-01-01-probe/proposal.md` is staged
- **THEN** the guard accepts it

#### Scenario: Other archive directories stay forbidden

- **WHEN** `src/archive/x.ts`, `archive/x.txt`, `openspec/archive/x.md` or `docs/openspec/changes/archive/x.md` is staged
- **THEN** the guard rejects it as a scratchpad directory

#### Scenario: Scratch below the archive stays forbidden

- **WHEN** `openspec/changes/archive/2026-01-01-probe/tmp/x.md` is staged
- **THEN** the guard rejects it as a scratchpad directory

#### Scenario: Forbidden suffix inside the archive

- **WHEN** `openspec/changes/archive/2026-01-01-probe/foo_v2.md` is staged
- **THEN** the guard rejects it for its forbidden suffix

### Requirement: Write-time checks judge repository paths like commits

When the guard checks a single path argument, it SHALL first make an absolute path inside the repository relative to the repository root, so that it reaches the same verdict as the staged check for the same file.

#### Scenario: Absolute archive path at write time

- **WHEN** the write-time hook passes `<repo>/openspec/changes/archive/2026-01-01-probe/proposal.md`
- **THEN** the guard exits 0

### Requirement: Invalid exemptions fail closed

An `exempt_prefixes` entry that is absolute or does not end with `/` SHALL make the guard exit non-zero, naming the entry. It SHALL NOT be silently ignored or applied.

#### Scenario: Absolute exempt prefix

- **WHEN** `exempt_prefixes` contains `/abs/`
- **THEN** the guard exits 2 with "invalid exempt prefix: /abs/"

#### Scenario: Exempt prefix without trailing slash

- **WHEN** `exempt_prefixes` contains `no-slash`
- **THEN** the guard exits 2 with "invalid exempt prefix: no-slash"
