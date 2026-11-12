# Dependency patches

Repository-maintained fixes to published JavaScript dependencies are pnpm `patchedDependencies` in [package.json](../../package.json). [Decision 0022](../../decisions/implemented/process/0022-repo-maintained-dependency-patches.md) owns the policy, the alternatives and the removal condition. Native binaries follow [native HMR maintenance](native-hmr.md) instead.

## Current patches

| Package and exact version               | Patch                                                                                                           | Upstream                                                                   | Regression                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| `@stryker-mutator/vitest-runner@10.1.1` | [debug config `%O` logging](../../patches/@stryker-mutator__vitest-runner@10.1.1.patch) (#118)                  | [stryker-js#6261](https://github.com/stryker-mutator/stryker-js/pull/6261) | `pnpm test:stryker-patch` |
| `@stryker-mutator/util@10.1.1`          | [`errorToString` fallback for unstringifiable values](../../patches/@stryker-mutator__util@10.1.1.patch) (#119) | [stryker-js#6226](https://github.com/stryker-mutator/stryker-js/pull/6226) | `pnpm test:stryker-patch` |

## Add or regenerate a patch

1. Write the regression first. It must import the installed file under `node_modules/` and assert that its real path contains `patch_hash=`. Run it once against the stock package and keep the failing output.
2. Edit outside the working tree: `pnpm patch <name>@<exact-version> --edit-dir <scratch directory>`. Change shipped files only, mirroring the upstream fix.
3. Run `pnpm patch-commit <scratch directory>`. pnpm writes `patches/`, the exact-version `patchedDependencies` key and the lockfile hash. If `git diff pnpm-lock.yaml` is then empty, as it was for the util patch, regenerate the lockfile with `pnpm install --lockfile-only --store-dir <empty scratch directory>`. Re-resolving against a store that already holds the native tarball overrides drops their `integrity` from the lockfile.
4. Check that `git diff pnpm-lock.yaml` shows only the `patchedDependencies` block and the `patch_hash` suffixes. Then remove `node_modules`, run `pnpm install --frozen-lockfile`, and run the regression plus the behavior it protects.

## Failure modes

pnpm 10.28 fails loudly in each case. Never add `allowUnusedPatches` or `ignorePatchFailures`.

- `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`: a frozen install found a patch key or patch bytes that differ from the lockfile. Regenerate with `pnpm install`, then review the diff.
- `ERR_PNPM_UNUSED_PATCH`: the patch key names a version that is no longer installed, typically after a Renovate update. If the new release contains the fix, remove the patch. Otherwise regenerate it for the new version.
- `ERR_PNPM_PATCH_FAILED`: the patch context no longer matches the package's files. Regenerate the patch from the new version.

## Remove a patch

Once a released version contains the fix, delete the patch file and its `patchedDependencies` entry in that version's Renovate PR, then regenerate the lockfile. Re-target or delete the regression, remove its row above, and update its script, `AGENTS.md` and CI step in the same change.

## Known Limitations

- Patches edit compiled `dist/` output, not upstream TypeScript. Source maps for a patched line can be off by a few columns.
- The Stryker runner patch prints config with `util.inspect` at depth 2. Values nested more than two levels deep appear as `[Object]`.
- The Stryker util patch reads `name`, `message` and `stack` without a guard once `String` has thrown, as upstream does. An unstringifiable value with a throwing `message` getter still makes `errorToString` throw. A revoked `Proxy` throws earlier, at the `instanceof Error` check, with or without the patch.
