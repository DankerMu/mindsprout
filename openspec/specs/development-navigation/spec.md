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

### Requirement: Native cache identity treats symbolic links as terminal entries

Native cache fingerprinting SHALL record every symbolic link as a link entry derived only from its link text and MUST NOT read, stat, or recursively traverse the link target. Regular files SHALL retain their relative path, byte size, and content SHA-256 semantics, and the identity SHALL distinguish link entries from regular-file entries.

#### Scenario: Warm cache contains a directory symlink

- **WHEN** a warm cache contains ordinary files, a real subdirectory, and a directory symlink whose target outside the cache contains a sentinel file
- **THEN** cache identity generation and persistence complete without reading the target subtree
- **AND** ordinary-file fields remain correct and no target-subtree file is included
- **AND** changing only the sentinel content leaves identity unchanged, while changing the link text changes identity

#### Scenario: Link targets are dangling, cyclic, or aliased

- **WHEN** cache entries include a dangling symlink, a symlink to an ancestor directory, or multiple symlinks to one external directory
- **THEN** each link is handled only as a terminal link entry
- **AND** fingerprinting completes without following a cycle, duplicating the target subtree, or requiring the target to exist

### Requirement: Published native resources remain available across restore

A resource published by a restored producer SHALL be retrievable with its correct content before it can be selected for client update computation. Multiple producers MUST preserve existing precedence; missing or removed resources MUST NOT be fabricated or retained as stale content.

#### Scenario: Shared and sole restored producer ownership

- **WHEN** producer A owns a shared resource and a sole resource, producer B owns the shared resource and another resource, and restoration independently demands A's computation without repeating its original registration caller
- **THEN** all three resources remain available with correct content and existing producer precedence

#### Scenario: Absent and removed resource

- **WHEN** a path has never been published or its sole producer removes it
- **THEN** lookup reports it missing while unrelated live resources remain available

### Requirement: Temporary native repair is reproducibly installed

The repair SHALL install through version-pinned package-manager metadata with integrity verification on macOS arm64 and Linux x64 GNU. Source revision, patch identity and built package digests MUST be traceable; unavailable or mismatched candidate artifacts MUST fail installation rather than silently loading the faulty native implementation. Every committed lockfile override that points at this repository's native release assets MUST resolve to a package entry whose tarball equals the override URL and whose integrity is a sha512 SRI value; a required check MUST fail, naming the override, when that does not hold, and MUST fail rather than pass when no such override is found.

#### Scenario: Frozen installation uses verified repair

- **WHEN** a clean supported environment installs the committed manifest and lockfile
- **THEN** the verified repaired native package loads and passes the native/runtime regression
- **AND** no uncommitted node_modules edits or diagnostic binding environment override is required

#### Scenario: Package integrity mismatch

- **WHEN** downloaded repair bytes differ from the committed package integrity
- **THEN** installation fails and no successful repair verification is reported

#### Scenario: Regenerated lockfile lost a native integrity

- **WHEN** a committed lockfile's `@next/swc-*` override entry has no `integrity`, a non-sha512 `integrity`, or no packages entry
- **THEN** the native lockfile check fails and names that override

#### Scenario: Selector finds no native override

- **WHEN** the lockfile overrides contain no URL under the repository's native release prefix
- **THEN** the check fails instead of passing vacuously

### Requirement: Native navigation diagnosis remains separate from qualification

The native browser probe SHALL provide explicit opt-in, bounded compiler/server and browser profiling. Default qualification SHALL remain unprofiled with unchanged deadlines, noise assertions, ordering, and cleanup. Profiling failures SHALL be reported as incomplete evidence and SHALL NOT clear or replace functional failures. Diagnostic artifacts SHALL contain only allowlisted, credential-safe projections with run/mode/generation provenance and explicitly labelled clock domains.

#### Scenario: Default and candidate qualification

- **WHEN** an existing installed-native or candidate-native command runs without the profiling option
- **THEN** its functional assertions, invocation contract, source/cache restoration, and process shutdown remain unchanged
- **AND** it issues no Next/CDP profiler commands and neither creates nor modifies `.next-profiles`, including a pre-existing unowned entry

#### Scenario: Installed and candidate profiling invocations

- **WHEN** `pnpm native:browser MODE FRESH_OUTPUT_DIRECTORY --profile` runs for an installed package, or `pnpm native:browser MODE FRESH_OUTPUT_DIRECTORY CANDIDATE_MANIFEST --profile` runs with the existing candidate environment
- **THEN** profiling is enabled without changing the installed/candidate identity checks or functional gates
- **AND** a misplaced, duplicate, unknown flag or surplus argument is rejected before source/cache/profile mutation

#### Scenario: Ambient profiling bypass is refused

- **WHEN** either invocation mode inherits `NEXT_CPU_PROF`, `NEXT_CPU_PROF_DIR`, `__NEXT_PRIVATE_CPU_PROFILE`, `NEXT_TURBOPACK_TRACING` or `NEXT_TURBOPACK_TRACING_PATH`
- **THEN** it rejects setup with a fixed diagnostic before importing Next or mutating source/cache/profile state
- **AND** it never emits the variable values or enables an implicit/redirected profiler

#### Scenario: Failed Darwin qualification

- **WHEN** an unprofiled Darwin restored-lifecycle or source-change step fails with valid matching failed-result evidence and verified source/cache cleanup
- **THEN** CI runs exactly one separately labelled diagnostic execution of that failed mode in a fresh output directory
- **AND** the original step, job and required aggregate remain failed whether diagnosis passes or fails
- **AND** successful qualifications, Linux, cancellation, and installation/setup failures run no diagnosis and require no diagnostic artifact

#### Scenario: Unsafe prior cleanup prevents replay

- **WHEN** prior result/cleanup evidence is missing, malformed, cleanup-blocked, or mismatches the current source identity
- **THEN** CI records a fixed ineligible reason without invoking another browser probe or modifying the original evidence
- **AND** the original qualification remains failed

#### Scenario: Safe correlated evidence

- **WHEN** a profiled run stops a server generation or completes a browser collection interval
- **THEN** it retains bounded numeric CPU summaries and allowlisted compile/request spans with collection brackets, explicit unknown PIDs, native target/digest, Node/OS/architecture, mode/generation/trial/page/role, and distinct workflow/checkout/PR-head SHA and run/attempt identity
- **AND** published summaries contain no raw profiles, arbitrary function names, URLs, tags, environment values, request bodies, headers, cookies, credentials, or raw exception messages
- **AND** collector epoch/elapsed milliseconds, trace epoch milliseconds/hrtime microseconds, Network monotonic/epoch seconds and CPU unspecified-monotonic microseconds remain distinct rather than being subtracted or represented as exact wall-clock attribution
- **AND** trace coverage is labelled observed-only, not a complete compiler history; prior-generation, ambiguous and missing role evidence is explicit
- **AND** publication constructs a fresh fixed schema in one bounded regular non-symlink safe file, never spreads raw objects or falls back to raw artifacts/logs

#### Scenario: Existing profile output is not owned

- **WHEN** the profiling directory already exists, including as a file or symlink
- **THEN** profiling refuses before source/cache mutation and preserves the existing entry

#### Scenario: Partial collection and lifecycle interruption

- **WHEN** enable/start/stop times out or disconnects, a raw file/profile is missing, empty, malformed or over a bound, or normal/failure/SIGINT/SIGTERM cleanup interrupts collection
- **THEN** fixed partial codes identify incomplete intervals without rejected raw content or a fabricated successful profile
- **AND** late replies cannot resume abandoned collection or alter the functional result
- **AND** no new profiling request is issued while the browser is suspended; the post-SIGCONT collection gap is explicit
- **AND** owned source/cache/profile/process cleanup still runs without overwriting unowned entries or extending existing browser-close/process-group shutdown budgets

#### Scenario: Collection bounds

- **WHEN** input reaches or exceeds the defined limits of 16 MiB/file, 15 files and 64 MiB/run, five server generations, eight browser intervals, 50000 nodes/250000 samples/300 buckets per CPU profile, 20000 trace records/2000 accepted spans per generation, or 1 MiB safe output
- **THEN** within-limit valid input can produce complete evidence and every cap-plus-one case produces explicit partial evidence without exceeding the retained-output bound
- **AND** bounds apply to collector ingestion/retention, not Next's raw producer memory/disk or already received CDP payloads
