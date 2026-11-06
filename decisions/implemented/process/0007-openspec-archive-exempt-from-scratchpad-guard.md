---
id: 0007
title: OpenSpec archive path is exempt from the scratchpad guard
kind: process
status: implemented
date: 2026-11-05
---

# OpenSpec archive path is exempt from the scratchpad guard

Status: active

## Problem

The scratchpad naming guard (`.git-hooks/check-naming.sh`, list in `constraints.yaml` `code_canonicality.scratchpad_directories.paths`) rejects every added path that has an `archive` segment. `openspec archive` can only move a change to `openspec/changes/archive/<date>-<change>/`. OpenSpec 1.13.2 hard-codes that directory (`OPENSPEC_ARCHIVE_DIR`) and has no option to change it. As a result no OpenSpec change in this repo could be archived and committed: completed changes stayed listed as active, `openspec/specs/` stayed empty because delta specs are only merged on archive, and every subagent-workflow Phase 4 stalled at the archive step (issue #54). The owner chose a narrow exemption (option (a), issue #54 comment, 2026-11-05).

## Decision

- `constraints.yaml` `code_canonicality.scratchpad_directories.exempt_prefixes` lists literal, repo-relative directory prefixes. It holds exactly one entry: `openspec/changes/archive/`.
- Boundary: a path is exempt only when it **starts with** the prefix, compared as a literal string (no glob or regex meaning). For an exempt path the scratchpad regex runs on the remainder after the prefix, so the exemption covers only the `archive` segment OpenSpec forces. `src/archive/`, a root `archive/`, `openspec/archive/` and `docs/openspec/changes/archive/` are still rejected.
- The forbidden-suffix rule is unchanged and always sees the full path.
- An entry that is absolute or lacks the trailing `/` is a configuration error: the hook prints `check-naming.sh: invalid exempt prefix: <entry>` and exits 2. It is never silently ignored.
- If `constraints.yaml` is absent, the hook's built-in fallback exempts the same single prefix. If the file is present without the key, nothing is exempt.
- The hook prints the active list on stderr (`check-naming.sh: scratchpad exempt prefixes: …`).

## Alternatives considered

- **(c) Delete each change after syncing its specs by hand** — lost: it throws away the change's proposal, design and tasks history that `openspec archive` keeps, and it replaces a tool step with a manual one that phase-flow and every agent would have to repeat.
- **(b) Configure OpenSpec to archive elsewhere** — impossible: OpenSpec 1.13.2 hard-codes `openspec/changes/archive` and offers no setting for it. Patching or forking OpenSpec is out of scope.
- **A regex exemption** (for example `^openspec/changes/archive/.*`) — lost: a regex is easy to leave unanchored or to over-match, and it would be applied to the whole path. A literal prefix compared with string equality cannot match anything except paths that start with it.
- **Removing `archive` from the scratchpad list entirely** — lost: it re-admits every `archive/` directory anywhere in the tree, which is the scratch-and-backup erosion the guard exists to stop.

## Consequences

- Scratch below the prefix is still rejected: `openspec/changes/archive/<change>/tmp/x.md` fails the scratchpad check, and `openspec/changes/archive/<change>/foo_v2.md` fails the suffix check.
- In path-argument (write-time) mode, a path that starts with the repository root is made repo-relative before both checks, so the Claude Code write-time hook gives an absolute path the same verdict as the staged check. Absolute paths that physically resolve outside the repository are accepted without a check; one with a `..` segment is still checked as given ([decision 0008](0008-write-time-naming-guard-skips-paths-outside-repo.md)).
- Adding a second exempt prefix needs a new decision record; the list is not a general escape hatch.
- `scripts/test-guardrails.sh` "scratchpad exemption" cases cover the accept path, the lookalike and nested rejects, write-time normalisation, invalid entries, the missing key and the fallback.
- `decisions/archived/` is unaffected: its segment is `archived`, which the guard never matched.
