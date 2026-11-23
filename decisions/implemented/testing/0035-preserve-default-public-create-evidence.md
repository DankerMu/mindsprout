---
id: 0035
title: Preserve evidence from the default first public create
kind: testing
status: implemented
date: 2026-11-22
---

# Preserve evidence from the default first public create

## Problem

A default first-create readiness timeout needs evidence from its own invocation. Raw network events and a failure screenshot or DOM capture cannot establish what the assertion observed inside its five-second budget. An independent diagnostic replay cannot recover that evidence.

## Decision

- Keep qualification unprofiled. Reuse the existing public-create observer and fixed projection in the default process, without the page sampler. Publish one `public-create-evidence` event beside the unchanged legacy events. The [native guide](../../../docs/engineering/native-hmr.md#public-create-evidence) owns the field and clock contract.
- Fence a ready attempt immediately. Finalize a failed default attempt after the existing failure capture and before cleanup, without waiting for new evidence. Keep the original budget and outcome immutable; related late receipts and capture are `failed-tail`. Without an observed start, report partial evidence rather than inventing a budget or outcome.
- Partially supersede [decision 0031](0031-public-create-readiness-evidence.md) only on the profile-only scope of attempt attribution. Its bounds, redirect correlation, independent sampler ownership and non-authoritative semantics still apply. [Decision 0030](0030-native-navigation-diagnostic-profiling.md) continues to own profiling, safe-summary publication, signal ownership and failure-scoped replay.

## Alternatives considered

- **Keep only the separate profiled replay.** It can collect richer samples but cannot report the original attempt's deadline state.
- **Enable the sampler by default or add another collector.** Extra page work changes what qualification measures; separate collectors would duplicate attribution and safety rules. The existing CDP listeners suffice for passive network evidence.
- **Extend the deadline or wait for a late marker.** A later receipt does not prove readiness before the deadline; waiting would change qualification or teardown.

## Consequences

Default evidence is additive and has no migration. Marker and route samples remain opt-in, with their absence explicit in the default event. Evidence changes neither qualification nor replay eligibility, and does not establish a latency root cause. This testing change needs no product changeset.
