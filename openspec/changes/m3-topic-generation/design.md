# Design

## Context

See `proposal.md` (Why). These facts about the current code and providers determine the approach:

- **Map context.** `src/contexts/ai/` holds only `.gitkeep` files. The map context owns `TreeOp`: its Zod schema and `parseTreeOp` live in `src/contexts/map/domain/tree-op.ts`. `add_children` requires at least one child, and `applyOp` rejects bad ops with `TreeOpError`.
- **Boundaries (`.dependency-cruiser.cjs`).**
  - A context reaches another context only through its own `acl/`.
  - `domain-is-pure` lets `domain/` import only its own context's `domain/`, `src/shared` and zod, so `acl/` is **not** allowed. Type-only imports count too (`tsPreCompilationDeps`).
  - `account/acl/map.ts` re-exports map types, and only `account/infrastructure` imports it. `map` has no `acl/`.
- **History.**
  - `History` has `beginGroup` / `endGroup` / `cancelGroup`, and `endGroup` on an empty group pushes nothing.
  - Inside an open group, a reducer rejection reverts the _whole_ group and closes it. The store rethrows it as `TreeOpError`, and a later `endGroup` would throw `no-group`.
  - Autosave observes only while no group is open, and `runGrouped` is synchronous.
  - `rename` changes metadata only; it is not a TreeOp and not undoable.
- **Editor and session.**
  - The library creates new maps titled `新导图`.
  - The editor's session-expiry notice is `登录已过期，请在新标签页重新登录后继续编辑` (account-auth).
  - Every non-GET API route calls `requireJson` (415) and `requireUser` (401, including Session binding mismatch).
- **Environment.** `src/shared/env.ts` validates env with a `z.object` and knows no AI variable. `.env.example` leaves keys empty, and the documented setup is `cp .env.example .env`.
- **Verification surfaces.**
  - `constraints.yaml` reserves `/api/ai/generate` as "pending (M3)".
  - CI layer3 runs `pnpm dev:bg && pnpm smoke` with no AI env. `scripts/dev-bg.sh` runs `pnpm dev`, and Next loads `.env`; variables already in the process environment win.
  - The CI e2e gate rejects any skipped test (`ci-e2e-results`).
  - Playwright starts its own server via `scripts/e2e-server.mjs` (decision 0026).
- **Observability.** No code in `src/` creates OpenTelemetry spans. `@opentelemetry/api` is not a direct dependency.
- **Claude API facts**, checked against the API reference on 2026-11-26:
  - `claude-opus-5-5` rejects forced `tool_choice` with a 400, and its effort defaults to `medium`.
  - `strict: true` is a top-level tool field.
  - `eager_input_streaming: true` makes the client responsible for validating the parsed input.
  - `fallbacks: "default"` needs `client.beta.messages` plus the beta `server-side-fallback-2026-07-01`. TECH §5.2 says `client.messages.stream()`.
  - A tool-calling model stops with `tool_use` and waits for results.
- **Provider probes** against dmxapi.cn on 2026-11-26 (one sample each, scripts outside the repo). Topic "学习 TypeScript", Generate contract and ack loop:
  - The Anthropic-native endpoint `https://www.dmxapi.cn/v1/messages` serves streaming with strict tools and eager input streaming.
  - `deepseek-v4.1-flash-1017` makes **one** root call in turn 1, ending at about 4.6 s.
  - In turn 2 it makes all first-level calls in parallel.
  - Without a server-side stop it then spends an empty third turn (+3.6 s).
  - Completion took 9.6 s via the Anthropic-native endpoint and 12.7 s via the OpenAI-compatible one. All inputs were valid (33–42 nodes).
  - `claude-haiku-5-5` once returned a truncated tool input.
  - The owner then relaxed PRD §6's first-node target to < 6 s and chose the Anthropic-native endpoint as the platform default.

## Goals / Non-Goals

**Goals:**

- Build one provider-neutral server path from a topic to a stream of validated TreeOps. Validation, id remapping, caps and loop stopping each have exactly one implementation, shared by every adapter (AGENTS Code Canonicality).
- Reuse the M1/M2 machinery unchanged: the reducer, History groups and autosave. Add no new TreeOp kind.
- Verify only with the mock provider or transport fixtures. A real key is used only by the opt-in live run (decision 0039).

**Non-Goals:**

Each item is ablated or out of scope; its revival trigger is in parentheses.

- JSON-mode channel, capability flags and the capability router (M3.5, when a second output channel exists).
- `Provider.listModels()` (M3.5 settings page model picker).
- Ollama adapter, user-supplied keys, encrypted `user_providers` and the settings page (M3.5).
- `ai_usage` table and daily quota with 429 (M4; required before the first deployment). M3 has per-request caps only.
- A mode enum for the three AI entry modes (M4, when Grow lands).
- Node-level Grow, text import and chat panel (M4/M5).
- A provider or model switch in the UI (M3.5).
- Server-side persistence of generated maps. The route never reads or writes maps; saving stays the client's autosave (decision 0003).
- Regenerating a non-empty map, or generating under a selected node (M4 Grow).
- Recorded real-provider fixtures (owner decision: hand-authored wire fixtures).
- OpenTelemetry spans for generation. M3 logs one structured `ai.generate` event (revival: the first span in `src/`, when a tracing backend is in use).
- A deployment (M3 is local acceptance only, like M2).

## Decisions

### D1. Module layout and the Provider port

- **`ai/domain/`** (pure: zod only) holds:
  - the Generate tool input schema `{ parentId: string, children: [{ id: string, text: string }] }` (strict, children ≥ 1, text non-empty);
  - the caps type and production caps `{ depth: 2, perParent: 7, total: 60 }`;
  - `ProviderOutputError` / `ProviderTransportError` / `ProviderRefusedError`;
  - the error-code union `timeout | provider-error | invalid-output | refused`.

  The domain never names `TreeOp`.

- **`ai/acl/map.ts`** re-exports `TreeOp`, `parseTreeOp` and the node types from map's domain.
- **`ai/application/`** may import its own `acl/`. It holds:
  - the `Provider` port: `streamOps(request: GenerateRequest) → AsyncIterable<TreeOp>`, where `GenerateRequest = { topic, rootId, signal }`;
  - the op assembler (D2);
  - the turn-loop helper (D3), the single implementation of turn counting and stopping;
  - the Generate prompt (D6);
  - `generate(provider, request, { timeoutMs })` (D5).
- **`ai/infrastructure/providers/`** holds `anthropic.ts` (`@anthropic-ai/sdk`), `openai-compatible.ts` (Vercel AI SDK `@ai-sdk/openai-compatible`) and `mock.ts`. Each adapter receives its transport by injection (`fetch` or an SDK client), and each uses the application assembler (through the loop helper), prompt, tool definition and loop helper.
- **`src/app/server/ai-services.ts`** is the composition root: env → one provider or `undefined`. Nothing else imports adapters.
- **Alternatives rejected:**
  - Port and assembler in `domain/` (needs `TreeOp` → violates `domain-is-pure`).
  - Relaxing `domain-is-pure` for same-context `acl/` (a gate edit with no product benefit).
  - Adapters yielding raw tool calls (decision 0002 fixes `streamOps → TreeOp`).

### D2. Generate protocol and the op assembler

- The model sees one tool, `add_children`. The prompt tells it to:
  - call the tool once per parent: root first, then every first-level branch in parallel in one turn;
  - name every child with a short temporary id, unique in the session;
  - use `root` for the primary root.
- The **op assembler** is a stateful object created per attempt with `{ rootId, idFactory, caps }`. It tracks _emitted_ and _dropped_ temporary ids and their depths. Each complete tool input is handled as follows:
  1. **Validation.** Strict Zod. A failure is `ProviderOutputError`; it is never repaired.
  2. **Parent resolution.**
     - `root` → `rootId` (depth 0); an emitted id → its server id and depth.
     - A **dropped** id, or a descendant of one → the call is dropped silently, and its children are recorded as dropped.
     - Any other id → `ProviderOutputError` (unknown parent).
  3. **Duplicates.** A temporary id already emitted or dropped → `ProviderOutputError`.
  4. **Caps (truncation, never rejection; TECH §5.3).**
     - Children of a parent at depth 2 are dropped.
     - Children beyond 7 per parent, counted across calls, are dropped.
     - Children beyond 60 in total are dropped.
     - Dropped children's temporary ids are recorded as dropped.
  5. **Output.** If at least one child survives, the assembler returns `{ op: 'add_children', parentId, children }` with fresh `idFactory()` ids and no `index`, checked by `parseTreeOp`. Otherwise it returns nothing.
- The assembler also reports `complete` once every emitted first-level node has received at least one child, and there is at least one first-level node.
- The 60 total cannot be reached with depth 2 × 7 per parent (56). It is defence in depth. Tests prove it with injected caps.
- Text longer than 40 characters is kept: it is a prompt constraint, not a server cap.
- The client applies the root text itself (D9). The server never emits it, so the route stays stateless.
- **Rejected:**
  - One nested tree: it arrives only at the end of the model's output.
  - Partial-JSON node-by-node streaming: it applies unvalidated input.
  - Trusting model ids: a collision becomes a whole-group revert (Context).

### D3. Tool-result loop and stopping

Each adapter runs at most **4 model turns per attempt**.

- **Per turn:**
  - Every completed tool call is validated and assembled as it arrives, and its op is yielded at once.
  - When the turn ends on tool use, the next turn appends the assistant turn plus an `ok` tool result for every call.
- **Stopping.** The attempt ends normally (no further turn) when any of these holds:
  - the model ends naturally (`end_turn` / `stop`);
  - the assembler reports `complete` at the end of a turn (this saves the empty third turn the probes showed);
  - 4 turns have run.
- **Zero ops.** An attempt that ends normally with zero ops is a `ProviderOutputError` (the model answered without calling the tool).
- **One loop (task 1.3).** `runTurnLoop` in `ai/application/turn-loop.ts` is the only code that counts turns and decides to stop. It creates the attempt's assembler from `{ rootId, idFactory, caps }`, checks the abort signal before each turn, and calls the adapter's `runTurn(turn)` once per turn. `runTurn` streams the turn's completed tool inputs (already JSON-parsed) and finally reports how the turn ended: naturally, or on tool use. The helper assembles each input, yields the op at once, and requests the next turn only when the turn ended on tool use, the assembler is not `complete` and fewer than 4 turns have run. Each adapter's `runTurn` closure keeps its own message history and encodes the `ok` acknowledgements of the previous turn's calls; it never decides whether another turn runs.
  - Each op is yielded as soon as its input is assembled; the stop rule is checked only at the end of a turn, so ops arriving after `complete` within the same turn are still yielded.
  - Whenever the signal is aborted, the attempt rejects with `signal.reason`: before a turn, between a turn's items, when a turn's `next()` rejects, and when the loop would otherwise end. It never ends normally and never surfaces another error (such as a `ProviderOutputError` or an adapter's `ProviderTransportError`) once aborted, so D5 never retries a client abort.
  - The helper closes the open turn iterator (`return()`) when it stops early: on an assembler error, on abort between items, or when its consumer stops iterating. A turn whose `next()` already rejected is not closed (as with `for await`); a rejection from `return()` itself is swallowed so the original outcome wins. Each adapter still passes `request.signal` to its transport, so a turn waiting on the network ends promptly.
  - Turn-end mapping, applied by every adapter: a natural end (`end_turn`, `stop`) and a token-cap end (`max_tokens`, `length`) whose tool inputs were all complete are `natural`; a tool-use end (`tool_use`, `tool-calls`) is `tool-use`; an unfinished tool input at the token cap is `ProviderOutputError`; a refusal (`refusal`, `content-filter`) is `ProviderRefusedError`; any other end (`error`, `interrupted`, `other`, unknown) is `ProviderTransportError`.
- **OpenAI-compatible.** One AI SDK `streamText` call per turn, with a single step (no SDK multi-step loop): the turn loop above owns stepping. The tool is declared without `execute`, so the SDK adds no tool result of its own. The adapter appends the assistant message and `ok` tool results itself before the next turn. Each completed `tool-call` part feeds the loop. The exact AI SDK API is read from the installed package before coding.
- **Claude.** One `client.beta.messages.stream` per turn. Each `tool_use` block's input, once its block stops, is `JSON.parse`d with a guard. A parse failure or a schema failure is a `ProviderOutputError`.

### D4. Request settings

- **Claude:**
  - `model: AI_MODEL`, `max_tokens: 8000` **per turn**, `output_config: { effort: 'medium' }`, `thinking` omitted;
  - the tool has `strict: true` and `eager_input_streaming: true`, and `tool_choice: { type: 'auto' }`;
  - the system prompt is one stable block with `cache_control: { type: 'ephemeral' }`; the topic goes only in the user turn;
  - `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`;
  - a final `stop_reason: refusal` → `ProviderRefusedError`; `max_tokens` with an unfinished tool input → `ProviderOutputError`;
  - client: `maxRetries: 0`, `baseURL` from `ANTHROPIC_BASE_URL` (optional; for dmxapi, `https://www.dmxapi.cn`), key from `ANTHROPIC_API_KEY`.
- **OpenAI-compatible:** `maxRetries: 0`, `baseURL` from `OPENAI_BASE_URL`, key from `OPENAI_API_KEY`, `maxOutputTokens: 8000` per step, and the same prompt and tool.
- **Worst-case output per generation:** 8000 tokens × 4 turns × 2 attempts. The 30 s limit (D5) bounds it first in practice.

### D5. `generate`: retry, timeout, abort, logging

- **Attempts.** `generate(provider, request, { timeoutMs = 30_000 })` wraps provider attempts:
  - If an attempt fails with `ProviderTransportError` or `ProviderOutputError` **before its first op was yielded**, exactly one fresh attempt runs, with a fresh assembler.
  - `ProviderRefusedError` is **not** retried: Claude already falls back server-side, and B15 limits retry to transport or validation failures.
  - A failure after the first op ends the generation with its code, and nothing is retried.
- **Abort and timeout.** One `AbortController` is linked to `request.signal` and to a `timeoutMs` timer. A timeout aborts the provider and ends with `timeout`. A client abort ends silently and never retries.
- **Error codes:**
  - `timeout`;
  - `provider-error` (transport/HTTP failure);
  - `invalid-output` (validation failure or zero ops, after the retry);
  - `refused`.
- **What the server sends.** Each terminal error carries a fixed English diagnostic `message` (for API consumers and logs). Provider bodies, keys and the topic are never forwarded or logged; `src/shared/logger.ts` redaction stays in force.
- **Logging.** One `info` log event, `ai.generate`, records provider id, model, attempts, op count, duration and outcome code.

### D6. Prompt

`ai/application/generate-prompt.ts` holds one unified system prompt, a constant that keeps the Claude cache prefix stable.

- **Protocol it states:** changes only through the tool; flat lists per parent; temporary ids with `root`; the root call first, then all first-level calls in parallel in one turn.
- **Content constraints it states:** two levels below the root, 3–7 children per parent, each ≤ 40 characters with no paragraphs, MECE siblings, and output language following the topic (PRD §9 resolved: one unified prompt).
- **Topic placement:** a builder places the topic only in the user turn.
- **Tool definition:** the same module exports the one wire tool definition `{ name, description, inputSchema }` that 3.2 and 3.3 send. `inputSchema` is a byte-stable literal matching 1.1's zod schema, without the keywords Claude strict tools reject (`minLength`) and without `$schema`; the assembler's zod parse remains the enforcement point.
- Adapters add no instruction text or tool definition of their own. They send `GENERATE_TOOL_DEFINITION` unchanged in `name`, `description` and schema content; the only allowed adaptations are the field mapping each SDK needs (Claude `input_schema`; AI SDK `tools` record key and `jsonSchema(...)`), the D4 transport flags (`strict`, `eager_input_streaming`) and copying a readonly array where an SDK type demands a mutable one.

### D7. Configuration

- **New fields.** `src/shared/env.ts` gains optional `AI_PROVIDER` (`anthropic | openai-compatible | mock`), `AI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY` and `OPENAI_BASE_URL`.
- **Empty strings mean unset** for all of them; preprocessing turns `''` into `undefined`.
- **Cross-field rules.** A `superRefine` throws at load and names the variable:
  - `anthropic` requires `ANTHROPIC_API_KEY` and `AI_MODEL`;
  - `openai-compatible` requires `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `AI_MODEL`;
  - `mock` with `NODE_ENV=production` is rejected.
- **Unset provider.** With `AI_PROVIDER` unset, the AI service is `undefined` and the route answers 503 `ai-unavailable`. A copy of `.env.example` therefore loads.
- **`.env.example`** keeps `AI_PROVIDER=` empty. The platform default appears only in comments: `AI_PROVIDER=anthropic`, `ANTHROPIC_BASE_URL=https://www.dmxapi.cn`, `AI_MODEL=deepseek-v4.1-flash-1017`, with the OpenAI-compatible alternative alongside. The misleading `OLLAMA_BASE_URL` line is dropped until M3.5.
- **Verification servers force the mock.** `scripts/dev-bg.sh` (the verification server behind `pnpm smoke`, the Verification Matrix and CI layer3) exports `AI_PROVIDER=mock` before `pnpm dev`. Process env wins over `.env`, so smoke never calls a real provider, locally or in CI. The owner's foreground `pnpm dev` reads `.env` as configured.

### D8. Route `POST /api/ai/generate`

- **Checks, in the order the existing JSON routes use (`requireJson`, then `requireUser`).** None of them calls a provider.
  1. `requireJson` → 415 for a non-JSON content type.
  2. `requireUser` → 401 `unauthenticated` without a session, or with a present Session binding header that differs from the session user, including an empty but present header (account-auth).
  3. The body is a strict Zod object `{ topic, rootId }`:
     - `topic` is a string of at most 200 UTF-16 code units, counted on the raw string, and not blank after trimming;
     - `rootId` is non-empty;
     - otherwise → 400 `invalid-input`.
  4. No configured provider → 503 `ai-unavailable`.
- **Success** is `200 text/event-stream` with `cache-control: no-store`. The frames are:
  - `event: op` + `data: <TreeOp>`;
  - `event: error` + `data: {"code","message"}` (terminal);
  - `event: done` + `data: {}` (terminal).
  - Exactly one terminal event ends the stream.
- **Abort.** `request.signal` is passed as `GenerateRequest.signal`, so a disconnect aborts the provider call. The handler is composition only.
- **Contract surfaces.**
  - `schemas/openapi.yaml` gains the path, the request body, the 400/401/415/503 errors and the event schemas, and the snapshot is updated.
  - `smoke/api.hurl` gains 401, 400 and a mock 200 stream ending in `done`.
  - `constraints.yaml` flips the route to covered.
- **References.** Next.js 16 route-handler streaming and abort behaviour follow `node_modules/next/dist/docs/` (AGENTS note 6).

### D9. Editor generation session

- **Op source port.** The map context gets a port `GenerateSource { generate(input: { topic, rootId }, signal): AsyncIterable<TreeOp> }` in `map/domain`. Its browser adapter is `map/infrastructure/ai/http-generate-source.ts`.
  - It POSTs JSON and sends the Session binding header like the map adapter (decision 0028).
  - It parses SSE frames (frames may split across chunks) and validates each `op` payload with `parseTreeOp`.
  - It throws `GenerateError(code)` with codes `timeout`, `provider-error`, `invalid-output`, `refused`, `ai-unavailable`, `unauthenticated` and `network`. An `error` frame gives its code; a stream ending without a terminal frame and an unexpected HTTP status both give `provider-error`; a 503 gives `ai-unavailable`; a 401 gives `unauthenticated`; a fetch failure gives `network`.
  - It ignores the server's diagnostic message.
  - It is composed in the editor's `src/app` provider beside the map repository (`src/app/providers/MapRepositoryProvider.tsx` pattern). Components never import infrastructure.
- **Contract between the contexts.** Map and ai meet only at the HTTP contract. CONTEXT's map row changes to "consumes TreeOps from `/api/ai/generate` over HTTP" in the same PR as the adapter.
- **Store action `generate(topic)`.**
  1. Refuse with `EditorStoreError('generating')` while a generation runs. Refuse with `EditorStoreError('not-empty')` unless the map is empty: the primary root has no children and there are no floating roots.
  2. Trim the topic. Refuse when it is blank or longer than 200 code units (the UI disables submit first).
  3. Set `generating = true`, then call `beginGroup('generate')`.
  4. **On the first op:** dispatch `update_node { id: rootId, text: topic }`. If the title is still `新导图`, apply `rename(topic)` and remember the previous title. Then dispatch the op. Later ops are dispatched as they arrive.
  5. **On every end** (completion, Stop/abort, error, unmount, pagehide): call `endGroup()` and clear `generating`.
     - With zero ops applied, the group is empty: nothing is pushed, and the map and title are untouched.
     - Unmount and pagehide abort first, then end, then run the existing flush.
- **Notice table.** This client-side table is the single source of user-visible text:

  | code             | text                              |
  | ---------------- | --------------------------------- |
  | `timeout`        | `生成超时，请重试`                |
  | `provider-error` | `AI 服务出错，请稍后重试`         |
  | `invalid-output` | `AI 返回的内容无法使用，请重试`   |
  | `refused`        | `AI 拒绝了这个主题，请换一个主题` |
  | `network`        | `网络连接失败，请检查网络后重试`  |
  - A failure with zero ops applied shows `生成失败：<text>`; with ops applied, `生成中断：<text>`. Stop shows nothing.
  - `ai-unavailable` switches the form to `AI 未配置` for the page session.
  - `unauthenticated` shows the account-auth session-expiry notice and does not navigate.

- **Reducer rejection.** A reducer rejection of a streamed op (`TreeOpError` from dispatch) means History has already reverted and closed the group.
  - The session must **not** call `endGroup`. It aborts the request, restores the remembered title if it changed it, clears `generating` and shows `生成失败：AI 返回的内容无法使用，请重试`.
  - D2 makes this a defect path.
- **Lock.**
  - While `generating`, the store's tree-changing actions refuse: dispatch outside the session, createNode, delete, move, color, note, title edits, undo and redo. The store is the single lock authority.
  - Keyboard, menu, drag and toolbar handlers check `generating` and do nothing, so no refusal surfaces as an uncaught error.
  - Pan, zoom and selection remain available.
- **UI.** `EditorView` renders the topic form over the empty map: an input, Generate (disabled while the trimmed topic is invalid or a generation runs), and the `AI 未配置` state. The form disappears once the map is non-empty. Stop is a separate control rendered for the whole generation, including after the first op.

### D10. Layout transitions

- **Motion.** Node wrappers get `transition: transform 200ms ease-out`. Node content gets a 200 ms opacity fade-in on mount (from 0 to 1).
- **Drag.** A wrapper class removes the transition while a node drag gesture is live, so the drag preview tracks the pointer.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` disables both.
- **Unaffected.** Measured-content framing (decision 0033) measures size, not position, and viewport fit/pan is not animated.
- **Playwright.** The default `playwright.config.ts` project sets `reducedMotion: 'reduce'`, so existing position assertions never sample mid-transition. One dedicated spec uses `reducedMotion: 'no-preference'` to assert the transition and fade styles and the settled final boxes.
- **Rejected:** JS position interpolation (per-frame layout work and a second position authority).

### D11. Mock provider and live acceptance

- **Mock provider.**
  - It is deterministic: 4 first-level children, then 3 under each (5 ops, 16 nodes), emitted through the application assembler.
  - The per-op delay is injected; composition uses 150 ms.
  - Reserved topics select scenarios:
    - `mock:error-after-2`: two ops, then a transport error → `provider-error`;
    - `mock:invalid-first`: invalid output on every attempt;
    - `mock:refused`: a refusal.
  - It is rejected in production (D7).
- **Live acceptance.**
  - `e2e/ai-live.spec.ts` is excluded from collection unless `E2E_AI_LIVE=1`: `playwright.config.ts` adds it to `testIgnore` otherwise. The default run therefore has no skipped test, and the zero-skip gate is untouched.
  - `pnpm e2e:live` runs `E2E_AI_LIVE=1` with only that spec.
  - `scripts/e2e-server.mjs` forces `AI_PROVIDER=mock` unless `E2E_AI_LIVE=1`. With live mode it passes the `.env` AI variables through; a variable already in the process environment wins over `.env`, so a mock rehearsal never reaches a real provider. It exits non-zero when `E2E_AI_LIVE=1` and `CI=true`.
  - The CI refusal is proven by a fixture in `scripts/test-guardrails.sh`, which already runs on every PR and weekly. It runs the server script with both variables and asserts a non-zero exit before any server or provider starts.
  - The live spec asserts:
    - the first generated node is visible < 6 s after submit;
    - the generation completes without an error notice < 10 s after submit, with a node two levels below the root;
    - depth ≤ 2.
  - It is run once with the platform default (Anthropic-native, `deepseek-v4.1-flash-1017`), once with `AI_PROVIDER=openai-compatible` and the same model, and once with a Claude model through dmxapi's Anthropic-native endpoint (PRD §8 "Claude 和 OpenAI 兼容接口都能跑").
- **Docs.** Decision 0039 records the exception. When it moves to implemented, AGENTS Important Development Note 5, the AGENTS Critical Paths `providers/` row, AGENTS "What agents may not do", the CONTEXT forbidden-logic row and decision 0002's Consequences are cross-linked in the same PR.

### D12. Documentation lands with the code

TECH is an oracle during planning: this change did not edit it to fit (grill F2). Each implementation slice updates the docs its own work makes stale, in the same PR (AGENTS documentation discipline):

- **Provider slices:** TECH §5.1–§5.3 (flat per-parent calls, temporary-id remap, ack loop with the `complete` stop, beta endpoint for `fallbacks`, no `listModels` or capability flags until M3.5).
- **Route slice:** TECH §7 directory lines and §8.
- **Browser adapter slice:** the CONTEXT map row.
- **Editor UI slice:** README Known Limitations (no quota, local only, AI optional).

### Sketch seams under test

- **The op assembler and `generate()` in `ai/application`, with injected ids, caps, clock and fake providers.** They are the single implementation of validation, remapping, caps, stopping, retry and timeout. All are deterministic here, including the unreachable-in-production total cap.
- **`Provider.streamOps` via a shared contract suite (`describeProviderContract(name, makeHarness)` over canonical per-turn inputs), run against all three adapters with injected hand-authored wire fixtures.** It proves op validity, fresh ids, multi-turn continuation across temporary ids, the turn limit and abort while the transport waits for every transport. Acknowledgements are request-body details, proven by each real adapter's own tests (3.2, 3.3). It mirrors the `describeMapRepositoryContract` precedent.
- **The route handler `POST(request)` over the mock composition, plus `smoke/api.hurl`.** This is the public HTTP contract; the handler is composition only.
- **The editor store `generate` action over a fake `GenerateSource`.** It covers grouping, deferral, lock, Stop, errors, title and the empty-map rule without a browser. The real HTTP adapter and UI are proven once by the mock Playwright walk.

## Not yet specified

- Generation quality beyond shape: whether skeletons are _good_ (MECE, coverage) has no oracle yet. PRD §7 lists "AI 生成内容被手动修改的比例" as a post-launch metric, but M3 has no eval set or rubric for content.

## Risks / Trade-offs

- [The model ignores "one parent per call" or repeats ids] → strict tool schemas, Zod at the assembler, and one retry before the first op. After the first op, the generation stops and keeps partial results. Probes showed valid inputs from deepseek.
- [Latency: the probes completed in 9.6 s (Anthropic-native) and 12.7 s (OpenAI-compatible) against the 10 s target, with one sample each] → the platform default is the faster endpoint, and the `complete` stop removes the empty turn. The live spec measures both endpoints. A miss is reported to the owner as an acceptance failure, not tuned silently.
- [A truncated tool input (seen once with Claude Haiku)] → it becomes `invalid-output`, retried before the first op. After the first op, the generation is interrupted and keeps partial results.
- [The AI SDK API differs from this description (single-step `streamText`, a tool without `execute`, manually appended tool results, tool-call parts)] → the adapter slice reads the installed package docs before coding. The contract suite is the arbiter.
- [Global transitions make e2e timing flaky] → the default `reducedMotion: 'reduce'` plus one motion-enabled spec (D10).
- [No quota: a runaway client bills the platform key] → there is no deployment in M3. Each generation is capped (60 nodes, 4 turns × 8000 tokens, 2 attempts, 30 s), and needs a signed-in user and an empty map. Quota is a hard prerequisite of the first deployment (CONTEXT annotation).
- [The live runs spend real money] → they are opt-in only, refused under CI, and each makes a single generation per provider configuration.

## Migration Plan

No data migration is needed, and `schemaVersion` stays 1. Rollout follows `tasks.md` Ordering. Rollback is a `git revert` of the slice. With `AI_PROVIDER` unset, the feature is inert.
