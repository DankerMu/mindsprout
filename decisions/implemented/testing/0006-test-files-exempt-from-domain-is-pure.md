---
id: 0006
title: Test files are exempt from domain-is-pure
kind: testing
status: implemented
date: 2026-11-05
---

# Test files are exempt from domain-is-pure

Status: active — partially refines 0005 (zod stays the one package domain production code may import; see [0005](../architecture/0005-zod-in-domain.md))

## Problem

`AGENTS.md` places unit tests beside their source (`*.test.ts(x)` in the same directory), and `scripts/check-test-pairing.sh` rejects a new `src/**` file without that sibling. Every paired test under `src/contexts/<ctx>/domain/` imports `vitest`. The `.dependency-cruiser.cjs` rule `domain-is-pure` matched those test files as domain code and rejected the `vitest` import, so `pnpm boundaries` failed as soon as the first domain file shipped with its test (issue #3, change `m1-canvas`).

## Decision

- Test files are not domain code. Files whose name ends in `.test.ts` or `.test.tsx` are exempt from `domain-is-pure` only: they may import the test runner and sibling fixtures.
- Every other boundary rule applies to test files: `no-circular`, the `no-cross-context-*` rules, `application-not-infrastructure`, `no-framework-in-domain-or-application`, `components-and-shared-not-infrastructure` and `nothing-imports-app-routes`.
- The exemption is applied to `domain-is-pure` as `from.pathNot: ['\\.test\\.tsx?$']`; the rule's `path` and its `to` allowance (itself, `src/shared`, zod) are unchanged.
- The exemption is mirrored in `constraints.yaml` `module_boundaries.allowed_dependency_directions`.

## Alternatives considered

- **Vitest globals (`test.globals: true`)** — lost: it hides the import the boundary rule exists to make visible, and the global ambient types weaken typecheck for every file, production code included.
- **Moving domain tests out of `domain/`** (for example under `tests/unit/`) — lost: it breaks the sibling pairing that `scripts/check-test-pairing.sh` enforces and the test placement rule in `AGENTS.md ## Conventions`.
- **Allowing `vitest` in `domain/` for all files** — lost: production domain code could then import the test runner, which is exactly the leak `domain-is-pure` prevents.

## Consequences

- The exemption is by filename suffix only. A production file under `domain/` stays under `domain-is-pure` whatever it imports; a helper meant to be shared by tests and named without the `.test.` suffix is production code and is checked.
- Production files keep the 0005 allowance unchanged: only zod, `src/shared` and `domain/` itself.
- Mirrored in `constraints.yaml`; any further rule that test files must escape needs the same `pathNot` and an update to this record.
- `scripts/test-guardrails.sh` "boundaries guard" carries an accept case — a `*.test.ts` probe in `domain/` importing `vitest` and zod is accepted — beside the existing reject case for react in `domain/`.
