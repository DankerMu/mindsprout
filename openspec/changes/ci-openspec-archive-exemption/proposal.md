# Proposal: ci-openspec-archive-exemption

## Why

The scratchpad naming guard rejects every added path that has an `archive` segment (`constraints.yaml` `code_canonicality.scratchpad_directories.paths`, `.git-hooks/check-naming.sh`). `openspec archive` can only move a change to `openspec/changes/archive/<date>-<change>/`. OpenSpec 1.13.2 hard-codes that directory (`OPENSPEC_ARCHIVE_DIR`) and has no option to configure it. As a result no OpenSpec change in this repo can be archived and committed (issue #54):

- `ci-diff-guard-labels` is complete but still shows as active.
- `openspec/specs/` stays empty, because delta specs are only merged in on archive.
- Every subagent-workflow Phase 4 stalls at the archive step.

The owner chose option (a): a narrow exemption for that one prefix, recorded in a decision record (#54 comment, 2026-11-05).

## What Changes

- `constraints.yaml` `code_canonicality.scratchpad_directories` gains `exempt_prefixes: ["openspec/changes/archive/"]`.
- `.git-hooks/check-naming.sh` reads `exempt_prefixes`. A path that starts with an exempt prefix has the prefix removed before the scratchpad regex runs, so a scratchpad segment below the prefix is still rejected. The forbidden-suffix check is unchanged and still sees the whole path. In path-argument (write-time) mode, an absolute path inside the repository is first made repo-relative.
- `scripts/test-guardrails.sh` gains accept and reject cases for the exemption.
- Decision record `0007` (process) records the exemption, its boundary and the alternatives.
- The `AGENTS.md` Code Canonicality bullet names the single exemption.
- `ci-diff-guard-labels` is archived, which creates `openspec/specs/ci-diff-guard/spec.md`. This change is archived in the same PR, which creates `openspec/specs/naming-guard/spec.md`.

## Capabilities

### New Capabilities

- `naming-guard`: which added paths the code-canonicality naming guard rejects, including the OpenSpec archive exemption.

### Modified Capabilities

None.

## Impact

- `constraints.yaml`, `.git-hooks/check-naming.sh`, `scripts/test-guardrails.sh`, `AGENTS.md`, `decisions/implemented/process/0007-*.md`, `openspec/specs/**`, `openspec/changes/archive/**`.
- Critical Path (gate integrity): full cross-review plus `pnpm test:guardrails` evidence.
- No other scratchpad directory, forbidden suffix or hook is relaxed. The `.husky/pre-commit` and `.claude/hooks/pre-write-naming.sh` entry points are unchanged.

## Fixture triage — issue #54

```text
Issue type: feature (gate rule change)
Fixture level: expanded
Upstream suggested level: none given (issue-scribe issue, size S) — expanded triggers: production gate config on a Critical Path (gate integrity), path matching (path safety), and a shared hook used by pre-commit and the Claude Code write-time hook
Blast radius: a too-wide exemption lets scratch or backup directories into commits (canonicality erosion); a broken parse of constraints.yaml can silently fall back to defaults or reject every commit; a wrong write-time normalisation blocks agent writes or lets them through
Selected risk packs: Config / project setup; File IO / path safety; Legacy compatibility; Public API / CLI / script entry; Error handling; Documentation
Evidence floor: pnpm test:guardrails (new exemption cases plus every existing case); bash 3.2 compatibility (/bin/bash on macOS); bite checks; pnpm decisions:check; pnpm docs:check; pnpm fmt:check; a real commit of the two openspec archives through the pre-commit hook without --no-verify; openspec list no longer shows ci-diff-guard-labels
```
