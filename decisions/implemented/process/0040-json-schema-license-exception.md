---
id: 0040
title: Exact license exception for json-schema 0.4.0
kind: process
status: implemented
date: 2026-11-27
---

# Exact license exception for json-schema 0.4.0

## Problem

M3 task 3.2 (#301) adds `ai` 7.0.181 and `@ai-sdk/openai-compatible` 3.0.94. Both depend on `@ai-sdk/provider` 4.0.39, which depends on `json-schema` 0.4.0. That package declares the dual license `(AFL-2.1 OR BSD-3-Clause)`. [Decision 0015](0015-installed-dependency-license-audit.md) matches license declarations exactly, and it requires owner approval for any new exception. Without one, `pnpm licenses:check` fails.

## Decision

- `constraints.yaml` `dependencies.allowed_licenses.exceptions` gains one exact entry. It covers packages `[json-schema]`, version `0.4.0`, license `(AFL-2.1 OR BSD-3-Clause)`.
- The reason recorded is that the package is dual-licensed, and this project uses it under the BSD-3-Clause branch, which is already on the allowlist.
- The exit condition is: remove the entry when `@ai-sdk/provider` no longer depends on the package, and get new approval for any change of package, version or declared license.
- The [owner approved this on 2026-11-27](https://github.com/DankerMu/mindsprout/issues/301#issuecomment-7220527354).

## Alternatives considered

- **Allow composite `OR` expressions whose branches are all on the allowlist**: rejected. Decision 0015 requires every composite declaration to get its own explicit policy review.
- **Drop the Vercel AI SDK and hand-write the OpenAI-compatible adapter**: rejected. The owner declined that larger change. `@ai-sdk/openai-compatible` alone already brings in the package.

## Consequences

- This record extends decision 0015. The policy, matching rules and other exceptions of 0015 are unchanged.
- A Renovate bump of `@ai-sdk/provider` that changes the version or declared license of `json-schema` fails `pnpm licenses:check` until it is re-approved.
