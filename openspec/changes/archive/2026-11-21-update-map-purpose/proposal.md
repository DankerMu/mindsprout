# Proposal

## Why

Two capability Purpose summaries still describe browser-local persistence and future cloud sync after M2 shipped signed-in cloud maps. Correct those summaries without changing any behavior contract.

## What Changes

- Describe library operations over the signed-in user's cloud maps.
- Describe automatic, exact, versioned persistence in the signed-in user's cloud account, shared between browser and server.
- Preserve every requirement and scenario verbatim.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-library`: clarify the storage ownership in Purpose only.
- `map-persistence`: clarify current cloud persistence in Purpose only.

## Impact

Documentation only; no runtime, API, dependency, workflow or gate changes.

Issue type: docs
Fixture level: none
Upstream suggested level: absent (agree: two documentation summaries, no runtime behavior)
Blast radius: misleading readers about cloud versus browser-local storage.
Selected risk packs: documentation / migration notes; no other pack applies.
Evidence floor: prove only the two Purpose paragraphs change; validate strict main specs and run docs/decisions checks and Prettier.
Design: omitted at `none`; existing behavior is the authority for these two summaries.
