## ADDED Requirements

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
