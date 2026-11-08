---
id: 0017
title: Exclude generated diff paths at root and nested depths
kind: bug-fix
status: implemented
date: 2026-11-08
---

# Exclude generated diff paths at root and nested depths

## Problem

Default Git pathspec matching does not give leading `**/` the zero-directory behavior needed by the diff guard's generated-file exclusions. Root `pnpm-lock.yaml`, `__snapshots__` contents and `*.snapshot` files can consume the ordinary-code diff allowance while their nested counterparts are excluded.

## Decision

Use explicit glob magic for exactly three exclusions in `scripts/check-diff-size.sh`:

- `:(glob,exclude)**/pnpm-lock.yaml` excludes that exact filename at the root and any nested depth.
- `:(glob,exclude)**/__snapshots__/**` excludes all contents beneath an exact `__snapshots__` directory at the root or any nested depth.
- `:(glob,exclude)**/*.snapshot` excludes filenames ending in `.snapshot` at the root and any nested depth.

With glob magic, leading `**/` matches zero or more directories; trailing `/**` includes every descendant. The near-misses `pnpm-lock.yaml.txt`, `__snapshots__extra/fixture.txt` and `fixture.snapshot.txt` remain counted.

Keep the other exclusions (`*.lock`, `.changeset/**`, `decisions/**`), diff filter, whitespace handling and counting expression unchanged. The 400-line limit, exact `diff-limit-exempt` label, usage and fail-closed behavior remain unchanged, as do workflow triggers, required contexts, lockfile-pairing rules and the PR template.

## Alternatives considered

- **Add only a literal root lockfile exclusion:** duplicates the lockfile policy and leaves root snapshot exclusions inconsistent with their nested counterparts.

## Consequences

- Generated paths consume no diff allowance at any intended depth; ordinary files still count, including a manifest paired with an excluded lockfile. Excluded content remains subject to independent gates, including lockfile–manifest consistency.
- Native CLI fixtures assert exact counts and exit statuses for root/nested exclusions and separate near-misses. Existing 400/401 boundaries, label handling, fail-closed cases and fixture cleanup remain covered.
- No active decision is superseded. [Decision 0001](../process/0001-l4-profile-and-agent-review-governance.md) retains L4 gate policy; [decision 0013](../process/0013-pin-required-checks-to-github-actions.md) retains required-check identities and source pins.
- This guard correction does not change application behavior or dependencies and needs no product changeset.
