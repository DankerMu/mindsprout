# Tasks

## 1. Lock terminal-link identity behavior

- [x] 1.1 Add one warm-cache regression at a time to `scripts/native-hmr-observation.test.mjs`; observe semantic RED before each implementation step and GREEN after it through `cacheIdentity`/`saveCacheIdentity`. Cover ordinary files/real directories, an external sentinel subtree, link-text changes, and file-vs-link identity; verify with `pnpm native:browser:test`.
- [x] 1.2 Implement terminal symlink handling in `scripts/native-hmr-observation.mjs`; add dangling, ancestor-cycle, and duplicate-alias regressions and prove target-content writes do not change identity while link-text writes do. Preserve absent and regular-file behavior; rerun `pnpm native:browser:test`.
- [x] 1.3 Document link entry type/size/hash units, no-follow semantics, and target-content limitations in `docs/engineering/native-hmr.md`; add the required bugfix decision record and verify `pnpm docs:check` plus `pnpm decisions:check`.

## 2. Prove the native warm-cache consumer

- [x] 2.1 Run the real native browser consumer on Node 22.23.4 with an owned local Postgres and a warm `.next/dev` containing a directory symlink to an external sentinel directory. Retain evidence that preflight completes, probe startup is reached, original assertions and cleanup pass, and the original cache/link identity is restored; do not rerun the previously observed throwaway failure wrapper.
- [x] 2.2 Run `pnpm change-scope origin/main`, scoped ESLint/Prettier, `pnpm test:guardrails`, and `openspec validate cache-symlink-fingerprint --strict --no-interactive`; freeze the reviewed SHA for required installed/candidate CI and independent expanded review.

## Risk packs

Selected:

- Public API / CLI / script entry: 1.1–1.2 and 2.1 exercise existing public producers and the unchanged native CLI consumer.
- File IO / path safety / overwrite: 1.1–2.1 prove no target reads/traversal and owned cache restoration.
- Schema / columns / units / field names: 1.1–1.3 lock the file/link discriminator, link-text byte units, and aggregate identity behavior.
- Resource limits / large input / discovery: 1.2 proves ancestor cycles and aliases terminate without external subtree discovery; no new unbounded traversal is introduced.
- Legacy compatibility / examples: 1.1–1.2 and 2.1 preserve absent/regular-file semantics and existing native caller behavior.
- Error handling / rollback / partial outputs: 1.2 covers dangling links; 2.1 requires normal cleanup and original-cache restoration.
- Documentation / migration notes: 1.3 records the identity contract and explicitly states that target-content changes are not fingerprinted.

Not selected:

- Config / project setup: no configuration, environment, dependency, or setup contract changes; 2.1 uses the existing documented runtime.
- Auth / permissions / secrets: fixtures contain only synthetic files; raw link text and target contents are not published.
- Concurrency / shared state / ordering: traversal remains synchronous and deterministic; existing runner ownership/cleanup ordering is unchanged.
- Release / packaging / dependency compatibility: no package, native binary, lockfile, release, or dependency changes; candidate CI remains a compatibility control in 2.2.

## Execution boundary

Use one implementer in the current checkout with vertical RED→GREEN cycles. Do not modify CI thresholds, add retries, clear caches, follow targets, or fold in #199/#203 profiling work. The user's existing instruction-guard edit remains untouched and uncommitted.
