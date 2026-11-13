# Tasks

## 1. Evidence

- [x] 1.1 Warm-store retest per design.md: scratch copy, default store (record whether both native tarballs are present), `pnpm install --lockfile-only`, diff of both `@next/swc-*` resolutions against HEAD, pnpm version; on non-reproduction also the `--store-dir <empty>` comparison. On reproduction, record whether the observed resolution shape equals the "integrity removed" fixture; if not, add that shape as a 2.1 fixture. Logs under `.workplans/138/`.

## 2. Lockfile integrity guard

- [x] 2.1 Write `scripts/native-lockfile-integrity.test.mjs` per design.md (unexported `violations`, repo-state test, derived RED fixtures: integrity removed once per native override, `sha1-` integrity, deleted packages entry, plus any 1.1-observed shape; "none found" case). Run it before wiring: repo test GREEN; each fixture yields exactly its expected violation naming the affected override.
- [x] 2.2 Add `test:native-lockfile` to `package.json`, the CI layer4 step after the Stryker patch regression, and merge the AGENTS.md row as specified. Verify that `AGENTS.md` stays ≤ 32768 bytes and that every documented `pnpm <script>` exists (the weekly liveness check's `jq`/`grep` pipeline, run locally).
- [x] 2.3 `pnpm test:guardrails` (critical-path evidence for the ci.yml edit).

## 3. Documentation

- [x] 3.1 Add the `## Regenerate the lockfile` section and replace each lockfile re-resolution instruction with a link: `dependency-patches.md:16`, `:23`, `:24`, `:25`, `:29`, `native-hmr.md:69`, decision 0022 `:39` (line numbers at fixture time). Then `grep -n "regenerat\|Regenerat" docs/engineering/dependency-patches.md docs/engineering/native-hmr.md decisions/implemented/process/0022-repo-maintained-dependency-patches.md`: every hit is inside that section or links to it, except the exempt hits `dependency-patches.md:12` (the "Add or regenerate a patch" heading) and 0022 `:38` (account of a measured failed regeneration).

## 4. Stryker regression strength

- [x] 4.1 Add the `{ name: 'E', message: 'm' }` case; RED against the header-first variant, GREEN after restore; installed `errors.js` sha256 identical before/after; frozen reinstall clean.
- [x] 4.2 Add the core/instrumenter util realpath test; GREEN; RED via the design.md symlink repoint to an unpatched copy (core realpath test fails), then restore, frozen reinstall, symlink target equals the recorded original, GREEN.

## 5. Verification

- [x] 5.1 `pnpm test:stryker-patch`, `pnpm test:native-lockfile`, `pnpm lint`, `pnpm fmt:check`, `pnpm docs:check`, `pnpm decisions:check`, `pnpm dead-code`; `git diff pnpm-lock.yaml patches/` empty; exact-head CI.

## Risk packs

- Config / project setup — selected: new package script and CI step. Evidence: 2.2 diff, liveness pipeline, CI step green.
- Public API / CLI / script entry — selected: new `pnpm test:native-lockfile` command documented in AGENTS.md. Evidence: 2.2 liveness check; 5.1.
- Schema / columns / units / field names — selected: the guard parses lockfile v9 `overrides`/`packages`/`resolution`. Evidence: 2.1 repo-state GREEN plus derived-fixture REDs; malformed-SRI fixture.
- Resource limits / large input / discovery — selected, discovery only: the guard discovers native overrides from the lockfile `overrides:` map (`pnpm-lock.yaml:7-9`); a drifted selector must not pass vacuously. Evidence: 2.1 "none found" case and repo-state ≥1 override assertion; no performance claim.
- Error handling / rollback / partial outputs — selected: missing entry, missing/malformed integrity, vacuous selector must each fail with a named violation. Evidence: 2.1 failure cases.
- Release / packaging — selected: integrity of published native assets as installed. Evidence: 1.1 retest record; 2.1 guard; `git diff pnpm-lock.yaml` empty.
- Legacy compatibility / examples — selected: existing Stryker regressions and the native install test must remain unchanged in behavior. Evidence: 5.1 `test:stryker-patch` all prior cases still pass; `native-install.test.mjs` untouched.
- Documentation / migration notes — selected: one-home caveat. Evidence: 3.1 grep; `docs:check`.
- Test strength — selected (reviewer lens): new cases must fail on the regressions they target. Evidence: 4.1 RED/GREEN with sha256 restore; 4.2 RED proof record.
- File IO / path safety — not selected: the guard only reads the committed lockfile; the 4.1 temporary store edit is evidence-only with a verified restore.
- Auth / secrets; Concurrency / shared state — not selected: no credentials or shared runtime state.
