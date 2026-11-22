# Correlate native navigation profiles

## Why

Darwin CI failures cross the fixed root-commit and editor-readiness budgets while matching cold local runs pass, including Node 22.23.4 controls. Existing request/response events identify the boundary but do not distinguish compiler work, server JavaScript, browser execution, or runner scheduling. The owner authorized targeted CI profiling for #203 and sibling #199.

## What Changes

- Add opt-in, bounded profiling to the existing native browser probe and correlate it with its run, mode, server generation, process identity, and clocks.
- Retain compiler/server and browser evidence without request bodies, credentials, cookies, headers, or environment dumps; explicitly report missing or incomplete collection.
- Collect a separately labelled diagnostic execution after a failed Darwin qualification without changing or replacing the original failure. The required job remains failed regardless of the diagnostic outcome.
- Analyze the resulting evidence before proposing any runtime or native repair.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `development-navigation`: add a diagnostic evidence contract without modifying existing navigation or native-installation requirements.

## Impact

The existing native probe/observation helpers, their focused verification, Darwin CI evidence collection, and native operational guidance. No application API, native patch/package, dependency, cache policy, or qualification threshold change. The protected reference is PR219 head `d539f65e4e8b7de124c0b52108f06c3ad1e21016`; profiling work is isolated from that branch.

## Triage

Issue type: feature
Fixture level: expanded
Verification mode: Characterization; qualification and diagnosis remain separate.
Upstream suggested level: absent; expanded for process/file ownership, credential-safe evidence, and CI gate integrity.
Blast radius: misleading profiles, lost local artifacts, or a falsely green qualification.
Selected risk packs: script entry, config/setup, file IO, evidence schema/units, secrets, ordering, resource bounds, compatibility, error/cleanup, documentation.
Evidence floor: qualified safe artifact extraction, real bounded local capture and restoration, guardrails, unchanged default probe checks, independent review, and one attributable CI capture with the original failure retained. Characterization is not a native repair or merge qualification.
