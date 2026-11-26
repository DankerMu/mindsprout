# Proposal

## Why

PRD §8 M3 acceptance is "输入主题流式长出骨架，Claude 和 OpenAI 兼容接口都能跑；三层导图 10 秒内完成". Today `src/contexts/ai/` is empty: an empty map can only be filled by hand. M1 and M2 are complete, so the TreeOp protocol (decision 0003), the undo groups and the cloud autosave are ready for the first AI producer. The owner's Stage 1 grill (2026-11-26, 24 branches, 2 open items) fixed the shape. Generation uses the tool-calling channel only. The platform provider is an OpenAI-compatible endpoint (dmxapi.cn) set by server environment. Quota is deferred to M4, and nothing is deployed in M3.

## What Changes

- **Provider layer (new, `ai` context).** It exposes one port: `Provider.streamOps(request) → AsyncIterable<TreeOp>` (decision 0002). Three adapters implement it:
  - **OpenAI-compatible:** Vercel AI SDK with `@ai-sdk/openai-compatible`, configurable base URL. The platform default points at dmxapi.cn.
  - **Claude direct:** `@anthropic-ai/sdk`, configurable base URL, strict tools with `tool_choice: auto`, `eager_input_streaming`, effort `medium`, a cached system prompt and server-side `fallbacks: "default"`.
  - **Mock:** a deterministic adapter for unit, smoke and e2e runs. It is refused in production.
- **Generate protocol (new).**
  - The model calls one `add_children` tool per parent with a flat list of children. It names them with short temporary ids; `root` stands for the primary root.
  - The server validates each complete call with Zod and checks that its parent reference is known. It replaces temporary ids with fresh nanoids and only then emits the call as one TreeOp.
  - Server caps: depth 2 below the root, 7 children per parent, 60 nodes in total. Ops beyond a cap are dropped and the stream ends normally.
  - Retry: built-in SDK retries are off. The whole request is retried once, only while no op has been emitted yet.
  - Timeout: the total time limit is 30 s.
- **Configuration (new).**
  - `AI_PROVIDER` (`openai-compatible | anthropic | mock`) and `AI_MODEL` select one platform provider. Keys and base URLs are server-only env.
  - AI is optional: when `AI_PROVIDER` is unset the app runs and generation answers 503 `ai-unavailable`.
  - A partially configured provider fails loudly at load.
  - No model id is hard-coded.
- **`POST /api/ai/generate` (new route).**
  - Signed-in only and stateless: the body is `{ topic, rootId }`, and the route never reads maps or the database.
  - Errors before the stream starts are JSON (400, 401, 503).
  - The `text/event-stream` carries `op`, `error` and `done` events. A client disconnect aborts the provider call.
  - It is registered in `schemas/openapi.yaml` and `smoke/api.hurl` (mock provider).
- **Editor topic generation (new).**
  - The editor shows a topic input when the map is empty: the primary root has no children and there are no floating roots.
  - Submitting starts one `generate` undo group. The group sets the root text to the topic, then dispatches each streamed op through the reducer.
  - While generating, tree editing, undo/redo and drag are locked, and the user can press Stop.
  - Stop, a stream error, unmount and pagehide all keep the ops already applied. They close the group as one undo step, then save normally; an error also shows a notice.
  - A map still titled `新导图` is retitled to the topic. The title is metadata, so this is not undoable.
- **Layout transitions (modified, `canvas-layout`).**
  - Every layout change animates node positions with a short transform transition, and newly mounted nodes fade in.
  - The drag preview is excluded, and `prefers-reduced-motion` disables both.
- **Live acceptance exception (process).**
  - `pnpm e2e` stays on the mock provider.
  - One live Playwright spec runs only with `E2E_AI_LIVE=1`. It uses the owner's `.env` key and `deepseek-v4.1-flash-1017` and asserts first node < 3 s and three layers < 10 s.
  - Live mode is refused when `CI=true`, and Vitest never calls a real key.
  - A decision record amends the AGENTS/CONTEXT "no real paid key" rule to exactly this exception.
- **Vocabulary.** The glossary gains **Generate** (one-shot topic generation into an empty map), as distinct from node-level **Grow**. The CONTEXT open question on naming the three modes moves to M4, when a second mode lands.
- **Dependencies (new).** `ai`, `@ai-sdk/openai-compatible` and `@anthropic-ai/sdk`, added in their own slice with the license audit.

## Capabilities

### New Capabilities

- `ai-provider`: the Provider port and its three adapters, environment configuration, the Generate tool protocol, server-side output validation with id remapping and caps, prompt assembly, retry and timeout.
- `ai-generate-api`: the `POST /api/ai/generate` HTTP contract: authentication, body validation, pre-stream errors, the SSE event stream, disconnect abort and the published contract.
- `topic-generation`: the editor's empty-map topic input, streaming application inside one undo group, editing lock, Stop, failure and leave-page handling, and title adoption.
- `ai-live-acceptance`: the opt-in live Playwright run against a real provider and its isolation from Vitest, default e2e and CI.

### Modified Capabilities

- `canvas-layout`: layout changes are animated and new nodes fade in, with the drag preview and reduced motion excluded.

## Impact

- **Code:**
  - `src/contexts/ai/{domain,application,infrastructure/providers,acl}` (new; `acl/map.ts` re-exports the TreeOp schema).
  - `src/app/api/ai/generate/route.ts` and `src/app/server/` composition.
  - Editor store and editor view: the topic input, generation session and lock.
  - Canvas node rendering for the transitions.
  - `src/shared/env.ts` and `.env.example`.
- **Critical paths:** `src/contexts/ai/infrastructure/providers/`, `src/app/api/` and `src/app/server/`. These need full cross-review, mock-provider tests, an `openapi.yaml` update and a smoke entry. `constraints.yaml` changes because `/api/ai/generate` moves from pending to covered (gate integrity; `pnpm test:guardrails`).
- **Dependencies:** three new runtime packages. They need lockfile pairing and the installed-license audit.
- **Docs:** TECH §5 is reconciled with the shipped protocol (flat per-parent calls, temporary-id remap, beta endpoint for `fallbacks`). Glossary, CONTEXT, AGENTS and README are updated. There is a new decision record for the live-key exception.
- **Not affected:** database schema, RLS, the account context and map persistence formats. `schemaVersion` stays 1.
