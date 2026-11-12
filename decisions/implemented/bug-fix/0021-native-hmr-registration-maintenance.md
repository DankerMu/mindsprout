---
id: 0021
title: Maintain a source-pinned native HMR registration repair
kind: bug-fix
status: implemented
date: 2026-11-10
---

# Maintain a source-pinned native HMR registration repair

## Problem

Next 16.4.5 can restore a selectable resource producer without restoring its reverse registration. A retained development browser then receives missing-resource updates and repeatedly reloads before editor readiness. Registration belongs to the computation that publishes the resource, not an unrelated insertion caller that may not execute after restoration.

## Decision

The owner authorizes temporary same-version native maintenance for macOS arm64 and Linux x64 GNU. MindSprout owns review, compilation, provenance, artifact retention, installation qualification and upstream replacement. This is not authorization to bypass CI, deploy the application, or represent locally maintained bytes as an unmodified upstream release.

Keep the clean corrective patch and machine-readable source/toolchain/lockfile pins in `patches/native/`. The patch includes real persistent-backend, operation-identity, pin-lifetime and macro-contract regressions. Build an isolated, clean Git commit from the pinned upstream commit and patch using fixed commit metadata. Both platforms derive the same source identity; the native cache uses that genuine identity. Do not forge version/dirty metadata, disable persistence, suppress HMR, replace installed files, or fall back to an unqualified binary.

Preserve the official native package name, version, platform constraints, entrypoint, license and engine contract, adding explicit local-repair provenance. Immutable asset names bind patch and binary identity; manifests bind upstream and patched commits, source tree, patch, build recipe, Rust compiler, Cargo.lock, binary and tarball. The read-only build job uploads candidates and behavioral evidence, never release credentials. Publication requires parent verification; exact-version overrides and the pnpm-generated lockfile must then install those assets with integrity verification. Both platforms require actual installed-package loading and browser proof without the diagnostic native-directory environment variable before merge.

Use compact `<target>-<full-tarball-sha256>.tgz` assets as the canonical package-manager URLs, preserving identical bytes and the original qualified assets/manifests. pnpm 10.28 constructs CAFS index basenames from 62 integrity hex characters, a separator, the full sanitized URL and `.json`; the original URLs produced 267/268-byte components against a 255-byte filesystem limit. The virtual-store path-length setting does not govern this index path. Compact publication names preserve traceability without a package-manager patch, configuration workaround or dependency upgrade.

Normal `postinstall` runs a verification-only lifecycle guard against committed per-target publication manifests. pnpm can omit a failed optional native dependency without failing installation; lockfile integrity alone is therefore insufficient. The guard neither downloads nor replaces binaries. Script-disabled project installations invoke it explicitly. One installed-native CI matrix covers Ubuntu 24.04 Linux x64 GNU and `macos-26` arm64; each target exercises the guard, corrupt-artifact frozen installation, both browser modes and a production build. Required `All checks passed` depends on the entire matrix, with no allowed failures or fail-fast cancellation.

Recipe or patch changes deliberately invalidate previous installed receipts. Candidate-only frozen bootstrap may disable lifecycle scripts so the replacement can be built; exact-manifest verification and both browser modes must then load that candidate exclusively. This is not permission for normal installation or required installed CI to bypass verification. Bind Cargo to the checked compiler executable and reject external compiler/configuration overrides. Any recipe change requires genuine two-platform rebuilding and qualification, new immutable assets and an atomic publication/override/lockfile cutover; never rewrite an old receipt's recipe hash.

[Native development instructions](../../../docs/engineering/native-hmr.md) own commands, prerequisites, artifact handoff and the distinct SPA-only HMR limitation. Existing required checks are preserved; the aggregate adds installed-native qualification. Mutation configuration remains unchanged. No active decision is superseded.

## Alternatives considered

- **JavaScript patch or application workaround:** cannot restore native registration ownership; filtering restart messages hides missing content rather than repairing it.
- **Cache disabling, retries or longer readiness deadlines:** remove the failing condition or weaken the five-second contract without establishing producer availability.
- **Wait for an upstream release:** leaves the demonstrated development reload loop unresolved. A version change alone is not evidence of a repair; the inspected 16.4.6 resource-map file is byte-identical to 16.4.5.
- **Manual node_modules replacement or diagnostic native-directory loading as delivery:** bypasses frozen installation and cannot bind installed bytes to reviewed artifacts.
- **Publish all upstream platforms:** exceeds the owner's explicit two-platform maintenance authorization and the available native evidence.
- **Rely on optional-dependency integrity failure to stop installation:** pnpm's optional-package semantics can return success with no native package installed; a fail-closed installed verification step is required.

## Consequences

- This adds a native supply-chain and maintenance obligation, not a product API or storage migration. Other platforms are not qualified as repaired. Build failure, missing artifacts or integrity mismatch block delivery; they do not select another native implementation.
- The restored-lifecycle browser mode preserves the qualified provider trigger, first unchanged-value restart, route-handler-first ordering and four retained-navigation conditions. Source-change mode proves real partial MapEditor HMR plus concurrent first SPA navigation after the retained editor subscription and target library HMR baseline are established. The [browser behavior contract](../../../docs/engineering/native-hmr.md#browser-behavior-contracts) owns those bounded setup prerequisites and the distinct cold-connect limitation. Neither mode relaxes readiness, reload or browser-noise assertions.
- A released upstream repair is adopted through Renovate only after equivalent native restoration/removal and browser regressions pass on both platforms. Remove native overrides, regenerate the lockfile, and remove the native postinstall guard, published manifests and fork-only patch/build/package/workflow machinery atomically in that update. Keep behavior coverage that still guards the development contract.
- Rollback atomically reverts overrides, lockfile, the native postinstall guard and published manifests, native patch, build/package integration and its required CI job. It restores the disclosed development defect; it does not migrate, delete or repair user maps. Published immutable assets remain available for reproducibility and are never overwritten in place.
