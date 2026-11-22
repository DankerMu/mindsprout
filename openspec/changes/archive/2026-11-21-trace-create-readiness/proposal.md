# Trace public-create readiness

## Why

Issue #199 has two observed failure shapes: a readiness timeout before recorded editor RSC progress, and a timeout after RSC/scripts with map requests already issued. Existing artifacts omit API responses, exact budget boundaries, and first-observed marker visibility, so they cannot distinguish persistence/navigation/data-load waiting from client scheduling.

## What Changes

- Extend only the existing `--profile` diagnostic path with a bounded public-create timeline: budget boundaries, fixed-class API/RSC request lifecycle, SPA URL/history observations, and sampled marker visibility.
- Publish fixed-label numeric evidence in the existing safe summary, with explicit missing/partial states and unchanged total output cap; no raw paths, identifiers, headers, bodies, credentials, or exception text.
- Keep the original readiness assertion authoritative. Observation adds no requests, retry, warmup, extended deadline, or deliberate post-timeout wait.
- Preserve the reviewed profiling change and frozen parent branches. This is a separate diagnostic scope, not a latency repair.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `development-navigation`: add an opt-in public-create timing evidence requirement without changing qualification behavior.

## Impact

Extend existing `observeNavigation`, native runner/runtime-profile seams, safe projection/collection and their tests; update the native diagnostic guide. No product routes, database schema, native binaries, dependencies, CLI grammar or CI selection policy changes. Both native modes and installed/candidate callers retain their contract.

## Authorization and dependency

The owner explicitly selected “扩展 #199 定向采集” on 2026-11-17. Base is PR221 head `a0765ea54bb44d057a4bda6d19a4b11805041d89`; this change depends on `profile-native-navigation`, whose delta has not reached main specs. Do not amend or merge into that branch or frozen PR219. Retarget and requalify only after dependencies land. Proposal delivery is planning-only; implementation requires a later apply request.

## Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: absent; expanded for shared runner lifecycle, browser observation and safe evidence schema.
Blast radius: misleading timing, leaked request data, or diagnostic work altering qualification/cleanup.
Selected risk packs: script entry, config/setup, file IO, schema/units, privacy, concurrency, resource limits, compatibility, error/partial evidence, documentation.
Evidence floor: semantic behavioral red/green, bounded real-browser capture, unchanged default controls and cleanup, safe payload audit, scoped gates, independent review and attributable CI diagnostic evidence.
