---
id: 0029
title: Fingerprint native cache symlinks as terminal entries
kind: bug-fix
status: implemented
date: 2026-11-21
---

# Fingerprint native cache symlinks as terminal entries

## Problem

A warm Next development cache can contain directory symlinks or be a symlink itself. Reading a directory link as a regular file fails with `EISDIR` before the native browser starts. Following targets instead makes identity depend on external files, admits cycles, and confuses an unresolved root link with a missing cache.

## Decision

Fingerprint a symlink using only its raw link text bytes. The entry records their byte length and SHA-256, not the text or the target's metadata. A root link contributes a single terminal entry at `.`. Include the entry type in the report and aggregate digest so equal bytes at the same path cannot make a regular file and a link interchangeable.

Use no-follow path-existence guards for cache backup, working copy, and restoration. A link is present even if its target cannot resolve, so the runner does not skip its original entry or lose it during cleanup.

## Alternatives considered

- **Omit symlinks:** safe from traversal, but cannot detect a change to a link's text.
- **Resolve targets and fingerprint them:** ties the cache fingerprint to external content, requires cycle handling, and fails or needs exceptions when targets are absent.

## Consequences

Dangling links, links to ancestors, and separate aliases all remain independent terminal entries. Target-content changes alone are intentionally invisible. Aggregate digests are comparable within one runner version; regular-file paths, sizes, and content hashes keep their meaning. The [native HMR guide](../../../docs/engineering/native-hmr.md#browser-behavior-contracts) defines the report and cleanup contracts. This decision does not supersede [decision 0021](0021-native-hmr-registration-maintenance.md) or change copy options, cleanup ordering, or probe gates.
