---
id: 0013
title: Pin required checks to GitHub Actions
kind: process
status: implemented
date: 2026-11-07
---

# Pin required checks to GitHub Actions

## Problem

A required check with no source pin accepts its context name without requiring a particular producer. Another GitHub App able to publish that context could potentially satisfy the requirement without running the intended GitHub Actions gate. This is a source-identity risk, not a claim that an adversarial spoofing probe was executed.

## Decision

Pin all three required checks in GitHub classic branch protection on `main` to GitHub Actions (`app_id: 15368`):

- `All checks passed`
- `Lockfile–manifest consistency`
- `PR diff size guard`

The [owner approval](https://github.com/DankerMu/mindsprout/issues/64#issuecomment-6716084660) authorizes pinning the aggregate `All checks passed` check while retaining the other two source pins. Keep exactly these three contexts, `strict: true`, `enforce_admins: false`, and all unrelated branch-protection fields unchanged.

This narrowly extends [decision 0001](0001-l4-profile-and-agent-review-governance.md) with a required-check producer identity. Its broader L4 governance and agent-review policy remain valid; this record does not supersede or retire it. Source pinning does not remove administrator bypass while `enforce_admins: false`.

## Alternatives considered

- **Retain any-source acceptance for the aggregate check** — rejected: the context name alone does not establish that GitHub Actions produced the result.
- **Migrate to rulesets** — out of scope: classic branch protection supports the required source pin without replacing the protection mechanism.
- **Enable administrator enforcement** — a separate policy decision, not part of the approved source restriction.

## Consequences

- Future producer changes require an explicit policy decision before changing a required-check source. There is no automatic unpin or any-source fallback if the expected producer changes or becomes unavailable.
- Protection is remote GitHub state. Reverting this document does not undo the remote setting; reversing the source restriction requires an explicit policy decision and remote update.
- Inspection must confirm the three context/source pairs and preserved protection settings; operational details live in the [enforcement index](../../../docs/engineering/enforcement-index.md#branch-protection-applied).
- This engineering-policy change does not affect user-facing product behavior and needs no product changeset.
