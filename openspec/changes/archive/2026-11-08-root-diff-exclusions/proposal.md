# Proposal

## Why

Issue50 documents that the diff guard counts root `pnpm-lock.yaml` despite promising lockfile exclusion. Default pathspec matching requires a slash in its `**/` patterns; the root snapshot siblings have the same defect. Large generated diffs can falsely exceed the unchanged 400-line gate.

## What Changes

- Apply glob pathspec semantics to `pnpm-lock.yaml`, `__snapshots__` contents and `*.snapshot` at root and nested depths.
- Extend existing guardrail fixtures with exact-count assertions and retain ordinary-file rejection, label behavior and fail-closed paths.
- Record the gate-integrity bug fix and verify the documented historical count.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- ci-diff-guard: generated-file exclusions apply equally at root and nested depths without excluding ordinary files or changing counting semantics.

## Impact

Only scripts/check-diff-size.sh, its existing guardrail suite, a bug-fix decision record and this fixture. No workflow, constraints, threshold, regex, label, dependency or vendored-template changes. No product release note: developer gate correction, not application behavior.

## Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent; expanded because a shared CLI and gate-integrity boundary change.
Blast radius: false-positive exclusions or accidental fail-open PR size enforcement.
Selected risk packs: public script entry; config; path matching; units/counting; large generated input; compatibility; errors; documentation.
Evidence floor: new native shell guardrails RED before fix/GREEN after; exact exclusion counts; historical1692→1684; 401 ordinary lines rejected; full guardrails, four-seat review and genuine required CI. Per the owner's explicit instruction, functional acceptance is consolidated after the remaining queue is complete rather than requested per issue.
