# Spec Delta

## ADDED Requirements

### Requirement: Staged paths are judged verbatim

The pre-commit naming guard SHALL judge each staged added or renamed path by its real bytes, so names containing non-ASCII characters or newlines get the same verdict as ASCII names. It SHALL NOT judge git's quoted display form.

#### Scenario: Non-ASCII file in a scratch directory

- **WHEN** `tmp/é.md` is staged
- **THEN** the guard rejects it as a scratchpad directory

#### Scenario: Newline in a scratch path

- **WHEN** a file named `tmp/x` + newline + `y.md` is staged
- **THEN** the guard rejects it as a scratchpad directory

#### Scenario: Extensionless forbidden suffix with non-ASCII characters

- **WHEN** `note_é_new` is staged
- **THEN** the guard rejects it for its forbidden suffix

#### Scenario: Chinese file name in the OpenSpec archive

- **WHEN** `openspec/changes/archive/2026-01-01-probe/说明.md` is staged
- **THEN** the guard accepts it

### Requirement: Write-time checks ignore paths outside the repository

When the naming guard checks a single absolute path, it SHALL resolve the path physically, including symlinks, against the repository root. A path outside the repository SHALL be accepted, because it can never be committed. A path inside the repository SHALL get its repo-relative verdict, including when it is reached through a symlink.

#### Scenario: Scratch file in the system temp directory

- **WHEN** the write-time hook passes `/tmp/x.md`
- **THEN** the guard exits 0

#### Scenario: Symlinked route into the repository

- **WHEN** the write-time hook passes `<link-to-repo>/scratch/x.md`, where `<link-to-repo>` is a symlink to the repository root
- **THEN** the guard exits 2
