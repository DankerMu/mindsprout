# Design

## Context

- Overrides live in `package.json` `pnpm.overrides` and are mirrored in the lockfile's top-level `overrides:` block (`pnpm-lock.yaml:7-9`).
- Each native override resolves to a `packages` entry keyed `<name>@<url>`. Its `resolution` holds `{integrity, tarball}` (`:1043-1044`, `:1068-1069`).
- `yaml@2.9.1` is already a dev dependency and is used by `scripts/native-install.test.mjs`.
- CI layer4 (`.github/workflows/ci.yml:91-120`) runs named steps individually; it does not run `pnpm anti-drift`. A new gate therefore needs its own step.
- `AGENTS.md` is close to the instruction size guard: 32592 of 32768 bytes. A new table row does not fit, so the command shares the existing dependency-patch row.

## Goals / Non-Goals

**Governing invariant:** every committed native override that points at this repository's release assets installs with sha512 integrity verification. A lockfile regenerated without that integrity fails a required CI check.

**Non-goals:**

- comparing integrity values against `patches/native/published/*.json` (the issue's alternative; a later step);
- editing the lockfile, patches or manifests;
- Renovate configuration;
- the #119 spec wording (already handled);
- `strict-peer-dependencies`;
- reproducing the warm-store loss in CI.

## Decisions

### Lockfile integrity guard

- **Form.** A self-contained `node:test` file, `scripts/native-lockfile-integrity.test.mjs`. It holds an unexported pure function `violations(lockText) -> string[]` and its tests. This follows the `test:stryker-patch` pattern: the test asserts real repository state. There is no CLI entry and no exported module, so `knip` sees no dead export.
- **Selector.** The guard derives from the lockfile's own `overrides` map every value matching `^https://github\.com/DankerMu/mindsprout/releases/download/native-next-`. The repository-state test requires at least one such override. This closes the vacuous pass: if the selector or the prefix drifts, the test reports "no native overrides found" instead of passing.
- **Per-override checks.** For each selected override:
  - a `packages` entry keyed `<name>@<url>` exists;
  - `resolution.tarball === url`;
  - `resolution.integrity` matches `^sha512-[A-Za-z0-9+/]{86}==$`, the SRI form of a 64-byte digest.
  - Each failure yields one violation string naming the override.
- **Tests.**
  - The real `pnpm-lock.yaml` has zero violations.
  - Fixtures are derived in memory from the real lockfile text, not hand-written YAML:
    - integrity removed, once per native override (darwin-arm64, `pnpm-lock.yaml:1044`; linux-x64-gnu, `:1069`), each yielding exactly one violation naming that override;
    - one integrity replaced with a `sha1-` value;
    - one packages entry deleted.
      Each yields exactly the expected violation for the affected override.
  - If the 1.1 retest reproduces the loss with a resolution shape that differs from "integrity removed" (for example a changed packages key, or a resolution without `tarball`), that observed shape is added as one more fixture.
  - An `overrides` block with no native URL yields the "none found" failure.
- **Wiring.**
  - `package.json` script `"test:native-lockfile": "node --test scripts/native-lockfile-integrity.test.mjs"`.
  - CI layer4 gets the step "Native override lockfile integrity", placed after "Patched Stryker Vitest runner regression", running `pnpm test:native-lockfile`.
  - The AGENTS.md row `Patched Stryker Vitest runner regression | pnpm test:stryker-patch` becomes `Dependency patch / native lockfile regressions | pnpm test:stryker-patch / pnpm test:native-lockfile`. That label also covers the util patch added in #119. The row stays a single row, keeping column widths and file size within the guard.

### Warm-store retest (evidence only)

- In a scratch copy outside the working tree (`git archive HEAD` or a `git ls-files` export) with the default store, which holds both native tarballs, run `pnpm install --lockfile-only`. Then run `git diff --no-index` of the lockfile against HEAD.
- Record the pnpm version, the store path, whether the store contains the two tarballs, the command and the diff for the two native resolutions.
- If the loss does not reproduce, record that, and record the same procedure with `--store-dir <empty>` for comparison. The guard ships either way.
- The evidence goes in the PR body. Raw logs go under `.workplans/138/`.

### Documentation

- `docs/engineering/dependency-patches.md` gets a section `## Regenerate the lockfile` that carries the single caveat.
  - Use `pnpm install --lockfile-only --store-dir <empty scratch directory>`, because re-resolving against a store that already holds the native tarball overrides can drop their `integrity`.
  - Then review `git diff pnpm-lock.yaml`, and expect `pnpm test:native-lockfile` to pass.
- The following places become links to that section, with no copied caveat:
  - step 3's conditional sentence;
  - the `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` "Regenerate with `pnpm install`" line;
  - the `UNUSED_PATCH`/`PATCH_FAILED` lines, which send readers back to the steps;
  - "Remove a patch";
  - `docs/engineering/native-hmr.md:69`;
  - decision 0022 `:39`.
- No content of decision 0021 changes.

### Stryker regression strength

- Add `{ name: 'E', message: 'm' }` → `'[object Object]'` to the keeps-existing-output test (`:199-212`).
- RED proof (evidence, not committed):
  1. Record the sha256 of the installed patched `@stryker-mutator/util/dist/src/errors.js` (realpath).
  2. Temporarily edit that installed file so that the plain-object branch builds `name: message` before trying `String()` (the "header-first" variant).
  3. Run `pnpm test:stryker-patch` and require the new case to fail.
  4. Restore the file and require the same sha256.
  5. Rerun and require GREEN.
  - Never commit the variant. Prefer restoring from a byte copy saved before the edit. Then confirm the restore with `pnpm install --frozen-lockfile` plus the sha256 check.
- Add a test that resolves `realpath(node_modules/@stryker-mutator/core)`, then core's sibling `@stryker-mutator/util` and `@stryker-mutator/instrumenter`, then instrumenter's sibling `@stryker-mutator/util`. Each util realpath must equal `utilDist`'s package root (the entry containing `patch_hash=`).
- RED proof for the realpath assertion (evidence, not committed):
  1. Build an unpatched util copy in `/tmp`: copy the installed patched package and reverse-apply `patches/@stryker-mutator__util@10.1.1.patch`.
  2. Temporarily repoint the symlink `node_modules/.pnpm/@stryker-mutator+core@10.1.1_@types+node@22.20.5/node_modules/@stryker-mutator/util` at that copy, run `pnpm test:stryker-patch`, and require the core realpath test to fail.
  3. Restore the original symlink target, run `pnpm install --frozen-lockfile`, confirm the symlink target equals the recorded original, and rerun GREEN.

## Risks / Trade-offs

- **False failure on a legitimate future lockfile format change.** The packages-key shape `<name>@<url>` is pnpm 10 lockfile v9. A format change fails loudly with a named override, which is the desired behavior. Fixing it is a deliberate test update.
- **A hard-coded repository URL prefix.** If the release host moves, the "none found" failure forces a guard update in the same PR. This is acceptable.
- **The editing step in the RED proof touches the pnpm store.** It is mitigated by the byte-copy restore, the sha256 equality check and a frozen reinstall.

## Migration Plan

- Ship the guard, docs and tests atomically. No data migration.
- Rollback: revert the commit. The lockfile is untouched, so rollback has no install effect.

**Sibling surfaces:**

- `scripts/native-install.test.mjs` (`lockedIntegrity` on its fixture lockfile; unchanged);
- `scripts/check-lockfile-pairs.sh` (pairing only; unchanged);
- `scripts/native-installed.mjs` postinstall sha256 guard (unchanged; it remains the binary-level backstop);
- the CI layer4 step order;
- the weekly AGENTS.md liveness check, which needs every documented `pnpm <script>` to exist;
- `docs:check` links.

Preserve the user's unrelated `.claude/hooks/instruction-guard/instruction-guard.sh` change.
