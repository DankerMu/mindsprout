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
