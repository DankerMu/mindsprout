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
