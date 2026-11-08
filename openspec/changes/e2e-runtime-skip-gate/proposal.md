# Proposal

## Why

Issue #125 shows that the zero-skipped E2E gate counts discovered route titles rather than runtime outcomes. A skipped test can therefore coexist with a successful gate; the observed95-test run had no skips and is not alleged to be false-green.

## Triage

Issue type: bugfix. Fixture level: expanded. Upstream level: absent; shared CI entrypoint, report parsing and gate integrity require expanded/high-risk review. Blast radius: required E2E verification, not product behavior. Selected packs: CLI/config, file IO, report schema, ordering, resource/discovery bounds, compatibility, errors and documentation. Evidence floor: native old-gate false-green, same-skip fixed-gate rejection, no-skip positive control, assertion-failure preservation, missing/malformed/inconsistent report and report-level error rejection, scoped guardrails and four-seat review.

## What Changes

- Generate native Playwright JSON and existing list console output in the same E2E execution; validate that report without rerunning tests or discovery.
- Reject actual skipped cases with file/title diagnostics and reject unusable reports. Preserve the existing nonzero route-smoke presence check through actual report entries, not discovery.
- Record the result/ownership decision; keep source, test selection, retry policy and unrelated workflow contracts unchanged.

## Capabilities

### New Capabilities

- `ci-e2e-results`: same-invocation runtime result acceptance for the required Playwright tier.

### Modified Capabilities

None. Existing harness-triggers and required-check-sources ownership remain unchanged.

## Impact

The layer7 E2E producer and gate in .github/workflows/ci.yml plus a decision record. Use the installed native JSON reporter and Node built-ins; no dependency, custom reporter or product change. Owner functional acceptance remains consolidated at the end of the queue.
