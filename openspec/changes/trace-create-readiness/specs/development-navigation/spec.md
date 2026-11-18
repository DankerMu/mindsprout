## ADDED Requirements

### Requirement: Diagnostic public-create timing remains attributable and non-authoritative

Opt-in native navigation diagnostics SHALL retain a bounded public-create timeline that distinguishes observed API/RSC network delivery, SPA URL/history changes and sampled ready visibility in the same invocation. Evidence SHALL use fixed classifications, validated provenance and separate clock domains, and SHALL NOT alter or replace the original readiness outcome, five-second budget, browser-noise assertions or resource cleanup.

#### Scenario: Default and existing caller behavior

- **WHEN** an installed or candidate native command runs either mode without profiling
- **THEN** no additional public-create timeline commands, listeners, sampling or output are enabled
- **AND** existing invocation grammar, qualification ordering, assertions and cleanup remain unchanged

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
- **AND** the already-installed bounded sampler may continue only during existing failure capture/teardown; its page-side work and every post-outcome receipt remain labelled, without waiting for a late result or extending capture
- **AND** success stops accepting observations before later navigation and requests bounded best-effort disposal; unacknowledged disposal is explicit partial shutdown-unknown evidence, with residual page work limited by autonomous expiry/cap/page close and no retry or grace wait
- **AND** diagnostic-command timeout, disconnect and interruption permanently abandon affected observation channels; late replies cannot revive them, rewrite a first-visible bracket, mutate finalized evidence or extend cleanup budgets
- **AND** failure finalizes on page close or before publication, whichever comes first; accepted data remains immutable after finalization even if bounded page-side work has not yet acknowledged disposal

#### Scenario: Separate clocks and absent events

- **WHEN** collector, network and browser observations have different clock origins, or a channel is incomplete
- **THEN** the summary retains labelled units/origins and explicit unknown or partial status rather than deriving unsupported cross-clock durations
- **AND** absent observer events do not assert server non-response, script completion does not assert execution, and sampled visibility does not assert visibility before the original deadline
- **AND** API network completion does not assert parsing or application data readiness, and a SPA URL/history event does not assert an RSC or React commit

#### Scenario: Safe bounded publication

- **WHEN** requests, redirects, route transitions, marker samples or published output reach a bound, or browser-controlled inputs contain hostile strings
- **THEN** one attempt retains at most64 request records including redirect hops,16 route observations and128 marker samples with sampling no faster than50ms; the sampler performs no layout reads after6400ms from arming, and cap-plus-one reports explicit partial evidence
- **AND** publication contains only fixed enums, finite numbers, local bounded ordinals and validated provenance; no raw paths, URLs, query values, IDs, DOM text, headers, cookies, bodies, credentials or exception messages are added
- **AND** normal and compact output preserve attempt identity, original budget/outcome and channel completeness/omission information within the existing1MiB safe-summary bound
- **AND** existing owned no-follow publication and foreign-entry preservation remain unchanged

#### Scenario: CI evidence does not become qualification

- **WHEN** an eligible failed Darwin qualification triggers its existing single diagnostic execution
- **THEN** only that separate invocation supplies the added timeline; original qualification artifacts and failed job/aggregate remain authoritative
- **AND** capture absence, diagnostic failure or non-reproduction is explicit, without same-head retry, warmup, altered cache, native package changes or a latency-repair claim
