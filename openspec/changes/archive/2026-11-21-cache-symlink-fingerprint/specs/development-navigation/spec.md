# Spec Delta

## ADDED Requirements

### Requirement: Native cache identity treats symbolic links as terminal entries

Native cache fingerprinting SHALL record every symbolic link as a link entry derived only from its link text and MUST NOT read, stat, or recursively traverse the link target. Regular files SHALL retain their relative path, byte size, and content SHA-256 semantics, and the identity SHALL distinguish link entries from regular-file entries.

#### Scenario: Warm cache contains a directory symlink

- **WHEN** a warm cache contains ordinary files, a real subdirectory, and a directory symlink whose target outside the cache contains a sentinel file
- **THEN** cache identity generation and persistence complete without reading the target subtree
- **AND** ordinary-file fields remain correct and no target-subtree file is included
- **AND** changing only the sentinel content leaves identity unchanged, while changing the link text changes identity

#### Scenario: Link targets are dangling, cyclic, or aliased

- **WHEN** cache entries include a dangling symlink, a symlink to an ancestor directory, or multiple symlinks to one external directory
- **THEN** each link is handled only as a terminal link entry
- **AND** fingerprinting completes without following a cycle, duplicating the target subtree, or requiring the target to exist
