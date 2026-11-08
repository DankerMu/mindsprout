---
id: 0015
title: Blocking installed dependency license audit
kind: process
status: implemented
date: 2026-11-08
---

# Blocking installed dependency license audit

## Problem

A review-only license allowlist cannot establish whether the installed dependency tree satisfies the owner's policy. Runtime and development dependencies include transitive packages outside the original six license IDs. Platform-specific optional packages also make a lockfile-wide claim different from an audit of packages installed on a particular host.

## Decision

The [owner's approval](https://github.com/DankerMu/mindsprout/issues/68#issuecomment-6718121355) authorizes the following policy before the allowlist is widened:

- Use `dependencies.allowed_licenses` in [constraints.yaml](../../../constraints.yaml) as the executable policy source, with `scope: installed-all` and blocking enforcement. Audit native `pnpm licenses list --json` without production, development or optional-dependency filters. Inspect every reported version of direct and transitive runtime/development dependencies, including optional packages installed on the running platform.
- Preserve MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC and 0BSD. Add exactly six general IDs: Unlicense, MIT-0, CC0-1.0, BlueOak-1.0.0, Python-2.0 and CC-BY-4.0.
- Permit only the exact package/version/license exceptions below. Neither MPL nor LGPL is globally allowed. Names have no wildcard or prefix semantics; versions have no range semantics.
- Retain the existing toolchain through these bounded exceptions rather than replacing dependencies as part of this audit. Remove an exception when its dependency disappears; a different package, version or declared license requires new owner approval. Each policy group records that rationale and exit condition.
- Make `pnpm licenses:check` a blocking local and CI gate, with focused native CLI tests. A compliant nonempty inventory exits 0; an unapproved license exits 1 with package/version/license diagnostics; invalid policy, missing or malformed inventory, or producer failure exits 2. Match declared license strings exactly; do not infer approval for unknown, unlicensed or composite expressions.
- Parse policy using direct development dependency `yaml@2.9.1`, the already-locked ISC-licensed version published on 2026-09-11. A real YAML parser avoids a partial regex grammar and an undeclared transitive import; this addition does not authorize dependency upgrades.

### Exact approved exceptions

All names in the following group are approved only at **1.33.0 / MPL-2.0**:

- `lightningcss`
- `lightningcss-android-arm64`
- `lightningcss-darwin-arm64`
- `lightningcss-darwin-x64`
- `lightningcss-freebsd-x64`
- `lightningcss-linux-arm-gnueabihf`
- `lightningcss-linux-arm64-gnu`
- `lightningcss-linux-arm64-musl`
- `lightningcss-linux-x64-gnu`
- `lightningcss-linux-x64-musl`
- `lightningcss-win32-arm64-msvc`
- `lightningcss-win32-x64-msvc`

All names in the following group are approved only at **1.3.4 / LGPL-3.0-or-later**:

- `@img/sharp-libvips-darwin-arm64`
- `@img/sharp-libvips-darwin-x64`
- `@img/sharp-libvips-linux-arm64`
- `@img/sharp-libvips-linux-arm`
- `@img/sharp-libvips-linux-ppc64`
- `@img/sharp-libvips-linux-riscv64`
- `@img/sharp-libvips-linux-s390x`
- `@img/sharp-libvips-linux-x64`
- `@img/sharp-libvips-linuxmusl-arm64`
- `@img/sharp-libvips-linuxmusl-x64`

These 22 package identities were separately metadata-verified. Their registration is not evidence that every variant was installed or runtime-audited on either macOS or Linux.

This blocking license gate extends [decision 0001](0001-l4-profile-and-agent-review-governance.md). It does not supersede or retire that record's L4 governance, agent cross-review or owner functional-acceptance responsibilities. Existing thresholds and required-check identities remain unchanged.

## Alternatives considered

- **Audit production dependencies only** — rejected: development tools and their transitive dependencies are part of the approved installed-all scope.
- **Treat every lockfile platform variant as runtime-audited** — rejected: native inventory only establishes what is installed on the current platform. Separate metadata verification is not installed-tree execution evidence.
- **Allow MPL/LGPL globally or use wildcard/version-range exceptions** — rejected: this would admit packages or upgrades outside the owner's exact approval.
- **Replace the existing toolchain to fit the six-ID allowlist** — rejected for this change: the owner approved six additional general IDs and bounded exceptions while retaining current dependencies.
- **Keep review-only enforcement** — rejected: manual review cannot reliably check every installed transitive version or fail closed when inventory acquisition fails.

## Consequences

- Local macOS and Linux CI audits provide distinct installed-platform evidence; neither certifies absent-platform packages. The checker audits declared metadata, not bundled source or binary contents, and is not legal-compliance certification.
- Approval and exceptions do not waive attribution, notice, source, distribution or other license obligations. Those obligations remain separate from this engineering gate.
- Unknown or composite declarations require explicit policy review rather than automatic interpretation. Exact exceptions intentionally block unapproved upgrades and license changes.
- Gate changes retain full-depth cross-review and owner functional acceptance. Rollback is a reviewed revert, not a deleted test, relaxed threshold or ad hoc exemption.
