# development-navigation Specification Delta

## ADDED Requirements

### Requirement: Native-surface changes carry local macOS arm64 qualification

CI SHALL qualify the installed native package and both browser modes on Linux x64 GNU only, as a dependency of `All checks passed`. A pull request, including a Renovate update, that changes a native qualification surface (`scripts/native-*`, `.github/actions/native-installed-runtime/`, the native jobs in `.github/workflows/ci.yml`, `patches/native/`, or the `@next/swc-*` overrides or their lockfile entries) SHALL NOT merge until its `## Runtime evidence` cites, for the PR head, a passed local macOS arm64 run of `pnpm native:browser restored-lifecycle` and `pnpm native:browser source-change` against the frozen installed tree: head SHA, command, exit code and `result.json` status. Without a macOS arm64 machine the PR is blocked, not exempt.

#### Scenario: Native-surface PR with local evidence

- **WHEN** a PR changes `scripts/native-hmr-support.mjs` and its runtime evidence cites both browser modes passing on macOS arm64 at the PR head
- **THEN** the native-surface requirement is satisfied and the required Linux checks decide the merge

#### Scenario: Native-surface PR without local evidence

- **WHEN** a Renovate PR changes the `@next/swc-darwin-arm64` override and no local macOS arm64 run at its head is cited
- **THEN** the PR does not merge, even if `All checks passed` is green

#### Scenario: Non-native PR

- **WHEN** a PR changes no native qualification surface
- **THEN** no macOS evidence is required and `All checks passed` decides the merge

### Requirement: Native navigation profiling remains separate from qualification

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

### Requirement: Public-create diagnostic timing remains attributable and non-authoritative

Native navigation diagnostics SHALL retain a bounded public-create timeline that distinguishes observed API/RSC network delivery, SPA URL/history changes and sampled ready visibility in the same invocation. Default qualification SHALL retain a lightweight fixed-projection attempt record without enabling profiler commands, additional listeners, page sampling or profile artifacts. Evidence SHALL use fixed classifications, validated provenance and separate clock domains, and SHALL NOT alter or replace the original readiness outcome, five-second budget, browser-noise assertions or resource cleanup.

#### Scenario: Default and existing caller behavior

- **WHEN** an installed or candidate native command runs either mode without profiling
- **THEN** the existing first-create observer records one bounded `public-create-evidence` event with original budget/action/outcome, fixed-class network receipts and explicit partial marker/route channels
- **AND** the local claim registers finalization before the first awaited Performance snapshot, begin precedes start, and the claimed no-sampler attempt remains armed until start records the original budget
- **AND** one CDP-close lifecycle hook marks network observation partial on detachment; no additional public-create timeline commands, network/timeline listeners, page sampling, HTTP requests, `.next-profiles` or `safe/` output are enabled
- **AND** legacy empty outcome/raw network events, invocation grammar, qualification ordering, assertions and cleanup remain unchanged
- **AND** the event's `data` carries the fixed `attempt`, `mode`, `generation`, `trial`, `page`, `budget`, `action`, `outcome`, `network`, `marker`, `routes`, `status` and `codes` fields; the addition requires no migration
- **AND** if that publication fails, a fixed `public-create-observation-error` notice is attempted without replacing the original functional result or preventing its persistence

#### Scenario: Profiled public creation

- **WHEN** a profiled invocation performs its first public-create action
- **THEN** its safe summary records the exact original collector budget start, deadline, action settlement and assertion outcome, or fixed partial states for unavailable observations
- **AND** bounded classified API PUT/GET, editor RSC and script records distinguish request, response, first data and completion/failure observations without inferring missing events
- **AND** same-invocation attempt, mode, generation, trial and page provenance prevents evidence from being attributed to another replay or navigation
- **AND** redirects preserve preceding-hop response attribution before replacement classification; excluded or over-cap replacement hops terminate correlation so later response/data/completion cannot mutate the preceding retained hop
- **AND** standalone wrong-origin or unsupported-method requests are ignored without retained raw content or capacity consumption

#### Scenario: Marker and SPA observations

- **WHEN** the public-create diagnostic observes route changes and the readiness marker
- **THEN** it retains fixed route classes and bounded presence/visibility samples with their own timestamps
- **AND** first-observed visibility is labelled with its preceding observation bracket, not asserted to be the exact first-visible instant or successful qualification
- **AND** presence without visibility, missed sampling, unavailable frame and renderer interruption remain distinguishable

#### Scenario: Timeout and late evidence

- **WHEN** the original action or readiness assertion fails, times out, or is interrupted
- **THEN** the original failed outcome and deadline remain immutable regardless of later responses or marker visibility
- **AND** the default attempt finalizes after the existing failure capture without a grace wait, with related post-outcome network receipts and capture metadata explicitly labelled `failed-tail`
- **AND** an already-installed profile sampler may continue only during existing failure capture/teardown; its page-side work and every post-outcome receipt remain labelled, without waiting for a late result or extending capture
- **AND** success stops accepting observations before later navigation and requests bounded best-effort sampler disposal; unacknowledged disposal is explicit partial shutdown-unknown evidence, with residual page work limited by autonomous expiry/cap/page close and no retry or grace wait
- **AND** diagnostic-command timeout, disconnect and interruption permanently abandon affected observation channels; late replies cannot revive them, rewrite a first-visible bracket, mutate finalized evidence or extend cleanup budgets
- **AND** profiled failure finalizes on page close or before publication, whichever comes first; accepted data remains immutable after finalization even if bounded page-side work has not yet acknowledged disposal

#### Scenario: Attempt has not started or readiness precedes save validation

- **WHEN** interruption occurs before claim/start, root document commit fails before the first create attempt, or the save-failure assertion fails after readiness has already succeeded
- **THEN** pre-claim/start interruption produces null budget and unavailable action/outcome without premature finalization, root failure produces only partial/unknown attempt evidence, and the save assertion preserves the already finalized ready outcome
- **AND** none of these paths fabricates a budget/action/readiness transition or rewrites the functional failure

#### Scenario: Later trial failure does not rewrite successful creation

- **WHEN** the first create has finalized ready and a later restored-lifecycle trial fails
- **THEN** attempt 1 remains ready and rejects later mutation, the unrelated failure capture omits `publicCreate.phase = failed-tail`, and the later functional failure and cleanup remain authoritative

#### Scenario: Separate clocks and absent events

- **WHEN** collector, network and browser observations have different clock origins, or a channel is incomplete
- **THEN** the summary retains labelled units/origins and explicit unknown or partial status rather than deriving unsupported cross-clock durations
- **AND** absent observer events do not assert server non-response, script completion does not assert execution, and sampled visibility does not assert visibility before the original deadline
- **AND** API network completion does not assert parsing or application data readiness, and a SPA URL/history event does not assert an RSC or React commit

#### Scenario: Safe bounded publication

- **WHEN** requests, redirects, route transitions, marker samples or published output reach a bound, or browser-controlled inputs contain hostile strings
- **THEN** one attempt retains at most64 request records including redirect hops,16 route observations and128 marker samples with sampling no faster than50ms; the sampler performs no layout reads after6400ms from arming, and cap-plus-one reports explicit partial evidence
- **AND** default and profile fixed projections contain only fixed enums, finite numbers, local bounded ordinals and validated provenance; no raw paths, URLs, query values, IDs, DOM text, headers, cookies, bodies, credentials or exception messages are added
- **AND** normal and compact profile output preserve attempt identity, original budget/outcome and channel completeness/omission information within the existing1MiB safe-summary bound
- **AND** existing owned no-follow publication and foreign-entry preservation remain unchanged

#### Scenario: Profiled evidence does not become qualification

- **WHEN** a separate `--profile` invocation runs after a failed default qualification
- **THEN** the original invocation retains only its lightweight default attempt record while the profiled invocation supplies the richer sampled timeline
- **AND** the original qualification artifacts and result remain authoritative and distinct from the profiled run
- **AND** capture absence, diagnostic failure or non-reproduction is explicit, without retry, warmup, altered cache, native package changes or a latency-repair claim

## MODIFIED Requirements

### Requirement: Native browser probes use an isolated signed-in account

The native HMR CI leg and each local native browser run SHALL prepare a reachable job-local Postgres 16 database with `pnpm db:setup` and both application and migration URLs. Before creating its first page, the probe SHALL register a fresh user through its browser context and verify that `/api/auth/session` returns that username from the same context. It SHALL preserve both native navigation scenarios and their existing timing, console, cleanup and artifact gates.

#### Scenario: Linux and macOS database preparation

- **WHEN** the required Linux native HMR leg starts, or a developer runs either browser mode locally on macOS arm64
- **THEN** CI uses a healthy Postgres 16 service container and the local run uses an owned Postgres 16 database (never a shared developer database), and both run `pnpm db:setup` before either browser scenario

#### Scenario: Session established before public map creation

- **WHEN** the probe creates its browser context
- **THEN** registration and a same-username session check succeed through that context before its first page opens, and the session remains usable across the existing restored-lifecycle restarts without re-registration or expected non-2xx browser noise

## REMOVED Requirements

### Requirement: Darwin installed-native leg is quarantined from the required aggregate

**Reason**: Decision 0038 deletes the Darwin installed-native CI leg instead of keeping it quarantined (issue #286).
**Migration**: Native-surface PRs cite local macOS arm64 browser-mode runs ("Native-surface changes carry local macOS arm64 qualification").

### Requirement: Native navigation diagnosis remains separate from qualification

**Reason**: Its CI-only Darwin diagnostic replay ("Failed Darwin qualification", "Unsafe prior cleanup prevents replay") has no runner after decision 0038 deletes the Darwin leg (issue #286).
**Migration**: "Native navigation profiling remains separate from qualification" keeps every other scenario unchanged; diagnosis is an explicitly requested `--profile` invocation.

### Requirement: Diagnostic public-create timing remains attributable and non-authoritative

**Reason**: Its "CI evidence does not become qualification" scenario describes replay selection for the deleted Darwin CI leg (decision 0038).
**Migration**: "Public-create diagnostic timing remains attributable and non-authoritative" keeps every other scenario unchanged and replaces that scenario with "Profiled evidence does not become qualification".
