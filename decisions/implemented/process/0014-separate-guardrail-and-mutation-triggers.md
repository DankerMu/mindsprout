---
id: 0014
title: Separate guardrail and mutation triggers
kind: process
status: implemented
date: 2026-11-07
---

# Separate guardrail and mutation triggers

## Problem

A shared PR path allowlist couples inexpensive guardrail self-tests and AGENTS command-table liveness to expensive mutation testing. Gate configuration outside that list can change without discovering the self-tests intended to detect policy drift. Expanding the shared trigger to every PR would also repeat mutation testing for unrelated changes.

## Decision

- Run the unchanged Guardrail self-test and AGENTS liveness jobs in `.github/workflows/weekly.yml` on every pull request, without a path filter.
- Move the complete mutation job to `.github/workflows/mutation.yml`. Use native `pull_request.paths` filtering for exactly `stryker.config.mjs`, `vitest.config.ts`, `package.json`, `pnpm-lock.yaml`, `.tool-versions`, and `.github/workflows/mutation.yml`. No runtime changed-file discovery or additional action is needed.
- Keep Monday 06:00 UTC schedules and manual invocation in both workflows, with `contents: read` permissions. Preserve job identities, action pins, and setup. The mutation runtime budget and report policy are governed by [decision 0018](../testing/0018-bounded-full-mutation-completion.md).
- Preserve warn/advisory classification and all thresholds. Neither workflow adds a required check or changes the `ci.yml` aggregate. The three required checks and their GitHub Actions source pins, `strict: true`, and `enforce_admins: false` remain governed by [decision 0013](0013-pin-required-checks-to-github-actions.md).

This trigger policy extends the broad governance in [decision 0001](0001-l4-profile-and-agent-review-governance.md); it does not supersede or retire that record or decision 0013.

## Alternatives considered

- **Keep growing the shared PR allowlist** — rejected: each new gate configuration path can recreate the discovery gap, and unrelated changes still trigger expensive mutation runs.
- **Run the combined workflow unfiltered on every PR** — rejected: cheap self-check coverage does not justify repeated expensive mutation testing on unrelated application, documentation, or gate-only changes.
- **Discover changed paths at runtime** — rejected: native workflow filters express the bounded mutation scope without scripts, API pagination, extra permissions, dependencies, or actions.

## Consequences

- Every PR discovers the cheap self-checks independently of mutation scope. Unrelated application, documentation, and gate-only PRs rely on weekly full-tree mutation testing; mutation-tooling changes also receive PR runs.
- Mutation remains advisory. [Decision 0018](../testing/0018-bounded-full-mutation-completion.md) partially supersedes this record's runtime-budget and report-policy clauses with measured full-run bounds, completeness validation, and retained interruption diagnostics; this trigger decision alone does not justify retries, exclusions, or budget increases.
- Real PR checks establish trigger discovery; a dispatched mutation job is not evidence of a completed mutation score. Scheduled execution uses the default branch.
- This engineering-policy change does not affect product behavior and needs no product changeset.
