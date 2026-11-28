# Proposal

## Why

PRD §8 M3 acceptance is "输入主题流式长出骨架，Claude 和 OpenAI 兼容接口都能跑；三层导图 10 秒内完成". Today `src/contexts/ai/` is empty: an empty map can only be filled by hand. M1 and M2 are complete, so the TreeOp protocol (decision 0003), the undo groups and the cloud autosave are ready for the first AI producer.

The owner's Stage 1 grill (2026-11-26) and the Stage 3 provider probes fixed the shape:

- Generation uses the tool-calling channel only.
- The platform provider is dmxapi.cn's Anthropic-native endpoint with `deepseek-v4.1-flash-1017`, set by server environment.
- Quota is deferred to M4, and nothing is deployed in M3.
- PRD §6's first-node target moves from < 3 s to < 6 s; the 10 s completion target is unchanged.

## What Changes

- **Provider layer (new, `ai` context).** One port, `Provider.streamOps(request) → AsyncIterable<TreeOp>` (decision 0002), with three adapters:
  - **Claude-protocol:** `@anthropic-ai/sdk` with a configurable base URL. It is the platform default via dmxapi. It uses strict tools with `tool_choice: auto`, `eager_input_streaming`, effort `medium`, a cached system prompt and `fallbacks: "default"`.
  - **OpenAI-compatible:** Vercel AI SDK with `@ai-sdk/openai-compatible` and a configurable base URL.
  - **Mock:** a deterministic adapter for unit, smoke and e2e runs. It is refused in production.
- **Generate protocol (new).**
  - The model calls one `add_children` tool per parent with a flat list of children and short temporary ids. It makes the root call first, then every first-level call in one turn.
  - The server validates each complete call, replaces temporary ids with fresh nanoids, and emits it as one TreeOp.
  - Caps truncate silently: depth 2 below the root, 7 children per parent and 60 in total. A call under a dropped node is dropped too.
  - Tool calls are acknowledged for at most 4 turns. Generation stops as soon as every first-level node has children.
  - The whole request is retried once, only before the first op and never after a refusal. Total time limit: 30 s.
- **Configuration (new).** `AI_PROVIDER` (`anthropic | openai-compatible | mock`) and `AI_MODEL` select one provider; keys and base URLs live in server env.
  - Empty values count as unset.
  - With AI unset, the app runs and generation answers 503 `ai-unavailable`.
  - A partially configured provider fails loudly at load.
  - The verification server behind `pnpm smoke` always uses the mock provider.
- **`POST /api/ai/generate` (new route).**
  - JSON only, signed-in and stateless; body `{ topic, rootId }`. It never reads or writes maps.
  - Errors before the stream answer 415/401/400/503 JSON.
  - The `text/event-stream` carries `op`, `error` and `done` events, and a client disconnect aborts the provider call.
  - It is registered in `schemas/openapi.yaml` and `smoke/api.hurl`.
- **Editor topic generation (new).**
  - An empty map shows a topic input. Nothing changes until the first op arrives.
  - The first op sets the root text to the topic (and the title, if it is still `新导图`) inside one `generate` undo group. Each further op is dispatched through the reducer as it arrives.
  - Tree editing is locked while generating, and Stop is offered.
  - Stop, interruption and leaving the page keep the applied ops as one undo step and save normally.
  - Failures show fixed Chinese notices.
- **Layout transitions (modified, `canvas-layout`).** Layout changes animate with a 200 ms transform transition, and new nodes fade in. The drag preview and reduced motion are excluded.
- **Live acceptance exception (process).**
  - `pnpm e2e` stays on the mock provider and never collects the live spec.
  - `pnpm e2e:live` (`E2E_AI_LIVE=1`) runs one spec with the owner's `.env` key and asserts first node < 6 s and three layers complete < 10 s.
  - It is refused under `CI=true`, which is proven by a guardrail fixture.
  - Decision 0039 amends the AGENTS/CONTEXT/0002 "no real paid key" rule to exactly this exception.
- **Vocabulary.** The glossary gains **Generate**, distinct from node-level **Grow**. The CONTEXT question on naming the three modes moves to M4.
- **PRD §6.** "AI 首个节点出现" goes from < 3 s to < 6 s (PRD 0.3, owner decision on probe evidence).
- **Dependencies.** `ai` and `@ai-sdk/openai-compatible` land with the OpenAI-compatible adapter, and `@anthropic-ai/sdk` with the Claude adapter, each with the license audit.

## Capabilities

### New Capabilities

- `ai-provider`: the Provider port and its three adapters, environment configuration, the Generate tool protocol, output validation with id remapping and truncation, the turn loop, prompt, retry, timeout and error hygiene.
- `ai-generate-api`: the `POST /api/ai/generate` HTTP contract, covering content type, authentication and Session binding, body validation, pre-stream errors, the SSE event stream, disconnect abort and the published contract.
- `topic-generation`: the editor's empty-map topic input, first-op deferral, streaming application inside one undo group, the editing lock, Stop, failure notices, reducer-rejection revert, leave-page handling and title adoption.
- `ai-live-acceptance`: mock-only default verification, the opt-in live Playwright run and its CI refusal.

### Modified Capabilities

- `canvas-layout`: layout changes animate and new nodes fade in, with the drag preview and reduced motion excluded.

## Issue #296 Fixture Triage

Issue type: feature
Fixture level: compact
Upstream suggested level: compact (agree: pure zod schemas, error types and a deterministic assembler; no I/O, no route, no Critical Path)
Blast radius: the assembler is the only gate between model output and the map reducer; a wrong id remap, depth or cap rule emits ops the reducer rejects (whole generation reverted) or lets a model exceed the billing-shaped caps.
Selected risk packs: Schema/field names (strict tool input, error-code union); Resource limits (depth 2, 7 per parent, 60 total, injected caps); Error handling (unknown parent, duplicate or dropped temporary id, malformed input are ProviderOutputError, never repaired). Not selected: Public API (no route yet), Config (2.1), Auth, File IO, Concurrency (one assembler per attempt, synchronous), Release (no dependency), Docs (no doc goes stale; TECH lands with 3.2/3.4), Legacy compatibility (the ai context is empty; compatibility with map is proven by parseTreeOp on every emitted op and by `pnpm boundaries`).
Must preserve: `src/contexts/map/domain/tree-op.ts`, `parseTreeOp`, the `domain-is-pure` rule and `src/contexts/account/acl/map.ts` stay unchanged. Downstream consumers: 1.2 (tool name `add_children`, input schema), 1.3 (`complete`, `ProviderOutputError`), 2.2 (the three error classes, code union), 3.1–3.4 (assembler `{ rootId, idFactory, caps }`, `Provider` port).
Input contract: the assembler takes an already-parsed `unknown` tool input; JSON parsing belongs to the adapters, whose unparseable-input cases are proven in 3.2 and 3.4.
Evidence floor: Vitest scenarios listed in task 1.1 including `complete` and parseTreeOp on every emitted op; `pnpm boundaries`; per-file coverage ≥ 90%; `pnpm typecheck`, `pnpm lint`. design.md D1/D2 are the design; no per-issue design section.

## Issue #316 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override: the turn count and stop rule are a billing guard — money trigger — and the helper owns async ordering, abort and iterator cleanup)
Blast radius: every adapter's turn count and stop rule; a missed stop bills an extra turn on every generation, an early stop truncates skeletons, a missed zero-op check passes an empty answer as success, an unclosed turn keeps streaming and billing while 2.2 retries.
Selected risk packs: Resource limits (4 turns; `complete` stop; turn iterator closed on early stop); Error handling (zero-op natural end is `ProviderOutputError`; assembler errors propagate; abort is never `ProviderOutputError`); Concurrency/ordering (ops yielded at once in arrival order; abort checked before each turn). Not selected: Schema (1.1 owns it), Public API (internal; consumers named below), Config, Auth, File IO, Release, Legacy, Docs (design D3 amended in this PR).
Interface: `runTurnLoop({ request, idFactory, caps, runTurn, maxTurns = 4 })` yields `TreeOp`; `runTurn(turn)` yields `{ type: 'tool-input', input: unknown }` items then returns `'natural' | 'tool-use'`; the D3 turn-end mapping is applied by adapters. Design: D3 "One loop".
Must preserve: the 1.1 assembler and errors unchanged. Downstream consumers: 3.1 mock, 3.2 OpenAI-compatible, 3.3 Claude (each supplies only `runTurn`); 2.2 retries the helper's `ProviderOutputError` and never an abort.
Evidence floor (Vitest, scripted fake turns): "Two-turn skeleton" → two `runTurn` calls, ops of both turns, no third call; "Turn limit" → exactly 4 calls, all ops kept, normal end; "No tool call is invalid output" → natural end with zero ops rejects `ProviderOutputError`; natural end after ops → no further call; immediacy → a turn that yields input 1 then blocks delivers op 1 before the turn ends; ops after `complete` within one turn are yielded; abort before turn n → `runTurn(n)` never called, rejects with `signal.reason`, zero-op abort is not `ProviderOutputError`; assembler error mid-turn and consumer early stop → the fake turn's `return()` is recorded; `pnpm boundaries`; coverage ≥ 90%.

## Issue #297 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: compact (override: the issue also ships the shared wire tool schema that 3.2 and 3.3 send, a format surface; extension recorded in tasks.md 1.2 and design D6)
Blast radius: every real adapter's request. A drifting prompt or tool definition breaks the Claude cache prefix (tools, then system) or lets the model ignore the protocol; a wire schema with a keyword Claude strict tools reject (`minLength`) fails every Claude request with 400.
Selected risk packs: Schema/field names (the wire tool definition `{ name, description, inputSchema }`: a byte-stable literal JSON Schema with `additionalProperties: false` and `required` at both object levels, `minItems: 1`, no `minLength`, no `$schema`; 1.1's zod schema stays the enforcement point in the assembler); Legacy compatibility (cache-prefix stability: module constants, no per-request text). Not selected: Error handling (no failure path), Resource limits (caps enforced in 1.1; the prompt only states them), Public API, Config, Auth, File IO, Concurrency, Release, Docs (TECH §5 lands with 3.2/3.4).
Interface: `ai/application/generate-prompt.ts` exports the system prompt constant, the shared tool definition and `buildGenerateRequest(topic) → { system, messages: [{ role: 'user', content }] }`.
Must preserve: 1.1's `GENERATE_TOOL_NAME` and `generateToolInputSchema` unchanged. Consumers: 3.2 and 3.3 ("Same instruction for real adapters"); 3.1 mock ignores the prompt.
Evidence floor: Vitest "Instruction content": the constant contains each anchor — `add_children` (changes only through the tool), one parent per call with a flat children list, `root` for the primary root with short temporary ids, root call first then every first-level call in one turn, two levels, `3–7`, `40` characters with no paragraphs, mutually exclusive siblings, language follows the topic. Builder: for two different topics, `system` equals the constant and the topic appears only in the user message. Tool definition: deep-equals a literal (name `GENERATE_TOOL_NAME`, both-level `additionalProperties: false` and `required`, `minItems: 1`, no `minLength`, no `$schema`), and equals `z.toJSONSchema(generateToolInputSchema)` once `$schema` and `minLength` are removed, so a zod drift is caught. `pnpm boundaries`; coverage ≥ 90%.

## Issue #300 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: Critical Path `providers/`; the contract suite becomes the shared oracle for every adapter)
Blast radius: every smoke, e2e and route test runs on the mock; a mock that bypasses the assembler or the turn loop would hide protocol bugs from all of them, and a weak contract suite lets 3.2/3.3 ship a transport that overruns turns or drops the abort signal.
Selected risk packs: Public API (the `Provider` contract every adapter must satisfy; the suite is its executable form); Error handling (reserved topics); Concurrency/ordering (signal-aware per-op delay; abort while the transport waits); Resource limits (turn limit through the 1.3 helper). Not selected: Schema (1.1), Config and production refusal (2.1), Auth, File IO, Release (no dependency), Legacy, Docs (TECH §5 lands with 3.2/3.4).
Mock interface: `src/contexts/ai/infrastructure/providers/mock.ts` exports `createMockProvider({ idFactory, delayMs, script? })`. `streamOps` calls `runTurnLoop` with `PRODUCTION_CAPS` and a `runTurn` built from a turn script, a function `(turn) => { steps, end }` whose steps are tool inputs or a "wait on the signal" step carrying an `onWait` callback that fires when the wait starts. The mock harness wraps an injected script to count turn requests (`turnsRequested()`) and resolves `waiting` from `onWait`. Reserved-topic scripts and an injected `script` share that type, the one `runTurn` builder, the delay path and `runTurnLoop`, so no script bypasses the assembler or the loop. `script` is a test seam; 4.1 never passes it. The default script ends turn 2 on tool use with a turn 3 available, so the stop is the `complete` stop.
Suite interface (supersedes "`(makeProvider, fixtures)`" in tasks.md 3.1–3.3 and design Seams, aligned in this PR): `tests/support/provider-contract.ts` exports canonical per-turn tool inputs (temporary ids, texts, turn ends) for scenarios `skeleton`, `endless` and `stalled`, and `describeProviderContract(name, makeHarness)`; `makeHarness(scenario)` returns `{ provider, turnsRequested(), waiting }` and each adapter's harness encodes the canonical inputs into its wire format.
Contract cases: `skeleton` (turn 1: root call with 4 children, ends on tool use; turn 2: 4 first-level calls with 3 children each, ends on tool use; turn 3 available) → 5 ops, every op passes `parseTreeOp`, no id equals a temporary id, all ids distinct, op 1 targets `rootId`, `turnsRequested()` is 2. `endless` (turn 1: `root` → `a`, `b`; turns 2–4: one call adding one child under `a` each, every turn ending on tool use, a turn 5 available; `b` never gets a child, so the skeleton never completes) → 4 turns requested, 4 ops kept, normal end. `stalled` (turn 1 as `skeleton`; the turn-2 request hangs until its own signal aborts) → the test awaits `waiting`, aborts while `next()` is pending, the attempt rejects with `signal.reason` within a bounded race, and `turnsRequested()` is 2; the harness transport settles only through the signal the adapter gave it, so a dropped signal fails as a hang.
Must preserve: 1.1 assembler and 1.3 loop unchanged. Consumers: 4.1 composition (`delayMs` 150, nanoid `idFactory`), 3.2 and 3.3 (harnesses over wire fixtures), 4.3 smoke and 5.5 e2e (reserved topics).
Evidence floor (Vitest): the suite passes for the mock; "Deterministic skeleton": two runs of `学习 TypeScript` give 5 ops and 16 nodes with identical texts and tree shape and different ids; "Scripted mid-stream error": `mock:error-after-2` yields 2 ops (7 nodes), then rejects `ProviderTransportError`; `mock:invalid-first` yields zero ops and rejects `ProviderOutputError` on each of two fresh attempts; `mock:refused` yields zero ops and rejects `ProviderRefusedError`; the per-op delay is awaited, and an abort during it rejects with `signal.reason`; `pnpm boundaries`; coverage ≥ 90%.

## Issue #302 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: Critical Path `providers/`, a new runtime dependency, billing and key handling)
Blast radius: the platform-default adapter. A wrong setting multiplies spend (SDK retries, extra turns, forced tool choice 400s); a missing ack or signal breaks every second turn or keeps billing after Stop; a repaired truncated input applies ops the model never finished; a leaked key or body is a billing/security incident.
Selected risk packs: Public API (the `Provider` contract via the shared suite); Auth/secrets (`ANTHROPIC_API_KEY` only in `x-api-key`; SDK logging off so no body or topic is logged); Config (`baseURL` only when set, `maxRetries: 0`); Concurrency/ordering (signal passed to the SDK stream; abort while waiting); Resource limits (turn loop through 1.3, `max_tokens` 8000 per turn); Error handling (strict parse of each tool input; unknown stop reasons; `fallback` blocks); Release/dependency (`@anthropic-ai/sdk` pinned exactly at 1.13.0, published 2026-11-23, Apache-2.0). Not selected: Schema (1.2 owns the tool definition), File IO, Legacy, Docs (TECH §5.2 lands with 3.4).
Interface: `src/contexts/ai/infrastructure/providers/anthropic.ts` exports `createAnthropicProvider({ apiKey, model, baseURL?, idFactory, fetch? })`. It builds one SDK client (`maxRetries: 0`, `baseURL` only when set, `logLevel: 'off'`, the injected `fetch` in tests; the issue's "injected SDK client" is realised as an injected `fetch` under the real client) and a `runTurn` that sends one `client.beta.messages.stream(body, { signal: request.signal })` per turn with the D4 settings.
Tool input source: each `tool_use` block's `input_json_delta.partial_json` is accumulated by the adapter and parsed with strict `JSON.parse` at its `content_block_stop`; the SDK's partial-JSON snapshot (`block.input`) is never used, because it silently completes truncated JSON (a repair). A strict-parse failure of accumulated input (truncated JSON, which the SDK would otherwise complete) is `ProviderOutputError` in this slice. Non-truncated malformed JSON is caught by the SDK first: it surfaces as an `AnthropicError` whose message contains the raw model JSON, and mapping it is 3.4 ("malformed input JSON").
Stop reason: read from `await stream.finalMessage()` after the events end (it rethrows errors the event iterator may swallow). Mapping in this slice: `tool_use` → `tool-use`; `end_turn`, `stop_sequence` → `natural`; any other value or none → `ProviderTransportError`. `refusal` and `max_tokens` are refined by 3.4; until then they reject as `ProviderTransportError`, which is safe only because 4.1 (the first reachable composition) depends on 3.4.
History and acks: before turn n+1 the adapter appends the assistant content of turn n and a user message with one `tool_result` `ok` block per `tool_use` id. `fallback` blocks (from `fallbacks: 'default'`): a `fallback` block after a tool input of the same turn was yielded rejects the attempt with `ProviderTransportError` (an emitted op cannot be withdrawn); otherwise the `fallback` block is replayed in place, `thinking`, `redacted_thinking` and `connector_text` blocks before the last `fallback` block are dropped (vendor "Continuing the conversation" table), and only `tool_use` blocks after the last `fallback` block get `tool_result`s. Every other block, including signed `thinking` blocks after the last fallback, is replayed unchanged. The SDK client also pins `openTelemetry: false` (no SDK spans; design Non-Goals defer generation spans) and every SDK error path aborts the HTTP request before rejecting.
Contract: the shared suite gains a `natural` scenario (turn 1 `root` → `a`, `b` ending naturally, a sentinel turn 2 available → 1 op, 1 turn requested), run against the mock and this adapter; #301 must encode it too (whichever merges second rebases). The Claude harness encodes the canonical inputs as hand-authored Messages SSE over the injected `fetch`, counts `fetch` calls as turns, and for `stalled` returns a body that settles only when the request's own `init.signal` aborts.
Must preserve: 1.1–1.3 and the mock unchanged except the suite's new scenario. Consumers: 3.2/#301 (the `natural` scenario), 3.4 (failure paths here), 4.1 composition (env → options), 7.3 live run. Probe 2026-11-27: dmxapi accepts the full D4 body (`fallbacks` + beta header, `output_config.effort`, `cache_control`) for `deepseek-v4.1-flash-1017`; `claude-haiku-5-5` returns 400 for `effort` + `cache_control`, so 7.3 picks a Claude model that accepts them.
Evidence floor (Vitest over the injected `fetch`, `ANTHROPIC_*` env stubbed): the suite passes for the mock and this adapter, including `natural`; "Two-turn skeleton" and "Turn limit"; the turn-1 body asserts model, `max_tokens` 8000, `output_config.effort` `medium`, no `thinking`, `fallbacks: 'default'`, no `betas` field, `tool_choice` `{ type: 'auto' }`, a tool deep-equal to `GENERATE_TOOL_DEFINITION` mapped to `input_schema` plus `strict: true` and `eager_input_streaming: true`, a system block equal to `GENERATE_SYSTEM_PROMPT` with `cache_control`, and the topic only in the user message; the `anthropic-beta` header contains `server-side-fallback-2026-07-01`; the key appears only in `x-api-key`; the URL uses the injected `baseURL`, and the default host when unset; the turn-2 body ends with the assistant content and one `tool_result` `ok` per `tool_use` id; a truncated `partial_json` at block stop → `ProviderOutputError`, zero ops; `stop_sequence` → natural, 1 turn; `pause_turn` and a missing stop reason → `ProviderTransportError`; a fallback-first turn (fallback block, then `tool_use`) is replayed with the fallback block in place and a `tool_result` only for the later call; a `fallback` block after a yielded input → `ProviderTransportError`; a 529 response is requested exactly once (no SDK retry) and the attempt rejects; `pnpm licenses:check`, `pnpm install --frozen-lockfile`, `pnpm dead-code`, `pnpm boundaries`; coverage ≥ 90%.

## Issue #303 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: Critical Path `providers/`; the classification decides what `generate()` retries, so it controls spend and the user-visible code)
Blast radius: every Claude failure. A refusal misread as invalid output is retried, which bills twice and violates "A refusal SHALL never be retried". A truncated input misread as natural applies ops the model never finished. An error that forwards the SDK message leaks model JSON or a response body.
Selected risk packs: Error handling (stop-reason and SDK-error classification); Auth/secrets (HTTP bodies, keys and request ids never in a surfaced message, `cause` or log); Resource limits (no adapter retry: an HTTP error is requested exactly once); Docs (TECH §5.2). Not selected: Public API (the `Provider` contract is unchanged), Schema, Config, File IO, Concurrency (the abort and stream-abort paths of 3.3 are unchanged), Legacy, Release/dependency (no dependency change).
Interface: only `src/contexts/ai/infrastructure/providers/anthropic.ts` and its test, plus `docs/TECH.md` §5.2. `createAnthropicProvider`'s options and the `runTurn` shape are unchanged. The test file must stay within the 700-line ESLint `max-lines` limit. Rows that share a shape use `it.each`. If the file still exceeds the limit, the SSE fixture builders move to `tests/support/anthropic-sse.ts`: moved, never copied. The PR then carries `diff-limit-exempt`, because the guard counts a move as both deletions and additions.
Deferred input verdict: a strict-parse failure at a `tool_use` block's `content_block_stop` no longer throws at once. The turn is marked unfinished, and the failed input is neither yielded nor replayed. A later `content_block_start` in an unfinished turn throws `ProviderOutputError`. A `tool_use` block that never reaches its stop also counts as unfinished when the message ends. The verdict is taken at the turn end from `finalMessage().stop_reason`.
Turn-end mapping (D3 and D4, in order):

- `refusal` gives `ProviderRefusedError`, whether or not the turn is unfinished or ops were yielded earlier in it.
- Otherwise an unfinished turn gives `ProviderOutputError`, whatever the stop reason. With `max_tokens` this is the "unfinished tool input at the token cap" row.
- `tool_use` gives `tool-use`.
- `end_turn`, `stop_sequence` and `max_tokens` with every input complete give `natural`.
- Any other value or none gives `ProviderTransportError`. This covers `pause_turn`, `model_context_window_exceeded`, unknown values and null.
  Claude has no `content-filter` stop reason. That row of D3 belongs to 3.2.
  SDK errors, classified in `streamTurn`'s catch after `stream.abort()`:
- A `ProviderOutputError`, `ProviderTransportError` or `ProviderRefusedError` is rethrown. The abstract base class is not exported, and `domain/errors.ts` is unchanged.
- A non-`APIError` `AnthropicError` whose message starts with `Unable to parse tool parameter JSON from model` is the SDK's own malformed-input error (`BetaMessageStream.ts` `#toolInputParseError`, raised before the adapter sees the block stop). It becomes `ProviderOutputError` with a fixed message and no `cause`, because the SDK message quotes the raw model JSON. The SDK is pinned exactly at 1.13.0, so a Renovate bump that changes the text fails the malformed-JSON test.
- Every other error becomes `ProviderTransportError('Claude request failed')`, with no `cause`. This includes every `APIError`: HTTP status errors, connection errors and `APIUserAbortError`, which `runTurnLoop` still normalises to `signal.reason`.
  Acks are unchanged. Every `tool_use` in a replayed turn is acked. A cut call cannot precede a `fallback` block on a stream, because a decline while a tool-use block is open returns the refusal directly instead of falling back. An unfinished turn always rejects, so it is never replayed.
  Residual: the SDK's partial parser completes every proper prefix of a valid input. It throws only when the buffer holds no JSON token, which means whitespace only. If such a buffer is cut by a refusal, the result is `ProviderOutputError` instead of `ProviderRefusedError`, because the SDK error ends the stream before the stop reason. It is retried once, and the retry surfaces the refusal if the model declines again. 7.3 observes it.
  TECH §5.2 replaces the non-beta call. It names `client.beta.messages.stream()` with the `anthropic-beta: server-side-fallback-2026-07-01` header for `fallbacks: 'default'`. It describes the ack loop: the assistant content is replayed with strict-parsed inputs and the fallback replay rules, there is one `ok` `tool_result` per call, and an attempt has at most 4 turns. The loop stops at a natural end or when the assembler reports `complete`. The kept `fallbacks` line gains one clause: a decline while a tool-use block is open does not fall back and surfaces as a refusal. It gives the failure mapping above and states `maxRetries: 0`. The other §5.2 lines stay.
  Must preserve: every 3.3 behaviour and test outside the rows above, including the shared suite, the D4 body, the key header, telemetry off, the 529 single request, the fallback rules and the stream abort on the error path. Existing tests whose expectation changes are the 3.3 tests that asserted `ProviderTransportError` for malformed JSON, `refusal` or `max_tokens`. The PR lists each one.
  Evidence floor (Vitest, hand-authored Messages SSE over the injected `fetch`):
- `stop_reason: refusal` with no tool call gives `ProviderRefusedError` after exactly one request. The refusal fixtures use the vendor `stop_details` shape: `type: 'refusal'`, a `category` and an `explanation`, with the SDK's remaining `BetaRefusalStopDetails` fields set to `null`. There is no `as` cast.
- A refusal that cuts an open `tool_use` gives `ProviderRefusedError` and zero ops. This runs as `it.each` over two shapes: a truncated `partial_json` followed by `content_block_stop` and then `message_delta` `refusal`; and the same truncated block with no `content_block_stop` before the `refusal` delta. The vendor doc does not say whether a cut block is closed, and 7.3 records the live wire.
- A refusal after an op was yielded in the same turn gives `ProviderRefusedError` after that one op.
- `max_tokens` after one complete call and a truncated `partial_json` block with `content_block_stop` gives exactly one op, then `ProviderOutputError`, after one request.
- `max_tokens` after one complete call and a `tool_use` block with deltas but no `content_block_stop` gives one op, then `ProviderOutputError`.
- `max_tokens` with every input complete gives `natural`, one turn, and its ops yielded.
- A truncated `partial_json` block followed by a valid `tool_use` block gives `ProviderOutputError` with zero ops. The request signal is aborted, asserted over a held-open body (`{ open: [...] }`).
- Malformed non-truncated input JSON gives `ProviderOutputError`. Its message contains none of the raw JSON, it has no `cause`, and the request signal is aborted, asserted over a held-open body (`{ open: [...] }`, which extends the existing 3.3 test).
- A 500 whose body contains the key and a request id is requested exactly once. It gives `ProviderTransportError` with the fixed message. The body, key and request id are absent from the message, the stack and `cause`, and the console stays silent.
- `pause_turn`, `model_context_window_exceeded` and a missing stop reason still give `ProviderTransportError`.
- A body that closes after `message_start` and one complete call, with no `message_delta` or `message_stop`, gives one op, then `ProviderTransportError`. This is the SDK's non-`APIError` "stream ended" error, the negative row for the message-prefix check.
- Per-file coverage is at least 90%. `pnpm docs:check` passes.

## Issue #301 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded (agree: Critical Path `providers/`, two new runtime dependencies, billing and key handling)
Blast radius: the second real adapter, selected with `AI_PROVIDER=openai-compatible`. The risks are four:

- A wrong option multiplies spend, through SDK retries, a multi-step loop or extra turns.
- The SDK default `onError` prints `APICallError` objects to the console. Their `requestBodyValues` hold the topic and their `responseBody` may hold the key, so this is a leak.
- A missed `invalid` tool call applies nothing but hides a validation failure.
- A wrong history breaks every second turn.
  Selected risk packs:
- Public API: the `Provider` contract, via the shared suite.
- Auth/secrets: `OPENAI_API_KEY` goes only in `Authorization: Bearer`. No SDK error object reaches the console, a message or a `cause`.
- Config: `baseURL` is required, `maxRetries: 0`, `maxOutputTokens: 8000`, and the model object is never a string id, so the AI gateway is never used.
- Concurrency/ordering: `abortSignal` is `request.signal`.
- Resource limits: the turn loop from 1.3 and a single step per call.
- Error handling: `invalid` tool calls, `error` parts, finish reasons and mid-body failures.
- Release/dependency: `ai` 7.0.181 (2026-11-23) and `@ai-sdk/openai-compatible` 3.0.94 (2026-11-20). Both are exact pins, Apache-2.0, at least 3 days old, and share `@ai-sdk/provider` 4.0.39 and `@ai-sdk/provider-utils` 5.0.83. The new closure is:
  - `@ai-sdk/gateway` 4.0.154, which brings `@vercel/oidc` 3.2.0;
  - `@ai-sdk/provider-utils`, which brings `@workflow/serde`, `@standard-schema/spec` and `eventsource-parser`;
  - `@ai-sdk/provider`, which brings `json-schema` 0.4.0 `(AFL-2.1 OR BSD-3-Clause)`.
    `pnpm licenses:check` is the arbiter. `json-schema` gets the owner-approved exact exception of decision 0040, which the orchestrator added to this branch. The implementer adds the matching `constraints.yaml` exception entry. That is a Critical Path gate file, so the PR flags it and runs `pnpm test:guardrails`.
- Docs: TECH §5.1 and §5.3.
  Not selected: Schema (1.2 owns the tool definition), File IO, Legacy.
  Interface: `src/contexts/ai/infrastructure/providers/openai-compatible.ts` exports `createOpenAICompatibleProvider({ apiKey, model, baseURL, idFactory, fetch? })`, where `baseURL` is required (D7). It builds one provider with `createOpenAICompatible({ name: 'openai-compatible', baseURL, apiKey, fetch })` and one chat model with `.chatModel(model)`. It never passes a string model id, because a string resolves to the AI gateway. Its `runTurn` makes one `streamText` call per turn with these options:
- `model`;
- `instructions: GENERATE_SYSTEM_PROMPT` (`system` is deprecated in v7);
- `messages`, which holds the history and starts from `[{ role: 'user', content: topic }]`;
- `tools: { [GENERATE_TOOL_NAME]: { description, inputSchema: jsonSchema(schema) } }`, with no `execute`, no `validate` and no `strict`. The 1.1 assembler validates. `schema` spreads the top level and copies the two readonly `required` arrays, the top-level one and the one in `children.items`. That is D6's "copy a readonly array where needed", and every other part is referenced unchanged.
- `maxOutputTokens: 8000`, `maxRetries: 0` and `abortSignal: request.signal`;
- `onError` set to a no-op. This replaces the default `console.error`, and the adapter reads errors from the stream.
- `telemetry: { isEnabled: false }`. `experimental_telemetry` is deprecated in v7, and `false` returns an empty dispatcher, which also turns off the tracing channel.
- no `stopWhen`, because the default is a single step.
  Stream reading, from `result.fullStream`. The adapter buffers the turn's parts and gives one verdict at the turn end. The SDK emits every tool call in the provider's `flush`, immediately before `finish`, so buffering adds no latency.
- A `tool-call` part is buffered. Its `input` is already parsed, and `invalid: true` marks unparseable or truncated JSON or an unknown tool name. An empty-string `arguments` value arrives as a valid call with `input: {}`, and the assembler rejects it.
- A `tool-error` part is ignored. It always follows an invalid call.
- An `error` or `abort` part, or a throw from iteration such as a mid-body read failure, is recorded as a transport failure.
- The verdict at the end of the stream, in order:
  1. A transport failure gives `ProviderTransportError`, and so does a missing `finish` part or a `finishReason` of `error`, `interrupted` or `other`. `runTurnLoop` normalises an abort to `signal.reason`. A failed turn yields no op, so D5 can still retry before the first op. This differs on purpose from the Claude adapter, which yields each input at its block stop.
  2. A `finish` part with `finishReason` `content-filter` gives `ProviderRefusedError`, even when a call is invalid. The SDK maps `stop` with a refusal delta to `content-filter`.
  3. Any invalid call gives `ProviderOutputError`.
  4. Otherwise the buffered inputs are yielded in order as `tool-input` items, and the turn end follows the mapping below.
- Every error message is fixed and has no `cause`.
  Turn-end mapping (D3):
- `stop` gives natural. The SDK maps `stop` with a refusal delta to `content-filter`.
- `length` gives natural, because an invalid call has already decided the turn, so every input is complete.
- `tool-calls` gives tool-use.
- `content-filter` gives `ProviderRefusedError`.
- `error`, `interrupted`, `other` and a missing finish part are decided in step 1 above. The provider maps a stream with no `finish_reason` to `error`.
  History and acks: after a tool-use turn, the adapter appends `(await result.response).messages`. That is the SDK's assistant message, which keeps any reasoning parts and so preserves `reasoning_content` for DeepSeek thinking mode. It then appends one `{ role: 'tool', content: [...] }` message with `{ type: 'tool-result', toolCallId, toolName, output: { type: 'text', value: 'ok' } }` per yielded call, in order. The SDK adds no tool message of its own for valid calls without `execute`. An invalid call always rejects the turn, so the SDK's `error-text` results are never replayed.
  Residual: the SDK emits tool calls only at stream end (`streaming-tool-call-tracker.ts` deliberately finalises nothing early), so ops do not appear progressively within one turn, against the PRD §4 principle "流式呈现，节点逐个出现". The first node is visible after turn 1's stream closes. The 7.3 live run measures first-node latency on this endpoint, and the owner already has the 12.7 s total probe (design Context).
  Contract: `describeProviderContract('openai-compatible', …)` runs every scenario, including `natural`. The harness encodes the canonical inputs as hand-authored chat-completions SSE over the injected `fetch`:
- `data:` chunks carry `choices[0].delta.tool_calls` with `index`, `id`, `function.name` and `arguments` fragments.
- `finish_reason` is `tool_calls` or `stop`.
- The stream ends with `data: [DONE]`.
- The harness counts `fetch` calls as turns.
- For `stalled`, it returns a body that settles only when the request's own `init.signal` aborts.
  TECH §5.1 and §5.3 describe the shipped protocol: flat per-parent `add_children` calls, the temporary-id remap, and the ack loop that stops at a natural end or at `complete`, with at most 4 turns. §5.1's `AIProvider` sketch becomes the shipped `Provider.streamOps(request)` port. `listModels`, capability flags, the JSON-mode channel and the router are deferred to M3.5. Ollama stays a later option. §5.2 is unchanged.
  Must preserve: 1.1–1.3, the mock, the Claude adapter and the shared suite. The suite gains nothing. The new dependencies and the closure listed above are the only lockfile change. The diff likely exceeds 400 lines excluding the lockfile, so the PR carries `diff-limit-exempt` with a justification: one adapter, its fixture tests and the docs, with no split value.
  Evidence floor (Vitest over the injected `fetch`, no real key):
- The shared suite passes, including `natural`.
- ai-provider "Two-turn skeleton" and "Turn limit" pass.
- The turn-1 body asserts:
  - `model`;
  - `messages` equal to `[{ role: 'system', content: GENERATE_SYSTEM_PROMPT }, { role: 'user', content: topic }]`, so the topic appears only in the user message;
  - `tools` equal to `[{ type: 'function', function: { name, description, parameters } }]`, with `parameters` deep-equal to `GENERATE_TOOL_DEFINITION.inputSchema` and no `strict` key;
  - `tool_choice: 'auto'`, `max_tokens: 8000`, `stream: true`, and no `stream_options`. The whole body is asserted with `toStrictEqual`.
- The URL is `<baseURL>/chat/completions`. The key appears only in `Authorization: Bearer`.
- The turn-2 body ends with the assistant message, carrying `tool_calls` with JSON-string `arguments`, then one `role: 'tool'` message with `content: 'ok'` per `tool_call_id`.
- A truncated `arguments` string at `finish_reason: length` gives `ProviderOutputError` and zero ops.
- Malformed `arguments` at `tool_calls` gives `ProviderOutputError`.
- `finish_reason: content_filter` gives `ProviderRefusedError`.
- A stream without `finish_reason` and an unknown finish reason each give `ProviderTransportError` and zero ops.
- Buffering rows. Each begins with one complete valid `add_children(root)` call, then:
  - a truncated call at `length` gives `ProviderOutputError` and 0 ops;
  - `content_filter` gives `ProviderRefusedError` and 0 ops;
  - no `finish_reason` gives `ProviderTransportError` and 0 ops;
  - an unknown `finish_reason` gives `ProviderTransportError` and 0 ops.
    Each of these fails against an adapter that yields while reading.
- `length` with complete inputs gives natural, 1 turn.
- A 500 whose body contains the key and a request id is requested exactly once. It gives `ProviderTransportError` with a fixed message, and the body, key, request id and topic are absent from the message, the stack, the `cause` and the console. A console spy covers `error`, `warn` and `log`.
- `content_filter` after a truncated `arguments` string (`{"parentId":"root","chil`) gives `ProviderRefusedError`, zero ops and one request.
- `finish_reason: stop` with a `delta.refusal` gives `ProviderRefusedError`.
- A truncated `arguments` string with no `finish_reason` gives `ProviderTransportError`.
- A body that errors after one complete call and before `[DONE]` gives `ProviderTransportError` with a fixed message, no `cause` and zero ops.
- No call reaches the gateway: `globalThis.fetch` is stubbed to throw during the tests and is called 0 times, and the injected `fetch` is called once per turn.
- `pnpm licenses:check`, `pnpm install --frozen-lockfile`, `pnpm dead-code`, `pnpm boundaries`, `pnpm docs:check`, `pnpm decisions:check` and `pnpm test:guardrails` pass, and coverage is at least 90%.

## Issue #298 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree: `loadEnv` runs on every account request (`src/app/server/account-services.ts:30, :126`), so a wrong rule breaks sign-in for everyone or silently leaves AI misconfigured.
Blast radius: production configuration. The schema has four failure modes:

- It rejects a valid environment, so every account request throws.
- It accepts a partial one, which shows up later as a 503 or a provider 401.
- It echoes a key value in its load error.
- It makes `.env.example` fail to load, so every account request fails after the documented `cp .env.example .env`.
  Selected risk packs:
- Config: the fields, empty-means-unset preprocessing and the cross-field rules.
- Auth/secrets: errors name variables, never values; `.env.example` holds no key value.
- Docs: the `.env.example` AI block.
  Not selected: Public API, Schema, File IO, Concurrency, Resource limits, Legacy, Release.
  Interface: `src/shared/env.ts`.
- `envSchema` gains `AI_PROVIDER` (`z.enum(['anthropic', 'openai-compatible', 'mock'])`), `AI_MODEL`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (non-empty strings), and `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` (`z.url({ protocol: /^https?$/ })`, fail-loud like `DATABASE_URL`; the protocol check also rejects the `localhost:11434/v1` typo). All are optional. Base URLs are format-checked even when their provider is not selected.
- Each AI field is wrapped in one shared preprocess that turns `''` into `undefined`. It is written once and applied to all six fields.
- A `superRefine` adds one custom issue for each variable the selected provider requires and lacks. `path` is the variable name and the message is fixed, for example `required when AI_PROVIDER=openai-compatible`. The thrown error therefore names every missing variable together. The exception is when another field fails its own enum check (`NODE_ENV`, `LOG_LEVEL`): Zod v4 then skips the refinement, the error names that field, and it still throws.
- `mock` with `NODE_ENV=production` adds an issue on `AI_PROVIDER`.
- `loadEnv`'s error format stays `path: message`. No message contains an input value: Zod's enum and URL messages do not echo the input, and the custom messages are fixed. `Env` stays the inferred type.
- Narrowing to a discriminated provider config is task 4.1 and stays out of scope.
  `.env.example`, AI block only:
- `AI_PROVIDER=`, `AI_MODEL=`, `ANTHROPIC_API_KEY=`, `ANTHROPIC_BASE_URL=`, `OPENAI_API_KEY=` and `OPENAI_BASE_URL=` are all empty. The current `OPENAI_BASE_URL=https://api.openai.com/v1` value moves into a comment.
- The header `# 内置提供方（至少配一个）` is replaced, because AI is optional.
- Comments give the platform default (`AI_PROVIDER=anthropic`, `ANTHROPIC_BASE_URL=https://www.dmxapi.cn`, `AI_MODEL=deepseek-v4.1-flash-1017`) and the OpenAI-compatible alternative (`AI_PROVIDER=openai-compatible`, `OPENAI_BASE_URL=…`, the same `AI_MODEL`).
- A comment notes that `AI_PROVIDER=mock` is for local verification only and is refused in production.
- `OLLAMA_BASE_URL` is dropped. Every other line stays, including `PROVIDER_KEY_ENCRYPTION_SECRET`, which belongs to M3.5.
- Agents read only `.env.example`, never `.env`.
  Out of scope: provider construction from env (4.1), with the #302 handoff "reject or document `ANTHROPIC_CUSTOM_HEADERS`" kept for 4.1; and forcing the mock on verification servers (4.2).
  Must preserve: the existing env tests and fields, and `account-services.ts` callers unchanged. The PR Risk section states that an owner `.env` with a partial AI setup now turns account routes into load errors, and that base URLs are checked even when their provider is unselected.
  Evidence floor (Vitest, `src/shared/env.test.ts`):
- "AI not configured": `{}`, `{ AI_PROVIDER: '' }` and every AI field set to `''` load, with `AI_PROVIDER` undefined.
- "Example environment loads": the real `.env.example`, parsed with Node's `util.parseEnv`, loads with AI unconfigured. The parsed object has all six AI keys present and equal to `''`, and has no `OLLAMA_BASE_URL`. The same parsed copy with `AI_PROVIDER=anthropic` throws `/ANTHROPIC_API_KEY/`; this is committed as an assertion. The row fails against the current file and passes after the rewrite.
- "Partially configured provider fails at load", for `openai-compatible`:
  - each of `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `AI_MODEL`, missing and then `''`, throws an error naming that variable (`it.each`);
  - all three missing names all three.
- For `anthropic`, missing `ANTHROPIC_API_KEY` or `AI_MODEL` throws naming it.
- A full `openai-compatible` configuration (key, base URL, model) loads. `OPENAI_API_KEY` and `OPENAI_BASE_URL` survive into the output, and no Anthropic variable is required.
- A legacy `.env`, given as the current `.env.example` contents written as a literal (`OPENAI_BASE_URL=https://api.openai.com/v1`, `OLLAMA_BASE_URL=…`, no `AI_PROVIDER`), loads with `AI_PROVIDER` undefined.
- `OPENAI_BASE_URL=localhost:11434/v1` throws naming `OPENAI_BASE_URL`.
- "Claude provider configuration": `anthropic` with a key and a model loads. `ANTHROPIC_BASE_URL` is undefined when unset or `''`, and kept when set.
- "Mock refused in production": `mock` and `production` throws naming `AI_PROVIDER`. `mock` and `development` loads.
- No echo: an invalid `AI_PROVIDER` value and an invalid base URL throw messages that contain neither input. A missing-model error contains no key value present in the input.
- The existing three tests pass. Coverage of `env.ts` is at least 90%. `pnpm typecheck` and `pnpm lint` pass.

## Issue #299 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree: the retry and timeout rules are billing guards, because a wrong retry doubles spend and a missing timeout keeps billing.
Blast radius: every generation. The possible failures:

- a refusal or a post-op failure retried, which is a second billed request with partial ops duplicated;
- a client abort retried or reported as an error;
- a timeout that does not abort the provider;
- a leaked timer or listener;
- a log entry carrying the topic, a key or a provider body.
  Selected risk packs:
- Error handling: the retry rule, terminal codes and fixed messages.
- Concurrency/ordering: one linked `AbortController`, the timer, consumer `return()`.
- Resource limits: the 30 s total limit spans both attempts, and the timer and listener are released on every exit.
- Auth/secrets: the log and errors carry no topic, body or key.
  Not selected: Public API (the HTTP shape is 4.3), Schema, Config, File IO, Legacy, Release, Docs (TECH lands with 4.x).
  Interface: `src/contexts/ai/application/generate.ts` exports `generate(provider, request, options)` and `GenerationError`.
- `options` is `{ providerId: string; model: string; log: GenerationLog; timeoutMs?: number }`, with `timeoutMs` defaulting to `30_000`. These are D5's `{ timeoutMs }` plus the logging identity. The `Provider` port has no id or model, and 4.1 composition knows both from env.
- `GenerationLog` is `{ info(fields: object): void }`. That is structurally the shared pino logger, and it follows the repo's `logger.error({ event })` convention with no message string. The application layer stays framework-free, and 4.1 passes `logger`.
- `generate` returns `AsyncGenerator<TreeOp, void>`. It yields every op of the attempt that counts. It returns normally on success and on client abort. It throws `GenerationError` on every other terminal failure.
- `GenerationError` has `code: ProviderErrorCode`, imported from `domain/errors.ts`, and one fixed English message per code: `The generation exceeded its time limit`, `The AI provider request failed`, `The AI provider returned unusable output`, `The AI provider refused the topic`. It has no `cause`.
  Rules (D5):
- Port precondition: every provider rejects promptly after its signal aborts. The D3 turn loop guarantees this, and the shared contract suite proves it. `generate` does not race the timer itself.
- If `request.signal` is already aborted at the call, `generate` returns silently without calling `streamOps` and logs `attempts: 0` with `outcome: 'aborted'`. An abort listener added to an already-aborted signal never fires.
- One `AbortController` per generation. Its signal is passed to every attempt as `GenerateRequest.signal`. It is aborted by `request.signal`, through a listener removed on exit, and by a `timeoutMs` timer started once and cleared on exit. The time limit therefore spans both attempts.
- An attempt is one `provider.streamOps({ ...request, signal })` iteration. Ops are yielded as they arrive and counted per attempt.
- When an attempt throws, classification runs in order:
  1. The caller aborted, so the generation returns silently with no retry.
  2. The timer fired, which gives `timeout`.
  3. A `ProviderTransportError` or `ProviderOutputError` with zero ops yielded in this attempt, and this is the first attempt: exactly one fresh attempt runs.
  4. Otherwise the error's code is used: `ProviderTransportError` gives `provider-error`, `ProviderOutputError` gives `invalid-output`, and `ProviderRefusedError` gives `refused`.
  5. An unknown error gives `provider-error` with no retry.
- `generate` never detects zero ops itself. A zero-op natural end arrives as the turn loop's `ProviderOutputError` and follows rule 3.
- When the consumer stops early (`return()` from 4.3 on disconnect), the `finally` aborts the controller, which cancels the provider, and logs outcome `aborted`.
  Logging: exactly one `log.info({ event: 'ai.generate', provider, model, attempts, ops, durationMs, outcome })` on every exit.
- `outcome` is `done`, `aborted`, or the terminal code.
- `durationMs` comes from `Date.now()`.
- No field contains the topic, a provider error message, a body or a key.
  Caller contract (4.3): a normal return while `request.signal.aborted` is a client abort, and the caller writes nothing after it. Any other normal return is success, and the caller writes `done`.
  Must preserve: the port, the turn loop, the adapters and `domain/errors.ts`, all unchanged.
  Evidence floor (Vitest, fake providers that are async generators honouring their signal, fake timers, spy `log`):
- "Retry succeeds" emits the second attempt's ops, with `attempts` 2 and `outcome` `done`.
- "Retry exhausted": two `ProviderOutputError`s before any op give `invalid-output` after exactly two `streamOps` calls. The same holds for two `ProviderTransportError`s, which give `provider-error`.
- "Failure after first op", as `it.each` over two cases: a `ProviderTransportError` after two ops gives `provider-error`, and a `ProviderOutputError` after one op gives `invalid-output`. In both cases the ops stand and `streamOps` was called once.
- "Refusal" before any op gives `refused` after one call.
- "No tool call is invalid output": a provider that throws the turn loop's zero-op `ProviderOutputError` is retried once, and the second attempt's ops are emitted.
- "Slow provider" runs on fake timers with no `timeoutMs`, so the default applies. The provider waits on its signal:
  - at 29 999 ms the signal is not aborted;
  - at 30 000 ms the signal is aborted and the result is `timeout`, with no retry and `durationMs` 30 000.
- The time limit spans both attempts. Attempt 1 waits 20 s on a fake timer, then throws `ProviderTransportError` with zero ops. Attempt 2 waits on its signal:
  - at a total of 29 999 ms the signal is not aborted;
  - at 30 000 ms the result is `timeout`, with `attempts` 2 and `durationMs` 30 000.
- A `request.signal` already aborted at the call means `streamOps` is called 0 times. Nothing is yielded, nothing is thrown, and the log has `attempts` 0 and `outcome` `aborted`.
- A client abort ends silently. The fake provider throws a `ProviderTransportError` once aborted, which proves rule 1 runs before rule 3:
  - before any op, with no retry and `outcome` `aborted`;
  - after one op, with the op kept.
- Early `return()` by the consumer aborts the provider's signal.
- After every scenario, `vi.getTimerCount()` is 0 and `getEventListeners(request.signal, 'abort')` from `node:events` has length 0.
- After every scenario, `log.info` was called exactly once. Its fields `{ provider, model, attempts, ops, outcome }` match a per-scenario table that covers `done`, `aborted` (including consumer `return()`), `timeout`, `refused`, `invalid-output` and `provider-error`.
- "Provider HTTP error body withheld", logging half. A fake provider throws `ProviderTransportError` on both attempts, with a message that contains a key, a body and the topic. The thrown error has `code` `provider-error`, the exact fixed message, and `cause === undefined`. Neither `util.inspect(error, { depth: null })` nor `JSON.stringify(log.info.mock.calls)` contains any of the three strings. The log entry has exactly the seven fields.
- An unknown error (`TypeError`) gives `provider-error` with no retry.
- Per-file coverage is at least 90%. `pnpm boundaries` and `pnpm lint` pass, with complexity at most 10.

## Issue #304 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree: `src/app/server/` is a Critical Path, and this module decides which vendor, key and gateway every generation bills.
Blast radius: every generation once 4.3 lands. A wrong mapping sends:

- the wrong key to a gateway;
- a request with no base URL to a vendor's default host;
- an unpaced mock that defeats the progressive-appearance e2e;
- an unredacted logger.
  Selected risk packs:
- Config: env to adapter mapping, unset provider, caching.
- Auth/secrets: a key reaches only its own adapter, is never logged or echoed, and no real key, including one from the host shell, reaches a test.
  Not selected:
- Public API (the route is 4.3)
- Schema (env validation is 2.1)
- Concurrency
- File IO
- Legacy
- Release
- Docs (TECH §7 lands with 4.3)
  Interface: new `src/app/server/ai-services.ts` exports three things:
- `createAiService(env: Env): AiService | undefined` is the pure mapping.
- `aiService(): AiService | undefined` reads `loadEnv(process.env)` on first use.
  - It caches a defined service and an `undefined` result.
  - It never caches a throw, the same as `accountResources()`, so a fixed env succeeds on the next call.
- `AiService` is `{ provider: Provider; providerId: NonNullable<Env['AI_PROVIDER']>; model: string; log: GenerationLog }`.
  - `providerId`, `model` and `log` are exactly what `generate` takes (#299).
  - `log` is the shared `logger` from `src/shared/logger.ts`, so redaction stays in force. This discharges the #299 handoff "4.1 passes `logger`".
    Mapping (D1, D7, D11):
- `anthropic` calls `createAnthropicProvider({ apiKey: ANTHROPIC_API_KEY, model: AI_MODEL, idFactory })`, plus `baseURL: ANTHROPIC_BASE_URL` only when it is set. It is a conditional spread under `exactOptionalPropertyTypes`, so an unset value means the SDK default host.
- `openai-compatible` calls `createOpenAICompatibleProvider({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL, model: AI_MODEL, idFactory })`.
- `mock` calls `createMockProvider({ idFactory, delayMs: 150 })` with no `script`. `model` is the constant `'mock'`, because no vendor model is called. Verification servers force the mock even when the owner's `.env` sets `AI_MODEL`.
- An unset `AI_PROVIDER` returns `undefined`.
- `idFactory` is `() => nanoid()`, the editor's node-id generator.
- A key goes only to its own vendor's adapter. No variable is read from `process.env` except through `loadEnv`.
- `loadEnv` already guarantees the selected provider's required fields, but the `Env` type still marks them optional.
  - One helper, `required(value, name)`, narrows them. It throws a fixed `Error` that names the variable, never its value.
  - It is reached only by a hand-built `Env` in tests. No non-null assertions.
  - This discharges the #298 handoff that narrowing is task 4.1.
    Not in this slice (recorded):
- `ANTHROPIC_CUSTOM_HEADERS`: already documented in the adapter comment (anthropic.ts, #302). No change here.
- Whitespace-only AI values (#298 residual): trimming changes D7.
- A dependency-cruiser rule enforcing D1's "nothing else imports adapters": not in this issue. Today no non-test module imports an adapter. 4.3's review checks it as a review-only line, and the stage-end report proposes a follow-up issue for the rule.
  Must preserve: `account-services.ts` and its tests, the adapters, `env.ts`, `generate.ts`.
  Evidence floor (Vitest):
- Test setup:
  - The Claude and OpenAI-compatible factories are mocked with `vi.mock` as collaborators, never the SUT.
  - `providers/mock` is mocked as a passthrough spy (`vi.fn(actual.createMockProvider)` via `importOriginal`), so the mapping rows and the real pacing row share one file.
  - Sentinel strings only.
- Isolation:
  - `beforeEach` calls `vi.resetModules()` and stubs all six AI variables and `NODE_ENV` with `vi.stubEnv`; empty means unset.
  - `afterEach` calls `vi.unstubAllEnvs()`.
  - The suite passes with `ANTHROPIC_API_KEY`, `AI_PROVIDER` and `AI_MODEL` exported in the shell that runs it.
- `anthropic` with a base URL:
  - The Claude factory is called once, with exactly the key, the model, the base URL and a function `idFactory`.
  - The other factories are not called.
  - The result holds `providerId` `anthropic`, the model and `log === logger`.
- `anthropic` without a base URL: the arguments have no `baseURL` key.
- `openai-compatible`: the factory receives exactly its key, base URL, model and `idFactory`. The Claude key is never passed, even when it is present in the env.
- `mock`: the arguments are exactly `{ idFactory, delayMs: 150 }`. `model` is `'mock'` even when `AI_MODEL` is set.
- Unset: the result is `undefined`, and no factory is called.
- `idFactory` returns distinct non-empty strings across calls.
- A hand-built `Env` with `AI_PROVIDER: 'anthropic'` and no key throws an error that names `ANTHROPIC_API_KEY` and contains no other env value. The same holds for `openai-compatible` without a base URL.
- `aiService()`:
  - `AI_PROVIDER=mock` returns a mock service. A second call returns the same object, and no factory is called again.
  - Unset, the first call returns `undefined`. After `vi.stubEnv('AI_PROVIDER', 'mock')` with no module reset, the second call is still `undefined` and no factory is called.
  - An invalid env (`AI_PROVIDER=anthropic` with no key) throws the `loadEnv` error. After the key is stubbed, the next call without a module reset returns a service.
- Real pacing:
  - Run through `createAiService` on fake timers, draining `streamOps` of the real mock.
  - At 149 ms no op has settled, and at 150 ms the first op is present.
- Per-file coverage is at least 90%. `pnpm boundaries`, `lint` and `typecheck` pass.

## Issue #306 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree: `scripts/test-guardrails.sh` is a Critical Path (gate integrity), and the export is the only thing standing between `pnpm smoke` (local and CI layer3) and the owner's real key.
Blast radius: every `pnpm dev:bg` run, which covers `pnpm smoke`, the Verification Matrix and CI layer3. A missing or misplaced export makes smoke bill the provider that `.env` configures. A fixture that does not bite would keep passing after the export is removed.
Selected risk packs:

- Config: process env overrides `.env`, as listed in Next's "Environment Variable Load Order" (`process.env` first).
- Auth/secrets: no real provider is reachable from verification.
- Resource limits: the fixture's stub processes are reaped, and no stray process outlives the run.
  Not selected:
- Public API
- Schema
- Concurrency
- File IO beyond the fixture's temp directory
- Legacy
- Release
- Docs: there is no AGENTS edit. Task 7.2 owns that.
  Interface:
- `scripts/dev-bg.sh` gains `export AI_PROVIDER=mock` before `pnpm dev`. Its comment cites decision 0039 and D7: process env wins over `.env`, so the verification server never calls a real provider.
- Nothing else in the script changes. The owner's foreground `pnpm dev` and `package.json` are untouched.
- Other AI variables from `.env` still load and are still validated (D7). A malformed value fails loud at load and never reaches a provider; forcing the mock only drops the required-field checks.
  Guardrail fixture: new section 9b in `scripts/test-guardrails.sh`, before section 10, using the same harness.
- Stubs go in `$tmp/bin`, written with quoted heredocs so `${AI_PROVIDER-<unset>}` expands at run time:
  - `pnpm` writes `${AI_PROVIDER-<unset>}` plus a newline to a file under `$tmp` and exits 0.
  - `curl` exits 0.
- Each case runs in its own fresh directory under `$tmp`, through `in_dir`, so `.run/` never lands in the worktree. The call is `env PATH="$tmp/bin:$PATH" … bash "$repo_root/scripts/dev-bg.sh"`, which uses the repo root's script, as sections 2a, 7, 9 and 9a do.
- Case 1, override: the caller has `AI_PROVIDER=anthropic`.
- Case 2, the spec's WHEN: `env -u AI_PROVIDER`, with a `.env` in the case directory setting `AI_PROVIDER=anthropic`. This proves that `export`, and not merely an assignment, reaches the child.
- Asserts in each case:
  - `dev-bg.sh` exits 0.
  - The fixture polls up to 5 s until the record file is non-empty (`-s`), because `pnpm` starts in the background.
  - The recorded value is exactly `mock`.
  - A record file that is missing or empty is a FAIL, not a skip.
- Cleanup: the stub exits on its own. Section 10's stray sweep, which matches the `$tmp` path, proves that nothing outlives the run.
  Pre-existing, not in this slice: dev-bg reports ready whenever anything answers `:3000`, including an owner's foreground real-provider `pnpm dev`. It also reuses a live pidfile server. This is filed as a follow-up, and 4.3 must resolve it before smoke gains generation entries.
  Must preserve: every existing guardrail section and its count of passes, and `scripts/dev-stop.sh`.
  Evidence floor:
- `pnpm test:guardrails` exits 0, with both new PASS lines and `0 failed`.
- Mutation A: with the whole export line removed, case 1 FAILs naming `anthropic` and case 2 FAILs naming `<unset>`.
- Mutation B: with only the `export` keyword removed, leaving `AI_PROVIDER=mock`, case 2 FAILs naming `<unset>`.
- After either mutation `pnpm test:guardrails` exits non-zero, and the script is then restored.
- `bash -n` and `shellcheck` (if installed) pass on both scripts.
- `pnpm dev:bg`, `pnpm dev:status` and `pnpm dev:stop` still work. The health probe returns HTTP 200 with `$.status == "ok"`.

## Issue #305 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree: `src/app/api/` and `constraints.yaml` are Critical Paths, and this is the first public streaming route, with auth, abort and billing exposure.
Blast radius: every generation. The failure modes are:

- a provider call before auth or validation, which bills an anonymous or malformed request;
- a missed disconnect, which keeps billing after the user left;
- a `done` after an abort, which makes the editor treat a partial result as complete;
- a leaked provider message, key or topic in a frame or a log;
- a contract drift, which the editor (5.1) and smoke would only discover later.

Governing invariant:

- No provider call happens before the 415, 401, 400 and 503 checks have all passed.
- A stream that is not aborted ends with exactly one terminal frame.
- A client abort ends the stream with no terminal frame and no write after the abort.
- No frame and no log line carries a provider message, a key or the topic.

Selected risk packs:

- Public API: status codes, JSON error codes, SSE frames, OpenAPI and its snapshot.
- Auth/secrets: session and binding before the body is read, and no provider text in frames or logs.
- Concurrency/abort: client disconnect through `request.signal`, and no write after an abort.
- Config: the `aiService()` failure modes (`undefined` gives 503, a throw gives 500).
- Docs: TECH §7 and §8.
- Error handling / partial outputs:
  - error-after-2 keeps its 2 op frames and then sends one `error` frame;
  - the 500 paths;
  - a non-`GenerationError` is rethrown, never mapped.
- Resource limits / large input: `topic` is at most 200 code units. The body byte cap is deferred (see Not in this slice).
  Not selected:
- Schema: no storage and no migration.
- File IO: the route touches no file.
- Legacy: a new route, with no prior behaviour to keep.
- Release: no flag, and no deploy target yet.
  Interface: new `src/app/api/ai/generate/route.ts` exports only `POST(request: Request): Promise<Response>`.
  Checks run in this order, and each one returns before the next starts:

1. `requireJson(request)` gives 415 `unsupported-media-type`. `requireUser` is not called.
2. `requireUser(request)` passes through its 401 Response unchanged. The body is not read.
3. `request.json()` is parsed with a strict Zod object `{ topic, rootId }`.
   - `topic` is a string whose `length` is at most 200 and that is not blank after `trim()`, as one `refine`. Shipped deviation: zod 4's `max` counts code points past the limit (`node_modules/zod/v4/core/checks.js:271-274`), so 101 `'𐀀'` (202 code units) passed `max(200)`; `length` counts UTF-16 code units, as `auth.ts:53` does.
   - `rootId` is `z.string().min(1)`.
   - Invalid JSON, a non-object body, a missing or extra field, or a wrong type gives 400 `{"error":"invalid-input"}`.
   - The raw `topic` goes to `generate` unchanged. The editor trims it (topic-generation spec).
4. `aiService()`:
   - It returns `undefined` when no provider is configured, giving 503 `{"error":"ai-unavailable"}`.
   - It throws on an invalid env, which is the #304 handoff.
5. A throw from `requireUser` or `aiService()` gives 500 `{"error":"internal"}` and one `logger.error({ event: 'ai.generate.failed' })`. The error object and its message are never logged or returned. This matches the house pattern of `src/app/api/maps/route.ts`.

Success returns `new Response(stream, { headers })` with `content-type: text/event-stream` and `cache-control: no-store`. The status is 200.

- Frames are `event: <name>\ndata: <JSON.stringify(data)>\n\n`, where name is `op`, `error` or `done`.
- The stream is a `ReadableStream<Uint8Array>` whose `start(controller)` iterates `generate(service.provider, { topic, rootId, signal: request.signal }, { providerId, model, log })`. This follows the #299 handoff: the timer starts at the first `next()`, so iteration starts at once and not on the first pull.
  - Each op is written as an `op` frame.
  - On a normal return:
    - if `request.signal.aborted`, no terminal frame is written and the stream closes;
    - otherwise one `done` frame with `{}` is written and the stream closes.
  - On a `GenerationError`, one `error` frame with `{ code: error.code, message: error.message }` is written and the stream closes. `generate` throws nothing else (the #299 contract), so the route catches only `GenerationError` and rethrows anything else. It never swallows an error.
  - Write mechanism (one rule, no guarded catch):
    - The underlying source's `cancel()` only sets a local `cancelled = true`. It does not call `iterator.return()`.
    - Every `enqueue` and the final `close` go through one helper that does nothing once `cancelled` is true. On a cancelled stream both `enqueue` and `close` throw `TypeError`.
    - When Next cancels the response on disconnect, the flag stops every write. When nobody cancelled, for example in a unit test that aborts only the request signal, the stream still closes, so `read()` returns `done: true`.
- Disconnect relies on `request.signal` alone. Next 16 aborts it when the response closes (`signalFromNodeResponse`, `next/dist/server/web/spec-extension/adapters/next-request.js:56`). No `cancel()` → `iterator.return()` path is used, because `return()` queues behind an in-flight `next()` (the #299 handoff).
- The handler imports only `account-services` (`requireJson`, `requireUser`), `ai-services` (`aiService`), `generate`/`GenerationError` from `ai/application/generate`, `zod` and `logger`. It imports no adapter and no map store. Review-only check (the #304 handoff): no non-test module other than `ai-services.ts` imports `contexts/ai/infrastructure/providers/*`.

Contract surfaces:

- `schemas/openapi.yaml` gains `/api/ai/generate` `post`:
  - the `SessionBinding` parameter;
  - a request body `GenerateRequest` (`additionalProperties: false`, `topic` with `maxLength: 200`, `rootId` with `minLength: 1`);
  - a 200 `text/event-stream` response whose description names the three frames;
  - components `GenerateRequest`, `NewNode`, `GenerateOp`, `GenerateError` and `GenerateDone` (shipped: `NewNode` names the recursive child node, because `MindNode` requires `children` and allows `position`; JSON Schema `maxLength` counts code points, so the description states the code-unit limit the route enforces):
    - `GenerateOp` is the `add_children` TreeOp, the only op `generate` emits. It mirrors `addChildrenOp` and `newNodeSchema` in `src/contexts/map/domain/tree-op.ts`.
    - `GenerateError` has a `code` enum of the four terminal codes and a `message`.
    - `GenerateDone` is an empty object with `additionalProperties: false`.
  - JSON error responses for 400, 401, 415, 500 and 503 with `Error` examples.
  - `schemas/snapshots/openapi.yaml.snapshot` is the same bytes, reviewed hunk by hunk.
- `smoke/api.hurl` gains a section at the end of the file, where the second smoke user is signed in.
  - 401: a valid body with `x-mindsprout-session-binding: not-this-user` gives `body == "{\"error\":\"unauthenticated\"}"`. A signed-out request cannot be sent, because the cookie jar already holds a session; the signed-out case is unit-covered.
  - 400: `{"topic":"   ","rootId":"root"}` gives `{"error":"invalid-input"}`.
  - 200 with topic `smoke generate`:
    - `Content-Type` is exactly `text/event-stream`, and `Cache-Control` is `no-store`;
    - `body matches /^(event: op\ndata: \{[^\n]*\}\n\n){5}event: done\ndata: \{\}\n\n$/`. It must be a Hurl regex literal, because a quoted string fails `hurlfmt` at `\{`. It must also parse under CI's hurl 7.0.0;
    - the body contains `要点 4.3`, the mock skeleton's last node.
- `constraints.yaml`: `/api/ai/generate` becomes `covered by smoke/api.hurl`. `/api/ai/grow` stays pending.
- TECH:
  - §7 gains the line `api/ai/generate/  主题生成（SSE 流式 TreeOp）`. The `server/` line also names the AI service composition.
  - §8 says that generation requires a session and its binding, that the body is validated by Zod (topic ≤ 200), that a disconnect aborts the provider call, and that frames carry fixed messages only.
  - The quota and 429 bullet stays as the M4 plan.

Not in this slice (recorded):

- Request-body byte cap: `request.json()` reads the whole body, the same as the auth routes' `readCredentials`. A cap like `readMapBody` is a follow-up.
- Rate limit, quota and 429: M4.
- A binding-mismatch or empty-binding check with the real `requireUser`: `src/app/server/account-services.test.ts:101` owns those semantics. The route tests prove delegation and short-circuit, which is the M2 route precedent (`src/app/api/maps/route.test.ts`).
- A dependency-cruiser rule for D1: a follow-up proposed at stage end.

Must preserve:

- `account-services.ts`, `ai-services.ts`, `generate.ts`, the adapters and every existing route;
- the existing smoke entries and their order;
- the other OpenAPI paths, byte for byte.

Sibling surfaces and downstream consumers:

- 5.1 `HttpGenerateSource` parses exactly this frame syntax. It maps 401 to `unauthenticated` and 503 to `ai-unavailable`, and it treats a stream with no terminal frame as `provider-error`. A frame or status change breaks it.
- 5.5 e2e depends on the composition's 150 ms mock pacing. The route adds no delay or buffering of its own.
- CI layer3 runs `pnpm smoke` against `pnpm dev:bg`, which forces the mock.
- The #306 handoff "4.3 must resolve the foreign/reused-server issue before smoke gains generation entries" is discharged: #333 merged in PR #335, and `scripts/dev-bg.sh` refuses a foreign server.

Evidence floor:

- Unit (`src/app/api/ai/generate/route.test.ts`). It runs the real handler, the real `generate` and the real mock provider.
  - `@/app/server/account-services` is mocked with `importOriginal`. `requireJson` stays real, `requireUser` is a `vi.fn`, and `mapsForUser` is a spy.
  - `@/app/server/ai-services` is mocked so that `aiService` is a `vi.fn` returning `{ provider, providerId: 'mock', model: 'mock', log: { info } }`.
    - `provider` is the real `createMockProvider({ idFactory, delayMs: 0, script? })`, with its `streamOps` wrapped in a spy.
    - `idFactory` is a counter.
  - `@/shared/logger` is mocked for `error`.
  - Form-encoded body: 415, and `requireUser`, `aiService` and `streamOps` are not called.
  - Signed out, Binding mismatch and Empty binding:
    - the requests carry no cookie, `x-mindsprout-session-binding: other`, and `x-mindsprout-session-binding: ` respectively;
    - `requireUser` is called exactly once with that same request and returns a 401 Response;
    - the route returns that Response object (`toBe`);
    - `aiService` and `streamOps` are not called, and the body is unread (`request.bodyUsed === false`).
  - Blank topic (`'   '` and `'　'`), Oversized topic (201 ASCII code units, and 101 `'𐀀'` = 202 code units), Unknown field, invalid JSON, `rootId: ''` and a missing `rootId`:
    - each gives 400 `{"error":"invalid-input"}`;
    - `streamOps` is not called.
  - Longest topic accepted:
    - 200 ASCII code units and 100 `'𐀀'` each give 200;
    - `streamOps` receives the topic unchanged and `rootId`.
  - AI disabled: with `aiService` returning `undefined`, the response is 503 `{"error":"ai-unavailable"}`.
  - Order of checks 3 and 4: a blank topic with `aiService` returning `undefined` gives 400, not 503.
  - Internal failures:
    - `aiService` throws `new Error('ANTHROPIC_API_KEY is required ...')`, and separately `requireUser` rejects;
    - each gives 500 `{"error":"internal"}`;
    - `logger.error` is called exactly once with `{ event: 'ai.generate.failed' }`;
    - the response body does not contain the error message.
  - Mock generation streams to done:
    - the status is 200, the content type is exactly `text/event-stream`, and cache-control is `no-store`;
    - the body is split into frames: 5 `op` frames, then one `done` with data `{}`, and nothing after;
    - each op's data passes `parseTreeOp` and has `op: 'add_children'`;
    - the first op's `parentId` is the posted `rootId`;
    - `info` is called once with `outcome: 'done'` and `ops: 5`.
  - Error after partial output:
    - topic `mock:error-after-2` gives 2 `op` frames, then exactly one `error` frame with data `{"code":"provider-error","message":"The AI provider request failed"}`;
    - there is no `done`;
    - no frame contains `mock transport failed`.
  - Stateless: across a completed generation, `mapsForUser` is never called.
  - Browser stops the request:
    - the request carries a test `AbortController`'s signal;
    - the mock `script` plays the root call and then a `wait` step whose `onWait` aborts that controller;
    - the reader gets exactly one `op` frame, and then `read()` returns `done: true` with no terminal frame;
    - the `wait` step settles, which proves `request.signal` reached the provider (a different signal would hang the test until it times out);
    - `info` is called with `outcome: 'aborted'`.
  - Cancel before abort. Next 16.4.5 usually aborts `request.signal` first (`app-route.js:219` registers it before `pipeToNodeResponse`) and does not guarantee the order; abort-first is covered by "Browser stops the request", and this row covers the cancel-first order:
    - the `wait` step's `onWait` first calls `reader.cancel()` and then aborts the request controller;
    - the `cancel()` promise resolves;
    - `info` gets `outcome: 'aborted'`;
    - no unhandled rejection occurs during the test.
    - This test exists for coverage of `cancel()` and of the helper's cancelled branch. Without the flag, the stream swallows the `TypeError` from `close()`, so "no write after cancel" is a review-only check.
  - Unexpected error:
    - `@/contexts/ai/application/generate` is mocked with `importOriginal`, so `generate` is `vi.fn(actual.generate)`;
    - in one test, `generate` is an async generator that throws `new TypeError('boom')`;
    - `read()` rejects with that error, no terminal frame was written, and the error is not mapped to an `error` frame.
  - Already-aborted request:
    - a signal aborted before `POST` gives 200;
    - the first `read()` returns `done: true` with no bytes;
    - `streamOps` is not called;
    - `info` gets `attempts: 0`.
- Contract: `pnpm test:contract` passes.
- Smoke: `AI_PROVIDER=anthropic ANTHROPIC_API_KEY=dummy AI_MODEL=dummy pnpm dev:bg && pnpm smoke` passes. The live disconnect check below then runs, and `pnpm dev:stop` comes last. `.env` is neither read nor written. The proof is `stat -f %m .env` before and after, which is metadata only.
- Live disconnect, recorded in Runtime evidence:
  - against the same `dev:bg` server, register a throwaway user with curl;
  - run `curl -N --max-time 0.4` on a valid generate request;
  - the warm-up is the smoke run above, so the route is already compiled;
  - `.run/dev.log` then holds a new `ai.generate` line with `"outcome":"aborted"`, `"attempts":1` and 1 ≤ `ops` < 5;
  - no `ai.generate.failed` or error-level line follows it;
  - only that line is quoted.
- `pnpm test:guardrails` passes, and the PR flags the `constraints.yaml` edit.
- `pnpm lint`, `typecheck`, `boundaries`, `docs:check` and `anti-drift` pass.
- Per-file coverage is at least 90%.
- The PR carries `diff-limit-exempt`, with the M2 route-PR justification and a self-checked `git diff --numstat origin/main...HEAD` total.

## Issue #307 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree. This adapter is the only way TreeOps enter the browser. A wrong code mapping shows the wrong notice. A missed abort leaves the stream billing, and a missed frame split drops ops. 5.2's undo grouping and lock both depend on its end semantics.
Blast radius: every editor generation once 5.4 composes it.
Governing invariant:

- The iterable yields only ops that passed `parseTreeOp`, in frame order.
- It ends in exactly one of three ways:
  - it returns normally after `done`;
  - it returns normally because the caller's signal aborted;
  - it throws exactly one `GenerateError` whose code follows the table below.
- No server diagnostic text reaches the error.

Selected risk packs:

- Public API (consumer side): the 4.3 frame syntax and status codes, as shipped in PR #337 (`src/app/api/ai/generate/route.ts`).
- Concurrency/abort: the caller's signal, the release of the reader on every exit, and a consumer `return()`.
- Error handling / partial outputs: an error after ops, a stream truncated mid-frame, a malformed frame.
- Auth/secrets: the Session binding header (decision 0028). Only the server's code is used, and its message is never read.
  Not selected:
- Schema: no storage.
- Config: no env variable.
- File IO.
- Legacy: new code only.
- Release: unused until 5.4.
- Resource limits: the server caps the output (caps from D4), so no client cap is needed.
- Docs beyond the CONTEXT row: TECH §5.6 already describes SSE consumption.
  Interface:
- `src/contexts/map/domain/generate-source.ts` is type-only, following the `map-repository.ts` precedent:
  - `GenerateInput { topic: string; rootId: NodeId }`;
  - `GenerateSource { generate(input: GenerateInput, signal: AbortSignal): AsyncIterable<TreeOp> }`.
  - The paired `generate-source.test.ts` uses `expectTypeOf`, as `map-repository.test.ts` does.
- `src/contexts/map/domain/errors.ts` gains `GenerateErrorCode`, which is `'timeout' | 'provider-error' | 'invalid-output' | 'refused' | 'ai-unavailable' | 'unauthenticated' | 'network'`.
  - It also gains `class GenerateError extends Error`, with `name` set to `'GenerateError'`, a readonly `code`, and the fixed message `` `generation failed: ${code}` ``.
  - Map's existing error classes live in this file. Map never imports ai, so these codes are map's own vocabulary.
- `src/contexts/map/infrastructure/ai/http-generate-source.ts` exports `class HttpGenerateSource implements GenerateSource`.
  - Its constructor is `(fetchGenerate: typeof fetch = globalThis.fetch.bind(globalThis), binding?: string)`, the same shape as `HttpMapRepository`.
  - `generate` is an async generator.

Behaviour:

1. Request. It calls `fetchGenerate('/api/ai/generate', { method: 'POST', headers, body: JSON.stringify({ topic, rootId }), signal })`.
   - `Content-Type` is `application/json`.
   - `x-mindsprout-session-binding` is the binding, set only when a binding is given. This mirrors `HttpMapRepository.request`.
   - The input is sent unchanged; the store trims (5.2).
2. Already aborted. If `signal.aborted` is true before the call, it returns without fetching.
3. Fetch rejection:
   - with `signal.aborted`, it returns normally;
   - otherwise it throws `GenerateError('network')`.
4. Abort wins once the fetch resolves. If `signal.aborted` is true when the fetch resolves, the adapter returns normally before mapping the status. This holds even for a fetch implementation that ignores the signal, so a Stop during a pending fetch never yields `ai-unavailable` or any other code.
5. Status:
   - 401 gives `unauthenticated`.
   - 503 gives `ai-unavailable`.
   - Any other non-200 gives `provider-error`. This includes 400, 415 and 500.
   - A 200 with a null `body` gives `provider-error`.
   - The response body of a non-200 is never read.
6. Reading.
   - It uses `body.getReader()` and one `TextDecoder('utf-8')` with `{ stream: true }`, and appends each chunk to a buffer.
   - Before each frame is handled, including right after resuming from `yield`, `signal.aborted` is checked. If it is true, the adapter returns normally, so an abort stops the frames already buffered in the same chunk.
   - Each complete frame is the text before the next `\n\n`. A frame is valid only when it is exactly two lines, `event: <name>` and `data: <json>`, which is the shape `frame()` in route.ts writes.
   - The server writes `\n` only, so `\r\n` and multi-line `data` are out of scope (recorded).
   - `op`: `JSON.parse` followed by `parseTreeOp`, then yield.
     - If `JSON.parse` throws or `parseTreeOp` throws `TreeOpError`, the result is `invalid-output`: the payload is unusable content.
   - `error`: the data must be an object whose `code` is one of `timeout`, `provider-error`, `invalid-output` or `refused`.
     - If it is, the adapter throws `GenerateError(code)`.
     - Otherwise it throws `provider-error`.
     - The server's `message` is never read.
   - `done`: the data must be exactly `{}`. The adapter then returns. Bytes after the terminal frame are not read.
   - Anything else is `provider-error`: an unknown event name, a frame that is not two lines, or `done` with data other than `{}`.
7. End of the body without a terminal frame gives `provider-error`, including a partial frame left in the buffer.
   - With `signal.aborted`, it returns normally instead.
8. A `read()` rejection:
   - with `signal.aborted`, it returns normally;
   - otherwise it throws `network`, because the connection dropped mid-stream. This includes a server-side non-`GenerationError` throw (route.ts rethrows it), which errors the response stream. The user then sees the `network` text instead of `provider-error`. This is a recorded choice, reachable only through a server defect.
9. Abort while reading. An `abort` listener on `signal` calls `reader.cancel()`, so a pending `read()` settles even when the fetch implementation ignores the signal. The iterable then returns normally. The listener is registered in the same synchronous run as the step-4 check, with no `await` between them, so no abort can fall between the two.
10. Release on every exit. This covers `done`, a throw, an abort and a consumer `return()`.

- A `finally` removes the abort listener, calls `reader.cancel()` and then `releaseLock()`.
- `reader.cancel()` rejects with the stored error on an errored stream, for example after a `read()` rejection.
- So both cancel calls, in the listener and in the `finally`, swallow that rejection with a `.catch` whose comment names it. The `finally` never awaits a cancel that can replace the generator's own outcome.

Downstream consumers:

- 5.2's store action relies on three things:
  - a normal return without its own abort means completion;
  - a normal return after its own abort means Stop or leave;
  - the `GenerateError` code picks the notice (D9 notice table).
    The `ai-unavailable` and `unauthenticated` codes drive the `AI 未配置` form and the session-expiry notice.
- 5.4 composes `new HttpGenerateSource(undefined, binding)` beside `HttpMapRepository` in the `src/app` provider. This slice leaves it unused. `knip.json` lists `src/**/*.test.ts` as entries, so an export used only by its test passes `pnpm dead-code`, as the provider adapters did before 4.1.
- 5.5 e2e reaches it through the real route.

Must preserve:

- `HttpMapRepository` and its tests;
- the existing classes in `errors.ts`;
- `tree-op.ts`.
- Map imports nothing from `src/contexts/ai`, which `pnpm boundaries` enforces.

Sibling surfaces:

- the CONTEXT map row: its Owns cell gains "`GenerateSource` port and its browser adapter (M3: SSE client over `/api/ai/generate`)", and its Integration cell changes from "consumes TreeOps from ai via `acl/ai.ts`" to "consumes TreeOps from `/api/ai/generate` over HTTP";
- the 4.3 route's frame writer.

Not in this slice (recorded):

- `\r\n` line endings and multi-line `data`: our server never emits them (route.ts `frame()`).
- A client-side cap on frame or buffer size: the server caps the op count, and the route is first-party.
- A dependency-cruiser rule forbidding map → ai: an existing rule already blocks cross-context imports outside `acl/`.

Evidence floor (Vitest, `http-generate-source.test.ts`). An injected `fetch` returns `new Response(stream)`, where `stream` is a `ReadableStream` with a controlled `pull`/`cancel`, built with `{ highWaterMark: 0 }` so that the pull count equals the read count.

- Request:
  - exactly one call, to `/api/ai/generate` with `POST`;
  - the body parses to exactly `{ topic, rootId }`, and the topic is unchanged, including surrounding spaces;
  - `Content-Type: application/json`;
  - the binding header equals the binding when one is given, and is absent when it is not;
  - the passed `signal` is the caller's signal.
- Reassembly:
  - the same 2-op-plus-`done` body is delivered split at every byte offset (one loop over offsets), including a split inside a multibyte character of `要点`;
  - each split yields exactly the 2 parsed ops, deep-equal to the originals, and then ends.
- Several frames in one chunk yield each op.
- An `error` frame:
  - for each of the four codes, after one op, the op is yielded first and then `GenerateError` is thrown with that code;
  - the thrown message does not contain the frame's `message`, which is a sentinel such as `server-diagnostic-307`.
- An `error` frame with an unknown code, or with no code, gives `provider-error`.
- A stream ending without a terminal frame gives `provider-error`. This covers an empty body, one op then EOF, and a partial frame then EOF.
- A malformed frame gives `provider-error`: an unknown event, a three-line frame, and `done` with data `{"x":1}`.
- An invalid op gives `invalid-output`: `data` that is not JSON, and an op that is valid JSON but fails `parseTreeOp` (for example `children: []`).
- Status:
  - 401 gives `unauthenticated`;
  - 503 gives `ai-unavailable`;
  - 400, 415 and 500 give `provider-error`;
  - each non-200 carries a misleading body: a 500 whose body is `{"error":"unauthenticated"}`, and a 400 whose body is an SSE `error` frame with `timeout`. Each still gives `provider-error`;
  - in each case `response.bodyUsed` is false and the pull count is 0;
  - a 200 with a null body gives `provider-error`.
- A fetch rejection (`TypeError('Failed to fetch')`) gives `network`. A `read()` rejection mid-stream gives an `instanceof GenerateError` with code `network`, and no unhandled rejection occurs. This proves that the swallowed cancel rejection did not replace it.
- Abort:
  - an already-aborted signal means `fetch` is not called and iteration ends with no value;
  - Abort while a read is pending, in a pinned order:
    - take op1;
    - start `next()` without awaiting it, on a `pull` that never resolves;
    - call `abort()`;
    - the pending `next()` resolves `{ done: true }`, and the source's `cancel` ran.
    - The fake fetch ignores the signal, so only the listener can settle the read.
  - One chunk holds `op1`, `op2` and `error{timeout}`. When the abort happens inside the loop body after op1, exactly one op is yielded, and the generator returns normally without throwing.
  - Abort during a pending fetch: the fake fetch ignores the signal and then resolves with 503, and separately with a 200 SSE body. Both end normally with no value and no throw;
  - a fetch that rejects with `AbortError` after an abort ends normally and does not throw `network`.
- Consumer `return()`: after one op, `break` out of `for await`; the body's `cancel` ran.
- Bytes after `done` are never read:
  - one chunk holds `op1`, then `done`, then another `op` frame. Exactly op1 is yielded;
  - with `highWaterMark: 0`, a further chunk queued after it is never pulled.
- `errors.test.ts`: `GenerateError` has its name, its code and the fixed message, and it is an `instanceof Error`.
- `generate-source.test.ts`: the port's shape, checked with `expectTypeOf`.
- `pnpm boundaries` passes, so map imports no ai code. `pnpm lint`, `typecheck`, `dead-code` (knip) and `docs:check` pass.
- Runtime evidence: none. This is a review-only surface, because the adapter is unused until 5.4. The real route is covered by 4.3 smoke and the 5.5 e2e.

## Issue #308 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree: this action owns the undo group, the lock and the first-op deferral. A slip leaves a group open (autosave never saves), splits a generation into several undo steps, lets a user edit sneak into the generation group, or loses partial results on Stop.
Blast radius: every editor generation, undo, and autosave of a generated map.
Governing invariant:

- A generation opens exactly one `generate` group and closes it exactly once. It closes through `endGroup`, or History closes it through a reducer rejection, or `load` replaces History.
- `generating` is true exactly while the group is the session's. It is false after every end.
- Nothing in the tree or the title changes before the first op.
- Every tree change during a generation comes from the session's own dispatch.

Selected risk packs:

- Concurrency/state machine: double submit, Stop racing a frame, an end after Stop, a `load` during a generation, a reducer rejection inside the group.
- Error handling / partial outputs: an error after ops keeps them, and the prefix follows the ops-applied count.
- Data integrity (undo/history): one undo step, the empty group on zero ops, no `endGroup` after a rejection.
- Persistence: autosave holds while the group is open and saves once after.
- User-visible text: the notice table.
  Not selected:
- Public API: there is no HTTP here; 5.1 owns it.
- Auth/secrets: `unauthenticated` only maps to the existing `SESSION_EXPIRED` notice.
- Schema: there is no new TreeOp and no History change.
- Config, File IO, Legacy and Release: not applicable.
- Docs: 5.4 owns README.

Interface (all in `src/contexts/map/application/editor-store/`):

- `createEditorStore` options gain `generateSource?: GenerateSource`, the port from 5.1, injected as a fake in tests.
- `EditorStoreErrorCode` gains `'generating' | 'not-empty' | 'invalid-topic' | 'no-source'`.
- `EditorState` gains:
  - `readonly generating: boolean`;
  - `readonly aiUnavailable: boolean`;
  - `generate(topic: string): Promise<void>`;
  - `stopGeneration(): void`.
- The notice table lives in one new module, `generation-notice.ts` (paired test). It exports `generationNotice(code, opsApplied): string | null`:
  - The five codes `timeout`, `provider-error`, `invalid-output`, `refused` and `network` give `生成失败：` + text when `opsApplied` is 0, and `生成中断：` + text otherwise. The texts are the ones in the D9 table.
  - `unauthenticated` gives `SESSION_EXPIRED`. Its definition moves from `editor-store.ts:90` into `generation-notice.ts`, and `editor-store.ts` re-exports it unchanged. The import direction is store → notice module, so there is no cycle (`no-circular`). `EditorView.tsx:3` keeps importing it from `editor-store`.
  - `ai-unavailable` gives `null`. Its state is `aiUnavailable`, and the form text `AI 未配置` belongs to 5.4.
  - It is the single source of these strings (D9).

`generate(topic)` is a non-async method. Its refusals throw synchronously, so a second submit fails before any await. It returns the session's promise, which never rejects for a `GenerateError`.

1. Refusals, in order. Each throws `EditorStoreError` and changes no state.
   - `no-map`.
   - `no-source`: no `generateSource` was injected (a composition defect).
   - `generating`: a generation is running.
   - `already-editing`: an inline edit is open (`requireIdle`).
   - `not-empty`: the primary root has children, or more than one root exists.
   - `invalid-topic`: the trimmed topic is empty, or its `length` (UTF-16 code units) is over 200.
2. Start. In the same synchronous run:
   - create a session token (a fresh object). The store holds `current = token`, and every end path below acts only while `current === token`. An old session that is stopped, reloaded or replaced never touches a later session's group, lock or notice;
   - clear the notice if it is the last notice a generation set (the store remembers that string). A save notice (`保存失败`, or a `SESSION_EXPIRED` set by autosave) is kept;
   - create an `AbortController`;
   - set `generating: true`;
   - call `history.beginGroup('generate')` and publish through `commit`, so `groupOpen` is true and autosave stops observing.
   - Then iterate `generateSource.generate({ topic: trimmed, rootId }, controller.signal)`, where `rootId` is `map.roots[0].id`.
3. First op, before dispatching it:
   - dispatch `update_node { id: rootId, text: trimmed }` through the session's own dispatch, inside the group;
   - if `map.title === '新导图'`, apply `rename(trimmed)` and remember the previous title. Rename is metadata, not an undo step, and it is not locked;
   - then dispatch the op.
   - Later ops are dispatched as they arrive.
   - The session's dispatch is an internal path that bypasses the lock, using the same `apply` and `history.dispatch` as `dispatch`.
4. Normal end (the iterable returns) when the session is still active:
   - `history.endGroup()`, published through `commit`;
   - `generating: false`;
   - no notice.
   - With zero ops the group is empty, so nothing is pushed and the map, the title and `canUndo` are unchanged.
5. `GenerateError` when the session is still active:
   - end the group as in step 4;
   - `generating: false`;
   - for `ai-unavailable`, `aiUnavailable: true` and no notice;
   - otherwise `notice: generationNotice(code, opsApplied)`.
   - `opsApplied` counts the source ops that were dispatched. The root-text `update_node` is not counted.
6. Reducer rejection. The session's dispatch throws `TreeOpError`, which means History has already reverted and closed the group:
   - abort the controller first, then stop iterating, following the #307 handoff;
   - do not call `endGroup`;
   - restore the remembered title, through `rename`, if this session renamed it and the title still equals the topic. `updatedAt` is not restored: it is metadata stamped by `rename`, and the next save carries it;
   - set `generating: false` and `notice: generationNotice('invalid-output', 0)`, which is `生成失败：AI 返回的内容无法使用，请重试`.
7. `stopGeneration()`:
   - with no generation running, it does nothing;
   - otherwise, synchronously: abort the controller, end the group as in step 4, and set `generating: false` with no notice.
   - The session is then inactive. Every later op, return or error from the source is ignored, so nothing is dispatched and no notice is shown.
   - This keeps Stop synchronous, so 5.4's unmount and pagehide handlers can call `stopGeneration()` and then `flush()`. The partial map is already stable, so the flush saves it.
8. `load(map)` during a generation aborts the controller and marks the session inactive. The session must not touch the new map or the new History. `load` already resets `groupOpen`, and it also sets `generating: false`. `aiUnavailable` is kept.
   - `AI 未配置` lasts for the editor visit, which is the store's lifetime, because `EditorSession` creates one store per mount. Spec and D9 wording now say "editor visit". A module-level flag would be hidden global state.
9. Any other error thrown by the source is a defect. While this session is active (`current === token`), it ends the group, clears `generating` and rethrows from the returned promise. After Stop or `load`, the session is inactive: the error is ignored like every other late item, and the promise resolves. The lock is never left set.
   - Placement: `generate` stays small under complexity 10. Its refusals are a `requireCanGenerate` helper, and the loop with its end handling is a separate session function inside `createEditorStore`, or a module-level helper taking the store's internals.
10. Lock. While `generating` is true, these refuse with `EditorStoreError('generating')` before any change:
    - `dispatch`, `undo`, `redo`;
    - `beginGroup`, `endGroup`, `cancelGroup`, and so `runGrouped`;
    - `createNode`, `deleteSelection`, `startEdit`, `commitTitle`, `cancelEdit`.
      These remain available:
    - `select`, `toggleSelect`, `setSelection`, `selectAll`, `clearSelection`;
    - `openMenu`, `closeMenu`, `topmostSelected`;
    - `showNotice`, `clearNotice`, `rename`, `flush` and `stopGeneration`.
    - Moving, recolouring and notes all go through `dispatch`, so they are covered.
    - Pan and zoom live in the canvas and are not store actions; 5.3 adds the handler guards.

Must preserve:

- History unchanged (no History change);
- every existing store action's behaviour while not generating;
- the creation-group rules;
- autosave semantics, which observe only stable maps;
- `SESSION_EXPIRED` text;
- the existing editor-store test files, which must pass unchanged.

Downstream consumers:

- 5.3 canvas guards read `generating`.
- 5.4 wires three things:
  - the form, from `generating`, `aiUnavailable` and the empty-map rule;
  - the Stop control, through `stopGeneration`;
  - unmount and pagehide, through `stopGeneration()` then `flush()`.
- 5.5 e2e.

Sibling surfaces: `EditorStoreError` codes; the notice slot shared with the autosave notices (`保存失败`, `SESSION_EXPIRED`); `MapLibrary.tsx:249`, where the default title `新导图` is set.

Shipped deviations (PR for #308):

- Start order: `history.beginGroup('generate')` runs first, and the token, the controller, `generating: true` and the notice follow in one publication. If `generating` were set before `beginGroup` throws `group-open` (a manual store group is open), the lock would stay set for good. `generate` therefore also refuses with `HistoryError('group-open')` while a group is open, changes no state, and calls no source. A test covers this.
- Reducer rejection reuses `apply`, so it publishes the reverted map, with `groupOpen` false, once before the title restore and `generating: false`. That is one extra synchronous publication; every other end path publishes once.
- `commit` takes a third `flags` argument, with default `{}`, so the group flags, `generating` and the notice are published in one `set()`.
- The fake source lives in `tests/support/generate-source.ts`. It ignores the signal, so tests call `finish()` after Stop or `load`, the way a real source returns after an abort.

Not in this slice (recorded):

- A shared constant for `新导图`: `MapLibrary.tsx` keeps its literal. A shared constant would cross into the components layer, so the literal is compared in one place in the store.
- Restoring the title on Stop or on errors after ops: the spec keeps the title.
- The canvas guards (5.3) and the form (5.4).

Evidence floor (Vitest). Tests go in a new `editor-store-generate.test.ts`, following the existing split per behaviour. Notice-table tests go in `generation-notice.test.ts`.

- Test setup. A fake `GenerateSource` returns an async generator driven by the test, with an explicit handshake:
  - `push(op)` returns a promise that settles on the consumer's next pull, or when the generator's `finally` runs because the session called `return()`. In the first case the op was dispatched. In the second it was rejected or dropped;
  - `finish()` and `fail(error)` end the fake generator. The sync point for an end is the promise that `generate()` returned, and the test awaits it directly;
  - no test relies on a count of microtask flushes.
  - a deferred queue of ops, then a return or a throw;
  - it records the input and the signal, and whether the signal was aborted.
  - Ops are real `add_children` TreeOps under the root id.
  - A store with an injected fake repository and fake timers covers autosave.
- Root text and title:
  - a map titled `新导图`, generated with `'  学习 TypeScript  '`;
  - the source receives the trimmed topic and the root id;
  - after the first op, the root text and title are both `学习 TypeScript`.
- Custom title kept: titled `我的计划`, the title is unchanged and only the root text changes.
- Nothing changes before the first op: while the source has yielded nothing, the map is `===` the pre-generation map, the title is unchanged, `canUndo` is false, `generating` is true and `groupOpen` is true.
- Zero-op ends, two runs, each with autosave and fake timers:
  - `stopGeneration()` before any op;
  - a normal return with zero ops.
  - Each leaves the map `===` the pre-generation map, the title unchanged, `canUndo`, `groupOpen` and `generating` all false, no notice, and no `put` after `AUTOSAVE_DELAY_MS` × 2.
- Restart after Stop:
  - Stop before the first op, then start a second `generate`, then let the first fake return; in separate runs it throws a `GenerateError` and throws a plain `Error`;
  - the second session's `generating`, `groupOpen` and `notice` are unchanged;
  - the first promise resolves.
  - A fourth run: the old fake yields an op after the second `generate` has started. Before the second source yields anything:
    - the map is `===` the pre-generation map;
    - the root text and title are unchanged;
    - the second session's signal is not aborted.
      This proves ops are gated by the token, not by `generating` or `groupOpen`.
- Stale notice cleared:
  - a zero-op `network` failure, then a retry that completes, gives `notice === null`;
  - a retry that is stopped also gives `notice === null`;
  - a `保存失败` notice set before a generation is kept at start. A `SESSION_EXPIRED` equal to the remembered string is cleared even if autosave set it later. This is accepted: the next 401 shows it again.
- Failure before the first op:
  - the source throws `GenerateError('invalid-output')` before any op;
  - the map is still the identical object, the title is unchanged and `canUndo` is false;
  - the notice is `生成失败：AI 返回的内容无法使用，请重试`, and `generating` is false.
- Completed, then undo and redo:
  - after the 5-op skeleton, the map holds 16 non-root nodes and one `undo()` gives only the root with its pre-generation text;
  - `redo()` gives the 16 nodes back;
  - `canUndo` is false after the undo, which proves this was one entry.
- Undo partial generation: after 2 ops and `stopGeneration()`, one undo restores the pre-generation tree.
- Double submit:
  - a second `generate` while running throws `generating` synchronously;
  - the source was called once.
- Refusals:
  - `not-empty`, for a root with a child and separately for a floating root;
  - `invalid-topic`, for `'   '`, for 201 ASCII units and for 101 `'𐀀'`. At the limit, 200 ASCII units, 100 `'𐀀'`, and a padded topic whose trimmed length is 200 are each accepted, and the source receives them;
  - `no-source`;
  - `already-editing`, with a rename edit open.
  - Each leaves the state unchanged and calls no source.
- Reducer rejection:
  - after one valid op, the source yields an op whose `parentId` is unknown;
  - `map.roots` is deep-equal to the pre-generation roots, `canUndo` is false and the title is restored to `新导图`;
  - the signal was aborted before the iterator's `return` ran, which the fake records;
  - the notice is the invalid-output failure text and `generating` is false;
  - a later `undo` is a no-op, so no entry exists.
- Reducer rejection of the very first source op, after the root `update_node` and `rename` have run: the title returns to `新导图`, `roots` is as before, `canUndo` is false, and the notice is the `生成失败：` invalid-output text.
- AI unavailable:
  - `GenerateError('ai-unavailable')` gives `aiUnavailable: true`, no notice and an unchanged map;
  - `aiUnavailable` stays true after `load` of another map.
- Session expired at submit: `unauthenticated` gives `notice === SESSION_EXPIRED` and an unchanged map.
- Network failure: `network` before any op gives `生成失败：网络连接失败，请检查网络后重试`.
- Failure notices use fixed texts: a table-driven test over the five codes, each with `opsApplied` 0 and 1, comparing exact strings, both through `generationNotice` and through the store with 0 and 1 ops.
- Stop:
  - after the first op, `stopGeneration()` synchronously sets `generating: false` and `groupOpen: false`, with no notice;
  - the nodes from that op remain, and the signal is aborted;
  - two separate runs check what arrives after Stop: in one, an op the fake then yields is not dispatched; in the other, a `GenerateError` the fake then throws shows no notice.
- Mid-stream error:
  - 2 ops (the root call with 4 children, then 3 children under `p1`), then `provider-error`;
  - 7 non-root nodes remain;
  - the notice is `生成中断：AI 服务出错，请稍后重试`;
  - one undo restores the pre-generation state.
- Load during a generation:
  - `load(other)` aborts the signal and sets `generating: false`;
  - a later op from the old source is not applied to `other`, and `other` stays `===` the loaded map.
- A defect error: the source throws a plain `Error`, the promise rejects with it, and `generating` and `groupOpen` are both false.
- Lock:
  - while `generating`, each refused action listed in step 10 throws `EditorStoreError` with code `generating`, and the map is unchanged;
  - each allowed action listed in step 10 succeeds.
- Saved after completion:
  - with fake timers and a fake repository, no `put` happens while generating, even after `AUTOSAVE_DELAY_MS` × 2;
  - after completion and the delay, exactly one `put` happens, carrying the generated map.
  - After `stopGeneration()` and `flush()`, the partial map is put.
- Gates: per-file coverage of at least 90% for `editor-store.ts` and `generation-notice.ts`. `pnpm lint` (complexity 10, 700-line files), `typecheck`, `boundaries` and `fmt:check` pass. All existing editor-store tests pass unchanged.
- Runtime evidence: none. This is a review-only surface: the store action is unused until 5.4 composes it. The 5.5 e2e covers the UI path.

## Issue #309 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree. Since 5.2, the store throws `EditorStoreError('generating')` from every tree-changing action. Any canvas entry point that still calls one turns a user gesture into an uncaught error during generation, and the e2e "zero console errors" gate fails.
Blast radius: every canvas gesture during a generation.

Governing invariant:

- While `generating` is true, no canvas or editor-view handler calls a locked store action.
- Every gesture that would edit does nothing and raises no error.
- Selection, panning and zooming behave exactly as when idle.
- The store remains the single lock authority; handlers only read `generating`.

Selected risk packs:

- Concurrency/state: a gesture that started before generation (an open menu, an active drag, a focused note) when `generating` flips to true.
- User-visible behaviour: nothing happens, and no console error.
- Not selected:
  - Public API, Auth, Schema, Config, File IO, Legacy, Release: not applicable.
  - Docs: no doc names these handlers.

Entry points (every call site of a locked action, from `grep` over `src/components`):

1. Keyboard, `src/components/canvas/selection-input.tsx` and `InlineTitleInput.tsx`:
   - `handleTitleKey` (F2 → `startEdit`);
   - `handleCreationKey` (Tab/Enter → `createNode`);
   - `handleHistoryKey` (Cmd/Ctrl+Z, with Shift → `undo`/`redo`);
   - `handleDeletionKey` (Delete/Backspace → `deleteSelection`).
   - Each returns before `preventDefault` when `selection.generating` is true, so the browser default is not swallowed either.
   - `handleSelectionKey` is unchanged.
2. Double-click, `MindMapCanvas.tsx:327-331` (`titleEditing.startEdit`): returns when `generating` is true.
3. Context menu, `ContextMenu.tsx`:
   - `open` refuses when `state.generating` is true;
   - `menuContext` returns `undefined` when `state.generating` is true.
   - So an open menu closes through the existing effect once a generation starts, and no entry can run.
4. Node drag: `node-drag.tsx` `enabled` also requires `selection.generating` to be false. The existing `[enabled]` cleanup (`node-drag.tsx:164`) cancels an in-flight gesture, and `nodesDraggable` becomes false. `commitDrop` in `EditorView.tsx` is reachable only through `node-drag.tsx:236`, after `currentGesture()` (which is null when `!enabled`). It gets no guard, because a guard there would be an untestable dead branch.
5. History toolbar, `HistoryToolbar.tsx`: both buttons are `disabled` when `controls.generating` is true. There is no `onClick` guard, because React never fires `onClick` on a disabled button, and the closure reads the same render's `controls`.
6. Note panel:
   - `EditorView.tsx` `onCommit` returns when `current.generating` is true;
   - `NotePanel` gains a `readOnly` prop, set from `generating`, so the textarea cannot be edited.

7. `EditorSession.tsx` gains an optional `generateSource?: GenerateSource` prop, passed to `createEditorStore`. This is the seam that lets the tests render EditorView-level handlers through `EditorSession` with the #308 fake source (`tests/support/canvas-drag.tsx` and the NotePanel tests both render through it). 5.4's `src/app` provider passes the real `HttpGenerateSource` through the same prop.
8. These need no guard, which is recorded. `InlineTitleInput.tsx:50-51` (`commitTitle`/`cancelEdit` on blur, Enter and Esc) and `EditorView.tsx:43` and `:51-52` run only while `editing` is not null. `generate` requires `editing === null` (`editor-store.ts:313`), and `startEdit` and `createNode` refuse during a generation, so `editing` stays null throughout. `MindNodeView` has no handlers, and every `menu.ts` action is behind the menu guard.
9. Do not fold `generating` into `blocked()` (`MindMapCanvas.tsx:255-256`). That would also disable pointer selection and the rubber band. The guards are per entry point.
10. Note draft when a generation starts. Through the UI no draft exists, because the blur caused by the Generate click commits it first. If one did exist, the first op's `growRoot` rewrites the root, and `NotePanel.tsx:15-17` resets the draft, so the draft is discarded and never committed later. In the zero-op state, the `onCommit` guard drops it.

Types:

- `CanvasSelection` and `CanvasHistory` (`selection-input.tsx`) add `'generating'` to their `Pick`, which is the store's own flag.
- `EditorView` already passes the whole state object, so no new prop plumbing is needed beyond `NotePanel`'s `readOnly`.

Unchanged:

- `panOnDrag={PAN_BUTTONS}`, zoom and `minZoom`/`maxZoom`;
- `onNodeClick` selection and the rubber band;
- `handleSelectionKey`;
- `ViewportControls`.
- `zoomOnDoubleClick` stays `titleEditing === undefined`. A double-click during generation therefore neither edits nor zooms, as when idle.

Must preserve:

- every existing canvas and editor test, unchanged and green;
- every handler's behaviour while not generating.

Downstream consumers:

- 5.4 renders the form and Stop.
- 5.5 e2e asserts zero console errors during generation.

Sibling surfaces: `EditorView.tsx` and `EditorSession.tsx` are also 5.4's files. This slice touches only the note `onCommit` guard and the `NotePanel` `readOnly` prop in `EditorView`, and only the optional `generateSource` prop in `EditorSession`. 5.4 lands after it and rebases. The PR boundary is `src/components/canvas/` plus those two edits.

Shipped deviations (PR for #309):

- Most tests render through `EditorSession` and `EditorView`, the real composition. Only the pan test builds the store directly.
- `tests/support/canvas-drag.tsx` `measure` now takes the ids to measure, so it can be reused for a root-only map.
- In-flight drag: on a root-only map the drop is already refused (`node-drop.ts:73`), so "drop dispatches nothing" does not detect a missing guard. The test checks instead that the preview snaps back and stays at its start position on the next move.
- Menu `open` guard: without it, `menuContext` still hides the menu. The test checks instead that the contextmenu event is not `defaultPrevented` and that `menuTargetId` is never set.

Not in this slice (recorded):

- The topic form, Stop and notices (5.4).
- Dimming or a cursor change on the canvas while generating: no requirement asks for it.

Evidence floor (Vitest, jsdom):

- Test setup:
  - A real store with the #308 fake source (`tests/support/generate-source.ts`). Canvas-level tests use `createEditorStore({ generateSource })` directly. EditorView-level tests render through `EditorSession` with the new `generateSource` prop.
  - The test calls `generate` on an empty map and lets the source hold, so the store has `generating: true` and an open group. It then pushes one op, so the map has nodes to act on. The zero-op state is covered too.
  - Errors are captured with the existing `failOnConsoleNoise()` (`tests/support/canvas.ts:13`) plus a `window` `error` listener whose list must be empty. Do not add a new spy.
- The detecting assertions. The store lock alone keeps the map, `editing` and `canUndo` unchanged, so those do not show a missing guard. What shows it is: no console or window error, `defaultPrevented`, whether a menu is rendered, the `.draggable` class, the `disabled` attribute and the `readOnly` attribute. Each guard's test is shown failing with that guard removed (bite check, reported in the PR).
- Shortcut ignored during generation:
  - with a node selected, Tab, Enter, F2, Delete, Cmd+Z, Ctrl+Z and Cmd+Shift+Z each raise no error;
  - none of these keydown events is `defaultPrevented`;
  - the map stays `===` its prior value and `editing` stays `null`.
- Selection still works while generating:
  - arrows and Cmd+A change `selectedIds`;
  - a click selects;
  - a shift-click toggles;
  - a rubber-band drag selects its nodes.
  - These catch `generating` being folded into `blocked()`.
- Pan during generation, observed through behaviour with the existing harness (`dragViewport` / `viewportTransform` in `MindMapCanvas.test.tsx`, and the wheel tests):
  - while generating, a middle-button drag changes `viewportTransform()`, and so does a wheel;
  - `generating` stays true;
  - the next `push(op)` is applied.
- Double-click a node: no edit opens and no error is raised.
- Context menu:
  - a right-click while generating renders no menu;
  - a menu opened before `generate` closes once generating starts, in the zero-op state, where the map object is unchanged;
  - no entry ran.
- Drag:
  - the node wrapper loses the `.draggable` class while generating;
  - a drag that started before `generate` is cancelled when it starts, and the drop then dispatches nothing.
- History toolbar:
  - before `generate`, make `canUndo` and `canRedo` both true: two root note `update_node` dispatches, then one `undo`. Both stay true inside the group, because a group leaves `future` untouched;
  - while generating, in the zero-op and the one-op state, both buttons are `disabled`.
- Note panel, rendered through `EditorSession`:
  - the textarea is `readOnly` while generating;
  - a blur commit fired while generating dispatches nothing and raises no error.
- After the generation ends, by completion and separately by Stop, each guarded gesture works again: Tab creates a node, the menu opens, `.draggable` returns, and the buttons follow `canUndo`/`canRedo`. This proves the guards read live state.
- Gates:
  - per-file coverage is at least 90% for every changed file;
  - `pnpm lint`, `typecheck`, `boundaries` and `fmt:check` pass;
  - all existing component tests pass.
- Runtime evidence:
  - `pnpm verify-ui` is not applicable yet, because no UI path starts a generation until 5.4.
  - This is a review-only surface. The 5.5 e2e covers the browser path.

## Issue #310 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree. This slice turns the 5.1–5.3 pieces into the user-visible feature.
Blast radius: every editor visit. A wrong composition sends requests without the account binding. A missing unmount stop leaves a generation running after the user leaves, and it loses the partial result. A form that shows on a non-empty map invites the not-empty refusal.

Governing invariant:

- The form is rendered exactly while the map is empty, and Generate is offered only while idle.
- Stop is rendered exactly while `generating` is true.
- Leaving the editor during a generation runs `stopGeneration()` before `flush()`, so the partial map is saved.
- Components never import infrastructure.
- While idle, manual editing of an empty map stays fully available. The form covers no part of the canvas and takes no focus on its own.

Selected risk packs:

- User-visible behaviour: the form, Stop, `AI 未配置`, notices.
- Concurrency/state: double submit, Stop, unmount and pagehide during a generation.
- Auth/secrets: the generate source carries the same Session binding as the map repository (decision 0028), and it resets with the account like the repository.
- Docs: README Known Limitations.
  Not selected:
- Public API: there is no new route.
- Schema, Config, File IO, Legacy: none apply.
- Release: no flag.

Interface:

1. Composition, `src/app/providers/MapRepositoryProvider.tsx`:
   - `ReadyRepository` becomes `{ repository: MapRepository; generateSource?: GenerateSource }`.
   - `openSessionRepository()` adds `generateSource: new HttpGenerateSource(undefined, binding ?? '')`, using the same `binding` as the `HttpMapRepository` it opens. An absent cookie therefore sends an empty binding and fails closed, the same as map writes.
   - The `open` prop path (tests) has no `generateSource`.
   - `useMapRepository()` exposes it through the ready state.
2. `src/app/maps/[id]/MapEditor.tsx` passes `generateSource` to `EditorSession` through the prop added in #309, with a conditional spread (`exactOptionalPropertyTypes`). That prop is read once, when the store is created.
3. `src/components/editor/EditorSession.tsx`: the pagehide handler and the unmount cleanup both call `store.getState().stopGeneration()` and then `flush()`. `stopGeneration` does nothing when idle (#308), so the idle behaviour is unchanged.
4. New `src/components/editor/TopicForm.tsx`, with a CSS module and a paired test. `EditorView` renders it in normal document flow between the header and the canvas area, as a bar. It is not an overlay, so it never covers the root node or the empty canvas. It does not autofocus: `selectionBlocked` reads `document.activeElement` (`selection-input.tsx:79-88`), so a focused input would block canvas shortcuts.
   - Visibility: it is rendered while `map.roots.length === 1 && map.roots[0].children.length === 0`, which is the store's own empty rule. Once the map is not empty it renders nothing.
   - `aiUnavailable`: the form shows the text `AI 未配置` in place of the input and Generate.
   - The form is a `<form>` with an input labelled `主题` (`aria-label`). Its local `draft` state keeps the text across a failure, so the user can retry.
   - Generate is a `type="submit"` button labelled `生成`. It is rendered only while `generating` is false, and it is `disabled` unless `draft.trim()` is 1–200 UTF-16 code units long.
   - While generating, the input is `readOnly` and Generate is not rendered.
   - `onSubmit` calls `preventDefault`. If the store is not generating and the topic is valid, it calls `void store.getState().generate(draft)`, where the store trims the topic. Otherwise it does nothing, so a second submit makes no request.
   - Submitting through a click moves focus to the button. That blurs a focused `NotePanel` textarea, which commits its draft before `generate` runs (#309 item 10).
5. Stop: a separate `<button type="button">停止生成</button>` in `EditorView`. It is rendered while `generating` is true, including after the first op, when the form is gone. `onClick` calls `stopGeneration()`.
6. Notices: the existing `NoticeToast` already renders `notice`, and the `重新登录` link already follows `SESSION_EXPIRED`. No change is needed. The tests prove that generation notices show through it.
7. README Known Limitations: the `无 AI` line is replaced by three lines:
   - AI: generation from one topic on an empty map only, with no expand, regenerate or chat. AI is optional. Without a configured provider, the first submit gets 503, the form then shows `AI 未配置` for the rest of that editor visit, and manual editing is unaffected.
   - Quota: there is no per-user quota or rate limit (M4).
   - Deployment: local use only. Quota must exist before any deployment (design.md:66, :310).

Must preserve:

- every existing editor, `MapEditor` and provider test;
- the map repository's binding and account reset;
- the pagehide and unmount flush ordering when idle.

Downstream consumers: the 5.5 e2e (the labels `主题`, `生成`, `停止生成`, and the text `AI 未配置`); the 7.1 docs.

Existing e2e walks that open a new or root-only map now see the form bar. They must stay green under `pnpm e2e`, and their screenshots change:

- `m1-acceptance.spec.ts:85-99`;
- `m2-acceptance.spec.ts:104-116`;
- `map-library.spec.ts:88-95`;
- `account-auth.spec.ts:518` and `:632`;
- `canvas-editing.spec.ts:109-121`;
- `smoke.spec.ts:16`.

The bar sits in normal flow and shrinks the canvas height. Any walk that asserts absolute positions is checked.

Sibling surfaces:

- `CONTEXT.md` (unchanged; 5.1 already rewrote the map row);
- README.

Shipped deviations (PR for #310):

- `editor-store.ts` exports `TOPIC_MAX_LENGTH`, so the form and the store share one limit instead of repeating 200.
- The form has `aria-label="生成导图"` and a placeholder.
- The session open path builds the result in a `new Promise` executor, so a throwing adapter constructor still becomes a failed open.
- A changeset is added, because this is a user-visible change.
- An absolute overlay cannot be detected in jsdom, because jsdom has no layout. Normal flow is proven by the e2e screenshots. The autofocus bite check is caught in jsdom.

Not in this slice (recorded):

- A provider or model switch (M3.5);
- the e2e walk (5.5);
- visual polish of the form beyond a usable layout.

Evidence floor (Vitest, jsdom), with a real store and the #308 fake source, rendered through `EditorSession` and `EditorView`:

- New map: the input `主题` and an enabled-on-valid-text `生成` are visible.
- Non-empty map: a root with a child, and separately a floating root, each render no input and no `生成`.
- Invalid topic cannot be submitted:
  - These stay disabled: blank, `'   '`, 201 ASCII characters, and 101 `'𐀀'` (202 code units). For each, `fireEvent.submit(form)` makes no source call.
  - These are enabled and submit: 200 ASCII characters, and a padded topic whose trim is exactly 200 code units.
- Guards that only show through errors. Without the `onSubmit` guard, the store would throw `invalid-topic` or `generating` synchronously. So the detecting assertion is that `failOnConsoleNoise()` and a `window` `error` listener both stay empty, the same as #309. The PR shows a bite check with the guard removed.
- Double submit:
  - the first submit is a click on `生成`;
  - a second `fireEvent.submit(form)` while generating makes no second source call and raises no error;
  - the source was called exactly once.
- While generating, with zero ops: the input `主题` has `readOnly === true`, and no `生成` button exists.
- Manual editing while the form shows, idle on a new map:
  - a click on the root selects it;
  - Tab creates a child;
  - the form then disappears;
  - no error is raised.
- Root text and title flow end to end: after the first pushed op, the form is gone, Stop is still shown, and the header title reads the topic.
- AI unavailable: the source throws `GenerateError('ai-unavailable')`. `AI 未配置` is shown, no input or `生成` remains, and the map is unchanged.
- Notices:
  - `network` before any op shows `生成失败：网络连接失败，请检查网络后重试`;
  - `unauthenticated` shows the session-expiry text and the `重新登录` link, with no navigation.
- Stop:
  - `停止生成` is visible from submit until the end, before and after the first op;
  - clicking it ends the generation, so Stop disappears and the nodes remain.
- Unmount during a generation, using fake timers with the `EditorSession.test.tsx:92-118` pattern:
  - after one op, `unmount()`;
  - immediately, with no timer advanced, `puts` holds exactly 1 entry, and it is the partial map;
  - the source's signal is aborted;
  - after advancing `AUTOSAVE_DELAY_MS`, `puts` is still 1.
  - If flush ran before stop, nothing would be written immediately and the partial map would only be saved by a later timer, which pagehide never lets run. So this test fails under the wrong order. The PR shows that bite check.
- Pagehide during a generation: the same assertions after `window.dispatchEvent(new Event('pagehide'))`.
- Note draft: a focused note textarea holds an uncommitted draft. To mimic the browser's focus order, call `generateButton.focus()` and then `fireEvent.click(generateButton)`, because `fireEvent.click` alone moves no focus. The note `update_node` lands before the `generate` group, so undo after completion keeps the note.
- Composition:
  - Extend the account-switch rebind test (`MapRepositoryProvider.session.test.tsx:75-94`) with `vi.stubGlobal('fetch')`, intercepting `/api/ai/generate`, because `MapFetch` does not handle that route:
    - Alice's and Bob's `generateSource` are different instances;
    - a generate request from Bob's carries `x-mindsprout-session-binding: Qm9i`;
    - with no binding cookie, the header is the empty binding.
  - The `open` prop path has no `generateSource`.
  - The `MapEditor` composition test uses the default session path, and a generation started from the rendered editor reaches the session's source.
- Gates:
  - per-file coverage is at least 90% for every changed file;
  - `pnpm lint`, `typecheck`, `boundaries` (components import no infrastructure), `fmt:check` and `docs:check` pass;
  - all existing tests pass.
- Runtime evidence:
  - `pnpm verify-ui` on the editor route is not meaningful until 5.5 adds the generation walk and its mock-forced e2e server;
  - `pnpm e2e` must stay green, because the existing walks see the new form on new maps;
  - its screenshot of a new map is attached.

## Issue #311 Fixture Triage

Issue type: feature
Fixture level: expanded
Upstream suggested level: expanded. Agree. This slice is the only browser proof of the generation flow, and it closes the e2e server's path to a real provider.
Blast radius: every `pnpm e2e` run. Without the forcing, an e2e server started next to an owner `.env` that configures a real provider would bill a real key. A flaky timing assertion would make the required `E2E (Playwright)` check flake.

Governing invariant:

- The e2e server runs with `AI_PROVIDER=mock`. The value is set in the child's process environment, so it wins over `.env` and over the caller's environment.
- `.env` is neither read nor written by the agent. No test or local run calls a real provider.
- Each assertion that depends on stream timing states a range that every pacing outcome satisfies, never an exact count that needs a click to land within one 150 ms gap.

Selected risk packs:

- Auth/secrets (billing): the mock forcing.
- Concurrency/state: Stop, leaving and the saved partial result, asserted against a real stream.
- User-visible behaviour: the six scenarios, zero console errors, screenshots.
  Not selected:
- Public API, Schema, Config, File IO, Legacy, Release, Docs: none apply. The AGENTS Runtime Lifecycle line changes in 7.1.

Interface:

1. `scripts/e2e-server.mjs`: the spawned `next dev` gets `AI_PROVIDER: 'mock'` after `...process.env`, with a comment naming the failure mode (a real key billed by `pnpm e2e`) and that 7.1 adds the live pass-through. No other variable changes. The mock ignores `AI_MODEL` and the keys (`src/app/server/ai-services.ts:57`), and `src/shared/env.ts:19` requires none for `mock`.
2. New `e2e/topic-generation.spec.ts`. It uses the signed-in `test` from `e2e/support/session.ts`, creates a map with `新建导图` (root text `新导图`, `src/components/library/MapLibrary.tsx:250`), and generates through the real form (`主题`, `生成`, `停止生成`).
   - The mock skeleton (D11, `src/contexts/ai/infrastructure/providers/mock.ts`) is 5 ops at 150 ms each. Op 1 adds `要点 1`–`要点 4` under the root. Ops 2–5 each add three children (`要点 1.1`…`要点 4.3`). A completed map has 17 nodes. The node count after k ops is 1 + 4 + 3(k − 1): 5, 8, 11, 14, 17.
   - To observe "the first op has landed", the spec waits in the page with `page.waitForFunction(…, { polling: 'raf' })` until `要点 4` is rendered, and returns `.react-flow__node` counts sampled in that frame.

Scenarios (spec `specs/topic-generation/spec.md`), each a `test` in the new spec:

- Progressive appearance: submit `学习 TypeScript`. When the four first-level nodes first appear, the sampled node count is ≤ 8, so they appeared before the stream ended. Then all 17 nodes appear, `停止生成` disappears, and the root and the header title read `学习 TypeScript`. Screenshot mid-stream (`停止生成` visible) and after completion.
- Stop: after the first op, click `停止生成`. Then:
  - `停止生成` disappears and no notice is shown;
  - the node count is in [5, 14] and is unchanged after waiting 1 s, which is longer than the rest of the stream (600 ms), so the stream really ended;
  - `要点 1`–`要点 4` are all visible;
  - editing is unlocked: clicking the root and pressing Tab creates a child.
    Screenshot after Stop.
- Mid-stream error: submit `mock:error-after-2`. Exactly 8 nodes remain (the root and the 7 nodes from the two ops). The notice reads `生成中断：AI 服务出错，请稍后重试`. Screenshot.
- Leaving saves partial result: after the first op, click `返回导图列表` (client-side navigation, no pagehide). Then:
  - the generate request is aborted: `requestfailed` fires for `/api/ai/generate`, or its response stream ends without a `done` frame. The spec picks one observable and states which;
  - the editor's leave flush writes a `PUT` for the map, and the spec waits for its 2xx response;
  - reopening the map from the library shows `要点 1`–`要点 4` with a node count in [5, 14].
    Screenshot of the reopened map.
- Saved after completion: submit with `Enter` in the `主题` input (the real implicit submit, #310 handoff), wait for completion and for the `PUT` that follows it to return 2xx, then reload. The reloaded map has 17 nodes, including `要点 4.3`.
- Undo completed generation: after completion, press `ControlOrMeta+z` once with focus outside any text input. The map has exactly one node, and it reads `新导图`.

Every scenario fails on any console error, warning or uncaught page error, using the same collector pattern as the existing specs. Responses it expects, such as an aborted request, are declared explicitly, never filtered wholesale.

Must preserve:

- Every existing e2e walk, the zero-skip gate and the `E2E (Playwright)` CI check.
- `scripts/e2e-server.mjs` keeps the derived test database variables and its credential handling (decision 0026).
- No `src/**` change.

Not in this slice (recorded):

- The IME check (an Enter that confirms a Chinese candidate must not submit) cannot be driven by Playwright. It is a manual WebKit check for the owner's functional acceptance.
- The keyboard and pointer lock during a generation (Cmd/Ctrl+Z, Tab, the context menu, a drag in progress) is proven in jsdom by #309. The 600 ms mock window is too short for a deterministic browser assertion.
- Live pass-through, the CI refusal, `pnpm e2e:live` (7.1, 7.2); `reducedMotion` (6.1).

Evidence floor:

- Red: the new spec fails before the forcing exists, when the process environment selects a non-mock provider. Bite check: remove the forcing and run only the new spec with `AI_PROVIDER=anthropic ANTHROPIC_API_KEY=dummy AI_MODEL=dummy ANTHROPIC_BASE_URL=http://127.0.0.1:9`. The local unroutable base URL keeps the request off the network. The walk must fail without mock output. Restore the forcing and confirm the file with `cmp`.
- Never run any e2e command unless the forcing is in place or the process environment selects mock or the unroutable dummy provider. The owner's `.env` may configure a real provider.
- Green:
  - `AI_PROVIDER=anthropic ANTHROPIC_API_KEY=dummy AI_MODEL=dummy pnpm e2e` passes, and the generation walk shows mock output (`要点 4.3`). This is ai-live-acceptance "Default e2e", the mock server half.
  - A plain `pnpm e2e` passes.
  - The new spec run alone with `--repeat-each=5` passes 5/5 for each scenario. This shows the ranges hold.
- Screenshots in `.run/ui-evidence/topic-generation-*.png`.
- `pnpm lint`, `typecheck`, `fmt:check`, `test:guardrails` (`scripts/` touched) and `native:browser:test` pass.

## Impact

- **Code:**
  - `src/contexts/ai/{domain,application,infrastructure/providers,acl}` (new).
  - `src/app/api/ai/generate/route.ts` and `src/app/server/ai-services.ts`.
  - The map `GenerateSource` port and HTTP adapter.
  - The editor store, the canvas lock, `EditorView` / `EditorSession` and the editor provider.
  - Canvas node CSS.
  - `src/shared/env.ts`, `.env.example`, `scripts/dev-bg.sh` and `scripts/e2e-server.mjs`.
- **Critical paths:**
  - `providers/`, `src/app/api/` and `src/app/server/` need full cross-review, mock and fixture tests, an `openapi.yaml` update and a smoke entry.
  - `constraints.yaml`, `AGENTS.md` and `scripts/test-guardrails.sh` count as gate integrity and need `pnpm test:guardrails` evidence.
- **Dependencies:** three new runtime packages, with lockfile pairing and the installed-license audit.
- **Docs:**
  - TECH §5/§7/§8, CONTEXT, AGENTS and README change with the code that makes them stale.
  - PRD §6 and the glossary changed at planning.
  - New decision record 0039.
- **Not affected:** database schema, RLS, the account context and map persistence formats. `schemaVersion` stays 1.
