# Design

## Context

See `proposal.md` (Why). These facts about the current code determine the approach:

- `src/contexts/ai/` holds only `.gitkeep` files. The map context owns `TreeOp`. Its Zod schema and `parseTreeOp` live in `src/contexts/map/domain/tree-op.ts`, and `applyOp` rejects bad ops with `TreeOpError`.
- `.dependency-cruiser.cjs` lets a context reach another context only through its own `acl/`. `map` has no `acl/` directory, and `account/acl/map.ts` re-exports map types. That file is the precedent for the new `ai/acl/map.ts`.
- `History` has `beginGroup` / `endGroup` / `cancelGroup`.
  - Inside an open group, a reducer rejection becomes `GroupCancelledError` and reverts the _whole_ group.
  - Autosave observes only while no group is open.
  - `runGrouped` is synchronous, so it cannot wrap a stream.
- The library creates new maps as `createMindMap({ title: '新导图', rootText: … })`, and the editor opens them.
- `src/shared/env.ts` validates env with a strict Zod object and currently knows no AI variable. `.env.example` already lists `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `OLLAMA_BASE_URL`.
- `constraints.yaml` already reserves `/api/ai/generate` as "pending (M3)".
- Playwright starts its own server via `scripts/e2e-server.mjs` with a reset database (decision 0026) and has no `reducedMotion` setting.
- Claude API facts, checked against the current API reference on 2026-11-26:
  - `claude-opus-5-5` rejects forced `tool_choice` (`any` / `tool`) with a 400, and its effort defaults to `medium`.
  - `strict: true` is a top-level field of the tool definition.
  - `eager_input_streaming: true` requires the client to validate the parsed input.
  - `fallbacks: "default"` needs `client.beta.messages` with the beta `server-side-fallback-2026-07-01`. TECH §5.2 says `client.messages.stream()`; D4 records the actual endpoint.
  - A model that calls tools stops with `stop_reason: tool_use` and waits for tool results. Multi-level generation therefore needs a tool-result loop (D3).

## Goals / Non-Goals

**Goals:**

- One provider-neutral server path from a topic to a stream of validated TreeOps. Every adapter shares the same validation, id remapping and caps, so there is exactly one implementation of each (AGENTS Code Canonicality).
- Generation reuses the M1/M2 machinery unchanged: the reducer, History groups and autosave. No new TreeOp kind is introduced (CONTEXT: new op kinds need a decision record).
- Every check runs against the mock provider or transport fixtures. A real key is used only in the opt-in live spec (decision 0039).

**Non-Goals:**

Each item below is ablated or out of scope; its revival trigger is in parentheses.

- JSON-mode channel, capability flags (`supportsToolCalling` …) and the capability router (M3.5, when a second output channel exists).
- `Provider.listModels()` (M3.5 settings page model picker).
- Ollama adapter, user-supplied keys, encrypted `user_providers` and the settings page (M3.5).
- `ai_usage` table and daily quota with 429 (M4; required before the first deployment). M3 has per-request caps only.
- A mode enum covering the three AI entry modes (M4, when Grow lands as a second mode).
- Node-level Grow actions, text import and chat panel (M4/M5).
- A provider or model switch in the UI (M3.5).
- Server-side persistence of generated maps. The route never reads or writes the database; saving stays the client's autosave (decision 0003).
- Regenerating a non-empty map, or generating under a selected node (M4 Grow).
- Recording real provider responses as fixtures (owner decision: hand-authored wire fixtures).
- A deployment (M3 is local acceptance only, like M2).

## Decisions

### D1. Provider port and module layout

- `ai/domain/`:
  - `GenerateRequest { topic, rootId, signal }`.
  - The `Provider` port: `streamOps(request) → AsyncIterable<TreeOp>`.
  - The Generate tool schema: `{ parentId: string, children: [{ id: string, text: string }] }`.
  - `ProviderOutputError` and `ProviderTransportError`.
  - The op assembler (D2).
  - Domain imports only zod, src/shared and its own `acl/map.ts`. That file re-exports `TreeOp`, `parseTreeOp` and the node types from map's domain, the same pattern as `account/acl/map.ts`.
- `ai/application/`:
  - `generate(provider, request, { now, timeoutMs })`: retry and timeout (D5).
  - The prompt text (D6).
- `ai/infrastructure/providers/`:
  - `openai-compatible.ts` (Vercel AI SDK `@ai-sdk/openai-compatible`)
  - `anthropic.ts` (`@anthropic-ai/sdk`)
  - `mock.ts`
  - Each adapter receives its transport (`fetch` or an SDK client) by injection, so tests drive it with wire fixtures.
- `src/app/server/ai-services.ts` builds the one configured provider from env (D7). It is the composition root; nothing else imports adapters.
- Alternative rejected: providers yield raw tool calls and application validates them. Decision 0002 fixes `streamOps → TreeOp`. Keeping validation inside one shared domain assembler, called by every adapter, preserves that port and still gives one implementation.

### D2. Generate protocol: flat per-parent calls, temporary ids, server remap

- The model sees one tool, `add_children`, with the schema above.
  - The prompt tells it to call the tool once per parent, top layer first.
  - It names each child with a short temporary id unique within the session.
  - It uses `root` for the primary root, and may emit several calls per turn.
- The **op assembler** is a pure, stateful domain object created per attempt. It gets `{ rootId, idFactory, caps: { depth: 2, perParent: 7, total: 60 } }`.
  - It validates every complete tool input with Zod: the object is strict, text is a non-empty string, and children has at least one entry.
  - It resolves `parentId`: `root` maps to `rootId`, otherwise to an earlier temporary id it has already emitted.
  - It rejects an unknown parent or a duplicate temporary id as `ProviderOutputError`.
  - It maps every child to a fresh `idFactory()` nanoid.
  - It returns `{ op: 'add_children', parentId, children }` with no `index` (append), validated by map's `parseTreeOp` before it leaves.
- Caps truncate; they never repair content (TECH §5.3).
  - Children beyond `perParent` for one parent, counted across calls, are dropped.
  - A call whose parent is at depth 2 is dropped.
  - Once 60 nodes have been emitted, the assembler reports `exhausted`; the adapter aborts the provider call and the stream ends with `done`.
  - Text longer than 40 characters is kept. It is a prompt constraint, not a server cap (TECH §3).
- The client prepends its own `update_node` on the root (D9). The server never emits it, so the route stays stateless.
- Why not one nested tree: it arrives only when the model finishes, which defeats "first node < 3 s".
- Why not partial-JSON node-by-node: it applies unvalidated input, which conflicts with CONTEXT "validated before it touches the tree".
- Why the server remaps ids instead of trusting model ids: model ids collide with existing ids, and a collision is a reducer rejection that reverts the whole group (Context).

### D3. Tool-result loop

Each adapter loops for at most 4 model turns.

- After a turn that ended on tool use, it answers every tool call with a short `ok` tool result, then requests the next turn.
- It stops on a natural end (`end_turn` / `stop`), on assembler exhaustion, on abort, or after turn 4.
- Tool results never echo the server ids: the model keeps addressing its own temporary ids, and the assembler keeps the mapping.
- OpenAI-compatible: AI SDK `streamText` with the tool carrying an `execute` that returns `ok` and a step limit of 4. Each completed `tool-call` stream part feeds the assembler.
- Claude: `client.beta.messages.stream` per turn. Each `tool_use` content block, once its input has completed, is `JSON.parse`d with a guard and fed to the assembler. The next turn appends the assistant content and the `tool_result` blocks.

### D4. Claude request settings

- `model: AI_MODEL`, `max_tokens: 8000` (60 short nodes need far less; a hard per-request cap), `output_config: { effort: 'medium' }`, and `thinking` omitted (adaptive).
- The tool has `strict: true` and `eager_input_streaming: true`, with `tool_choice: { type: 'auto' }`. The system prompt instructs the model to change the map only through the tool.
- The system prompt is one stable text block with `cache_control: { type: 'ephemeral' }`; the topic goes in the user message.
- `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`.
- A final `stop_reason: refusal` is a `ProviderOutputError` with code `refused`. `max_tokens` with an incomplete tool input is a `ProviderOutputError`.
- The client is built with `maxRetries: 0` (D5 owns retry), a `baseURL` from `ANTHROPIC_BASE_URL` (optional), and the key from `ANTHROPIC_API_KEY`.
- OpenAI-compatible uses `maxRetries: 0`, `baseURL` from `OPENAI_BASE_URL`, the key from `OPENAI_API_KEY`, and `maxOutputTokens: 8000`.

### D5. Retry, timeout, abort

- `generate` wraps one provider attempt:
  - If the attempt fails with `ProviderTransportError` or `ProviderOutputError` **before its first op was yielded**, it runs exactly one fresh attempt with a fresh assembler.
  - A failure after the first op ends the stream with an error and no retry.
  - An abort never retries.
- One `AbortController` per request is linked to the client's request signal and to a 30 s total timer. A timeout aborts the provider and yields error `timeout`.
- Error codes surfaced to the client: `timeout`, `provider-error` (transport or HTTP failure), `invalid-output` (validation failure after the retry) and `refused`. Messages are fixed Chinese strings; provider error bodies and keys are never forwarded or logged (`src/shared/logger.ts` redaction stays in force).
- One span is emitted, `ai.generate`, with attributes for provider id, model, op count, attempt count and outcome code. The topic text is not attached (AGENTS observability: never log raw user input).

### D6. Prompt

- `ai/application/generate-prompt.ts` holds one unified system prompt. It states the protocol (tool only, flat per parent, temporary ids, `root`) and the content constraints: two levels below the root, 3–7 children per parent, each ≤ 40 characters, no paragraphs, MECE siblings, output language follows the topic (PRD §9 resolved: one unified prompt).
- Adapters add only transport-specific formatting; there is no per-language template.
- The prompt is a constant, which keeps the Claude cache prefix stable.

### D7. Configuration

`src/shared/env.ts` extends its schema with optional fields: `AI_PROVIDER` (`openai-compatible | anthropic | mock`), `AI_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`.

- A `superRefine` enforces the following rules, and a violation throws at load:
  - `openai-compatible` requires `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `AI_MODEL`.
  - `anthropic` requires `ANTHROPIC_API_KEY` and `AI_MODEL`.
  - `mock` with `NODE_ENV=production` is rejected.
- With `AI_PROVIDER` unset, the AI service is `undefined`, and the route answers 503 `ai-unavailable`.
- `.env.example` documents the platform default (`AI_PROVIDER=openai-compatible`, `OPENAI_BASE_URL=https://www.dmxapi.cn/v1`, `AI_MODEL=deepseek-v4.1-flash-1017`) by key name only.
- Alternative rejected: hard-coded default models. The owner chose env-only (no model string to drift in code).

### D8. Route `POST /api/ai/generate`

- `requireUser` runs first. Without a session the route answers 401 `unauthenticated`, with the same JSON error shape as the existing API.
- The body is Zod-validated: `{ topic: string (1–200 UTF-16 code units, trimmed non-empty), rootId: string (non-empty) }`, strict object. An invalid body answers 400 `invalid-input`.
- With no configured provider it answers 503 `ai-unavailable`. All of these checks run before any provider call.
- Success is `200 text/event-stream`, `cache-control: no-store`. Its frames:
  - `event: op` + `data: <TreeOp JSON>`
  - `event: error` + `data: {"code","message"}` (terminal)
  - `event: done` + `data: {}` (terminal)
  - Exactly one terminal event ends every stream.
- `request.signal` feeds D5's controller, so a client disconnect aborts the provider call.
- The route body is composition only: parse, then `generate(...)`, then serialise. It has no business logic.
- `schemas/openapi.yaml` gains the path and the event schemas, the contract snapshot is updated, and `smoke/api.hurl` gains entries: 401 without a session, 400 for a bad body, and a 200 stream that ends in `done` under the mock provider. `constraints.yaml` flips the route to "covered by smoke/api.hurl".
- Next.js 16 route-handler streaming follows `node_modules/next/dist/docs/` (AGENTS note 6).

### D9. Editor generation session

- **Op source port.** A map-context port `GenerateSource { generate(input: { topic, rootId }, signal): AsyncIterable<TreeOp> }` lives in `map/domain`. Its browser adapter `map/infrastructure/ai/http-generate-source.ts`:
  - POSTs to the route and sends the Session binding header like the map adapter (decision 0028).
  - Parses SSE frames, validates each `op` payload with `parseTreeOp`, and throws a typed `GenerateError(code)` on an `error` frame, an HTTP error or a premature end.
  - CONTEXT's map row ("consumes TreeOps from ai via `acl/ai.ts`") is revised to "consumes TreeOps from `/api/ai/generate` over HTTP". The two contexts meet only at the HTTP contract, so no client code imports ai.
- **Store action.** `generate(topic)` lives in the editor store and works as follows:
  - It refuses unless the map is empty: the primary root has no children and there are no floating roots.
  - It opens `beginGroup('generate')` and sets `generating = true`.
  - It dispatches `update_node { id: rootId, text: topic }`. If the title is still `新导图`, it applies the existing metadata `rename(topic)`.
  - It then dispatches every streamed op.
  - On completion, Stop (abort), error, unmount or pagehide it calls `endGroup()`. This always closes the group, keeping partial results as one undo entry. It then clears `generating`. An error sets the notice `生成中断：<message>`, while Stop sets no notice.
  - Autosave resumes on the closed group; the pagehide/unmount path aborts, ends the group, then runs the existing flush.
- **Lock.** While `generating`, the store's tree-changing actions throw `EditorStoreError('generating')`. This covers dispatch outside the session, createNode, delete, move, color, note, undo, redo and rename of root text. It makes the store the single lock authority. The canvas disables the controls that would call them and hides menu edits. Pan, zoom and selection remain.
- **Reducer rejection.** A reducer rejection of a streamed op is a `GroupCancelledError`: the whole group reverts (Context). The session aborts the request and shows `生成失败`. The server's D2 guarantees make this a defect path, not a normal one.
- **UI.** `EditorView` renders a topic form over the empty map: an input, a Generate button and the `AI 未配置` state when the route answers 503. While generating it shows a Stop button, and the form disappears once the map is non-empty.

### D10. Layout transitions

- Node wrappers get a CSS `transform` transition of 200 ms ease-out, and node content gets a 200 ms opacity/translate fade-in on mount.
- A wrapper class removes the transition while a node drag gesture is live, so the controlled drag preview follows the pointer exactly.
- `@media (prefers-reduced-motion: reduce)` disables both.
- Measurement-driven framing (decision 0033) measures DOM size, not position, so it is unaffected. Fit and pan of the viewport are not animated by this change.
- Existing e2e position assertions would sample mid-transition. `playwright.config.ts` therefore sets `reducedMotion: 'reduce'` for the default project, and one dedicated spec runs with `reducedMotion: 'no-preference'` to prove that the transition and fade are applied and settle at the final layout. A jsdom unit covers class toggling during drag.
- Alternative rejected: animating through React Flow position interpolation in JS, which adds per-frame layout work and a second position authority.

### D11. Mock provider and live acceptance

- **Mock provider.** It is deterministic: for any topic it yields 4 first-level children, then 3 children under each, with texts derived from the topic, through the same op assembler. The pacing is a fixed injected per-op delay; composition uses 150 ms, so Stop is observable in e2e.
- **Mock scenario topics.** Reserved topics select scenarios: `mock:error-after-2` (two ops, then a provider error) and `mock:invalid-first` (invalid output twice, so the retry fails). The adapter itself is rejected in production (D7).
- **Live acceptance.** `e2e/ai-live.spec.ts` skips with a printed reason unless `E2E_AI_LIVE=1`.
  - `scripts/e2e-server.mjs` forces `AI_PROVIDER=mock` unless live mode is on. In live mode it passes the `.env` AI variables through.
  - It exits non-zero when `E2E_AI_LIVE=1` and `CI=true`.
  - The spec asserts first node < 3 s, generation completed with second-level nodes < 10 s, and depth ≤ 2.
  - Vitest configs never load provider keys, and their tests inject transports.
  - This exception amends AGENTS "What agents may not do" and the CONTEXT forbidden-logic row through decision 0039.

### Sketch seams under test

- **`Provider.streamOps` via a shared provider contract suite** (`describeProviderContract`) run against all three adapters. The adapters get injected wire fixtures: hand-authored SSE bodies following the vendors' documented formats. This is the highest seam that proves one validation/remap/cap implementation behind every transport, and it mirrors the existing `describeMapRepositoryContract` precedent.
- **`generate()` application use case over fake providers.** It is the one place retry, timeout and abort semantics live, and it can be tested deterministically with an injected clock and controller.
- **Route handler `POST(request)` with the mock composition, plus `smoke/api.hurl`.** This is the public HTTP contract (critical path); the handler is composition only, so one seam suffices.
- **Editor store `generate` action over a fake `GenerateSource`.** It covers the group, lock, Stop, error, title and empty-map rules without a browser. The UI and the real HTTP adapter are covered once by the mock-provider Playwright walk.

## Not yet specified

- Generation quality beyond the shape constraints: whether the skeletons are _good_ (MECE, coverage) has no oracle yet. PRD §7 lists "AI 生成内容被手动修改的比例" as a post-launch metric, but there is no eval set or rubric to grade content in M3.

## Risks / Trade-offs

- [The model ignores "one parent per call" and nests or repeats ids] → strict tool schema (Claude `strict: true`), Zod at the assembler, and one retry before the first op. After the first op the stream stops and keeps the partial result. Live acceptance surfaces systematic drift (open item O2).
- [The multi-turn tool loop adds latency (one round trip per turn)] → the prompt asks for all calls in as few turns as possible, and parallel tool calls are allowed. The live spec measures the < 10 s target against the real model.
- [dmxapi may not speak the Anthropic-native protocol] → the Claude adapter is proven by fixtures. A live Claude run happens only if the endpoint supports it, and the result is recorded in the acceptance issue (open item O1).
- [The AI SDK API surface differs from the design's description (step limit, tool-call parts)] → the dependency slice pins the versions, and the adapter slice reads the installed package docs before coding. The adapter contract suite is the arbiter.
- [Global layout transitions make existing e2e timing flaky] → default `reducedMotion: 'reduce'` plus one motion-enabled spec (D10).
- [With no quota, a runaway client loop bills the platform key] → there is no deployment in M3. Each request is capped (60 nodes, 4 turns, 8000 output tokens, 30 s); generation needs a signed-in user and an empty map. Quota is a hard prerequisite of the first deployment (CONTEXT annotation).
- [The live e2e spends real money] → it is opt-in only, refused under CI, and runs a single generation per run.

## Migration Plan

There is no data migration and `schemaVersion` stays 1. Rollout order is dependencies → domain → adapters → route → editor → transitions → acceptance (see `tasks.md`). Rollback is a `git revert` of the slice; with `AI_PROVIDER` unset the feature is inert.

## Open Questions

- O1: does dmxapi.cn serve the Anthropic-native Messages protocol for Claude models? It is answered during live acceptance, and does not change specs or tasks: the Claude adapter ships either way.
- O2: is `deepseek-v4.1-flash-1017` tool calling through dmxapi reliable enough to meet < 3 s / < 10 s? It is answered during live acceptance. A miss is reported to the owner as an acceptance failure, not silently tuned.
