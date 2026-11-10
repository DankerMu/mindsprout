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

Normal installation must run a verification-only lifecycle guard against committed per-target publication manifests. pnpm can omit a failed optional native dependency without failing installation; lockfile integrity alone is therefore insufficient. The guard may neither download nor replace binaries. Script-disabled workflows must invoke it explicitly, and installed loading plus both browser modes must feed the required CI aggregate before merge.

[Native development instructions](../../../docs/engineering/native-hmr.md) own commands, prerequisites, artifact handoff and the distinct SPA-only HMR limitation. Existing CI gates and mutation configuration remain unchanged. No active decision is superseded.

## Alternatives considered

- **JavaScript patch or application workaround:** cannot restore native registration ownership; filtering restart messages hides missing content rather than repairing it.
- **Cache disabling, retries or longer readiness deadlines:** remove the failing condition or weaken the five-second contract without establishing producer availability.
- **Wait for an upstream release:** leaves the demonstrated development reload loop unresolved. A version change alone is not evidence of a repair; the inspected 16.4.6 resource-map file is byte-identical to 16.4.5.
- **Manual node_modules replacement or diagnostic native-directory loading as delivery:** bypasses frozen installation and cannot bind installed bytes to reviewed artifacts.
- **Publish all upstream platforms:** exceeds the owner's explicit two-platform maintenance authorization and the available native evidence.
- **Rely on optional-dependency integrity failure to stop installation:** pnpm's optional-package semantics can return success with no native package installed; a fail-closed installed verification step is required.

## Consequences

- This adds a native supply-chain and maintenance obligation, not a product API or storage migration. Other platforms are not qualified as repaired. Build failure, missing artifacts or integrity mismatch block delivery; they do not select another native implementation.
- The restored-lifecycle browser mode preserves the qualified provider trigger, first unchanged-value restart, route-handler-first ordering and four retained-navigation conditions. Source-change mode proves real partial MapEditor HMR plus concurrent first SPA navigation; its retained editor document subscription is established before the source stimulus. Neither mode relaxes readiness, reload or browser-noise assertions.
- A released upstream repair is adopted through Renovate only after equivalent native restoration/removal and browser regressions pass on both platforms. Remove native overrides, regenerate the lockfile, and remove fork-only patch/build/package/workflow machinery atomically in that update. Keep behavior coverage that still guards the development contract.
- Rollback atomically reverts overrides, lockfile, native patch and build/package integration. It restores the disclosed development defect; it does not migrate, delete or repair user maps. Published immutable assets remain available for reproducibility and are never overwritten in place.
