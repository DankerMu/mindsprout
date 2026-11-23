# Spec Delta

## Purpose

Keep development navigation usable after source changes and native cache restoration, while preserving genuine hot updates and reproducible platform dependency delivery.

## MODIFIED Requirements

### Requirement: Diagnostic public-create timing remains attributable and non-authoritative

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

#### Scenario: CI evidence does not become qualification

- **WHEN** an eligible failed Darwin qualification triggers its existing single diagnostic execution
- **THEN** the original invocation retains only its lightweight default attempt record while the separate profiled invocation supplies the richer sampled timeline
- **AND** original qualification artifacts and failed job/aggregate remain authoritative and distinct from the replay
- **AND** replay selection permits up to 20,000 legacy events plus one valid default evidence envelope and at most one paired `public-create-observation-error` notice, with a hard total of 20,002 and unchanged byte caps and failure/resume checks
- **AND** the notice must use the same `public-map-setup` / `retained-editor` envelope, generation and trial zero, finite collector timestamps and exactly `stage: publication` and `message: Public-create evidence publication failed` in `data`; duplicates, unpaired or malformed notices and excess events are ineligible
- **AND** capture absence, diagnostic failure or non-reproduction is explicit, without same-head retry, warmup, altered cache, native package changes or a latency-repair claim
