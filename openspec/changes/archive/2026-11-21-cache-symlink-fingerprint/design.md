# Design

## Context

See [proposal](proposal.md). `cacheFiles` recursively handles `Dirent.isDirectory()` and treats every other entry as a regular file. `cacheIdentity` and `saveCacheIdentity` are the only fingerprint producers; the native entrypoint calls the latter after preserving an existing `.next/dev` and before server startup.

## Goals / Non-Goals

Change surface: existing cache traversal, identity projection, paired tests, and native warm-cache preflight consumer.
Must preserve: absent-cache shape; ordinary file path/size/content hash; sorted deterministic traversal; existing CLI, probe assertions, backup ownership, and cleanup budgets.
Must add/change: a terminal symlink entry and explicit file/link distinction; stable identity from regular bytes and link text only.
Governing invariant: fingerprinting never reads or traverses a symbolic-link target.
Sibling surfaces: direct identity calls, persisted identity files, warm-cache preflight, dangling/cyclic/aliased links, and post-run cache restoration.
Seams under test: public `cacheIdentity`/`saveCacheIdentity` functions and the real native browser entrypoint.
Non-goals: following external directories, changing `fs.cpSync`, excluding links silently, retries, cache deletion, or unrelated navigation diagnosis.

## Decisions

1. Check `Dirent.isSymbolicLink()` before directory recursion. Read only link text with `readlinkSync`; hash those bytes and record their byte length without storing the raw target. This supports dangling links and makes cycles and aliases terminal. The alternative of omitting links loses link-text changes and is rejected.
2. Give regular and symlink entries an explicit `type` discriminator and include it in aggregate hashing. A symlink's `size`/`sha256` describe link text, never target bytes; regular-file fields keep their existing meaning. Identity compatibility is within one runner version, not a persisted cross-version migration contract.
3. Keep synchronous traversal and existing output locations. No new filesystem glob, configuration, dependency, retry, or cache-recovery path is needed.
4. Update the native guide and ship a non-trivial bugfix decision record in the same change; do not supersede the native repair or profiling decisions.

## Risks / Trade-offs

- Link text can contain host-specific paths → publish only its length/hash, never the raw text.
- A target can change without changing identity → intended no-follow contract; tests prove sentinel writes do not affect identity, while link-text changes do.
- Warm-cache consumer setup can disturb a developer cache → use the runner's existing owned backup/restoration and verify post-run identity; never clear a cache to make the probe pass.

## Required evidence

- Warm fixture: ordinary file + real subdirectory + directory link to an external sentinel directory → both public producers complete; regular fields remain correct; no external subtree path appears.
- No-follow oracle: change only external sentinel bytes → identity is unchanged; change link text → identity changes; dangling, ancestor-cycle, and duplicate-alias links complete without target traversal.
- Real consumer: a warm `.next/dev` containing a directory symlink passes preflight, reaches native probe startup, and restores the original cache after normal cleanup.

## Review focus

Verify symlink detection precedes recursion, no target `stat`/`read`/recursive call exists, type affects aggregate identity, and consumer evidence observes the actual preflight/startup/cleanup path rather than a mocked boundary.
