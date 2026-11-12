# development-navigation Specification

## Purpose

Keep development navigation usable after source changes and native cache restoration, while preserving genuine hot updates and reproducible platform dependency delivery.

## Requirements

### Requirement: Development editor navigation remains ready

The development runtime SHALL reach the editor-ready marker within the existing five-second readiness deadline after the first navigation following a source change in the same server lifecycle. It MUST NOT require repeated document reloads, manual recovery, suppressed hot-update messages, retries, increased deadlines or disabled caches.

#### Scenario: First editor navigation after source invalidation

- **WHEN** a meaningful client source change occurs in a live development session and the user first navigates to a persisted map
- **THEN** editor readiness occurs within five seconds without repeated document navigation
- **AND** existing browser warning, error and pageerror assertions remain satisfied

#### Scenario: Retained session restores cached resource producers

- **WHEN** a server restores a previously used cache, a route handler executes before a retained browser reconnects, and the browser requests the editor
- **THEN** the normal session reconnect may reload once but does not enter a repeated restart/reload loop
- **AND** subsequent real source updates are still delivered

### Requirement: Published native resources remain available across restore

A resource published by a restored producer SHALL be retrievable with its correct content before it can be selected for client update computation. Multiple producers MUST preserve existing precedence; missing or removed resources MUST NOT be fabricated or retained as stale content.

#### Scenario: Shared and sole restored producer ownership

- **WHEN** producer A owns a shared resource and a sole resource, producer B owns the shared resource and another resource, and restoration independently demands A's computation without repeating its original registration caller
- **THEN** all three resources remain available with correct content and existing producer precedence

#### Scenario: Absent and removed resource

- **WHEN** a path has never been published or its sole producer removes it
- **THEN** lookup reports it missing while unrelated live resources remain available

### Requirement: Temporary native repair is reproducibly installed

The repair SHALL install through version-pinned package-manager metadata with integrity verification on macOS arm64 and Linux x64 GNU. Source revision, patch identity and built package digests MUST be traceable; unavailable or mismatched candidate artifacts MUST fail installation rather than silently loading the faulty native implementation.

#### Scenario: Frozen installation uses verified repair

- **WHEN** a clean supported environment installs the committed manifest and lockfile
- **THEN** the verified repaired native package loads and passes the native/runtime regression
- **AND** no uncommitted node_modules edits or diagnostic binding environment override is required

#### Scenario: Package integrity mismatch

- **WHEN** downloaded repair bytes differ from the committed package integrity
- **THEN** installation fails and no successful repair verification is reported
