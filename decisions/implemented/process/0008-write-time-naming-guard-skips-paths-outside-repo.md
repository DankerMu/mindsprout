---
id: 0008
title: Write-time naming guard skips paths outside the repository
kind: process
status: implemented
date: 2026-11-05
---

# Write-time naming guard skips paths outside the repository

Status: active

## Problem

AGENTS.md says "Scratch files go to `/tmp/`, never the working tree", and the hook's own rejection message says "keep it outside the repo (e.g., /tmp)". The write-time naming guard contradicted both. `.claude/hooks/pre-write-naming.sh` passes Claude Code's absolute `file_path` to `.git-hooks/check-naming.sh` in path mode. Path mode made a path repo-relative only when it started with the repository root as a string, and checked every other path as given. So `/tmp/x.md` failed on its `tmp` segment, and so did any outside path with a scratch segment (`backup`, `archive`, `wip`, …) or a forbidden suffix (`notes_old.md`), all with exit 2. Agents could reach the sanctioned scratch location only by working around the guard with Bash heredocs, or were pushed to write scratch into the working tree, which the rule forbids (issue #59). The guard exists to keep violating names out of commits, and a file outside the repository can never be committed.

## Decision

In path mode (`check-naming.sh <path>`), an **absolute** argument is judged by where it physically is:

- **Resolution.** The hook walks up to the deepest existing ancestor directory, resolves it with `cd` + `pwd -P`, and appends the non-existent remainder verbatim. It needs no `realpath` or `readlink -f`, and it runs on bash 3.2.
- **Repository root.** `repo_root` is physical. `git rev-parse --show-toplevel` already returns a physical path, and the non-git fallback is now `pwd -P`.
- **Inside.** If the resolved path starts with `"$repo_root/"`, the repo-relative remainder gets the normal checks, exactly as the staged check would judge it. This also holds for a route in through a symlink.
- **Outside.** If the resolved path is outside `"$repo_root/"` and not equal to `repo_root`, the hook exits 0 after its usual stderr source lines. Neither rule runs.
- **`..` rule.** If the argument contains a `..` segment anywhere, the outside exit is skipped and the argument is checked as given (strip a literal leading `"$repo_root/"`, then both rules), before any resolution. `cd` drops `..` as text while the filesystem follows a symlinked ancestor, so no `..` may carry a path to an outside verdict.
- **Fail closed.** An absolute path equal to `repo_root`, or one whose ancestor cannot be entered, is checked as given, as before.
- **Unchanged.** Relative arguments are checked as given. The violation message still prints the original argument. Exit codes stay the same (path mode 2, clean 0), and the staged pre-commit mode is untouched.

## Alternatives considered

- **Allowlist only `/tmp/` and `$TMPDIR`** — lost: it leaves every other outside path wrongly rejected, such as `~/.claude/**` or any external path with an `archive` segment or an `_old` suffix. It also writes a special case into the rule without fixing the root cause, that the guard judges paths that can never be committed.
- **A string-prefix test without physical resolution** (outside = does not start with `"$repo_root/"`) — lost: it fails open. A symlinked route into the repository, such as a link to the worktree or macOS `/tmp` → `/private/tmp` when the repository lives below it, would read as outside, and an in-repo `scratch/x.md` would pass the write-time check.
- **Leaving it as is** — lost: the machine check keeps contradicting the written rule, every agent session pays for the workaround, and the pressure points toward writing scratch into the working tree.

## Consequences

- `/tmp/x.md`, `/tmp/scratch-probe/x_old.md` and `/nonexistent/notes_old.md` exit 0 at write time. `"$repo_root/scratch/x.md"`, `"$repo_root/foo_v2.ts"`, the same paths through a symlink to the repository, relative `scratch/x.md` and `foo_v2.ts`, and any absolute path with a `..` segment that names a violation all still exit 2.
- **Residual risk — dangling symlink leaf.** The non-existent remainder is appended verbatim, so a symlink in it, typically the leaf, is not followed. A live symlink leaf to a file is also not followed, but its target already exists, so the write adds no new name. A dangling symlink leaf that points into the repository can create a new in-repo file without a write-time verdict. The staged pre-commit check is the floor.
- **Residual risk — sibling worktree.** `repo_root` is the toplevel of the session's working directory. A sibling worktree of the same repository that lives outside that toplevel is judged outside, and its own pre-commit hook is the floor.
- The staged pre-commit check is the only gate on what enters a commit, and it is unchanged by this decision. The write-time check is an early warning for agent writes, not a second commit gate.
- Partially related to [decision 0007](0007-openspec-archive-exempt-from-scratchpad-guard.md), which is not superseded. Its exemption semantics and its write-time normalisation of in-repo absolute paths stand. This record replaces one fact in its Consequences: absolute paths outside the repository are no longer "checked as given" but accepted.
- `scripts/test-guardrails.sh` "naming path mode" cases (p1–p6) cover outside paths that exist and that do not, in-repo absolute paths, a symlinked route in (reject and exempt accept), relative paths, and the `..` rule, including a `..` below a symlink into the repository.
