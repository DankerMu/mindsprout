# Tasks

## Conventions

**Module boundaries.** Follow `AGENTS.md ## Directory Map` and design D1:

- `ai/domain` is pure: zod only, and it never names TreeOp.
- `ai/application` reaches map only through `src/contexts/ai/acl/map.ts`.
- The browser reaches ai only through `/api/ai/generate`.
- Components never import infrastructure. Adapters are composed in `src/app`.

**Tests and docs.**

- TDD is required, and coverage is ≥ 90% per file. Every new `src/**` file ships its paired test.
- Each task lands the docs its own work makes stale (design D12).
- **Critical Paths.** These are `src/contexts/ai/infrastructure/providers/`, `src/app/api/`, `src/app/server/`, `constraints.yaml`, `AGENTS.md`, `scripts/test-guardrails.sh` and `.github/workflows/`. A task that edits one flags it in its PR. Where gates are touched, the PR attaches `pnpm test:guardrails` evidence.

**No real key.** Every task verifies with the mock provider or injected wire fixtures. The only exception is 7.3, the opt-in live runs (decision 0039).

**Verification tiers.**

| Tier     | What it is                                                                                  |
| -------- | ------------------------------------------------------------------------------------------- |
| unit     | Vitest in node or jsdom; the per-file coverage gate.                                        |
| contract | `pnpm test:contract` (OpenAPI snapshot).                                                    |
| smoke    | `pnpm dev:bg && pnpm smoke` (hurl); the verification server forces the mock provider (4.3). |
| e2e      | `pnpm e2e` (Playwright, own server and database, mock provider).                            |
| live     | `pnpm e2e:live`, local only, with the owner's key (7.3).                                    |

**Scenario naming.** A task's verify clause names the spec scenarios it proves.

**Ordering.** Every edge below is a real dependency:

1. 1.1, 2.1, 5.1 and 6.1 have no prerequisites. 5.1 defines its own error codes in map, because map never imports ai.
2. 1.2 needs 1.1. 2.2 needs 1.1. 3.1 needs 1.1.
3. 3.2 needs 1.2 and 3.1. 3.3 needs 1.2 and 3.1. 3.4 needs 3.3.
4. 4.1 needs 2.1, 3.1, 3.2 and 3.4. 4.2 needs 2.2 and 4.1. 4.3 needs 4.2.
5. 5.2 needs 5.1. 5.3 needs 5.2. 5.4 needs 5.2. 5.5 needs 4.2, 5.3 and 5.4.
6. 7.1 needs 5.5. 7.2 needs 7.1. 7.3 needs every other task.

## 1. AI core

- [ ] 1.1 Add the ai domain, acl and op assembler (design D1, D2).
  - `ai/domain/` gets:
    - the strict Generate tool input schema;
    - the caps type and production caps;
    - `ProviderOutputError`, `ProviderTransportError` and `ProviderRefusedError`, with the error-code union.
  - `src/contexts/ai/acl/map.ts` re-exports `TreeOp`, `parseTreeOp` and the node types.
  - `ai/application/` gets:
    - the `Provider` port and `GenerateRequest { topic, rootId, signal }`;
    - the op assembler with injected `idFactory` and caps, emitted/dropped id tracking and the `complete` signal.
  - Verify (unit): ai-provider "Model temporary ids are replaced", "Unknown parent is invalid output", "Duplicate temporary id is invalid output", "Malformed tool input is invalid output", "Third level dropped", "Per-parent overflow truncated", "Children of a truncated node dropped" and "Total bound" (injected total 5). `complete` is reported only once every first-level node has children. Every emitted op passes map's `parseTreeOp`. `pnpm boundaries` passes.
- [ ] 1.2 Add the unified Generate prompt and its request builder in `ai/application/generate-prompt.ts` (design D6).
  - Verify (unit): ai-provider "Instruction content". The builder places the topic only in the user turn.

Suggested fixture level: compact - pure logic with no I/O; the assembler is the single model-output safety net, but every branch is deterministic under unit tests.
Minimal mergeable slice: 1.1 - the domain, acl and assembler are green alone; 1.2 is an additive constant that depends only on the tool name fixed in 1.1.

## 2. Configuration and generate use case

- [ ] 2.1 Extend `src/shared/env.ts` with the AI fields, empty-means-unset preprocessing and the cross-field rules (design D7).
  - Rewrite the `.env.example` AI block:
    - leave `AI_PROVIDER=` empty;
    - put the platform default in comments: `anthropic`, `https://www.dmxapi.cn`, `deepseek-v4.1-flash-1017`, plus the OpenAI-compatible alternative;
    - drop `OLLAMA_BASE_URL`.
  - Verify (unit): ai-provider "AI not configured", "Example environment loads" (parses the real `.env.example` file), "Partially configured provider fails at load" (each missing or empty variable is named), "Claude provider configuration" and "Mock refused in production". Existing env tests pass.
- [ ] 2.2 Add `generate(provider, request, { timeoutMs })` in `ai/application/` with the `ai.generate` log event (design D5).
  - Verify (unit, fake providers, Vitest fake timers): ai-provider "Retry succeeds", "Retry exhausted", "Failure after first op", "Refusal", "No tool call is invalid output" (as a zero-op attempt) and "Slow provider". A client abort ends silently without retry. A spy logger proves the logging half of "Provider HTTP error body withheld": no topic, body or key in any entry.

Suggested fixture level: expanded - production configuration loaded on every account request, and the retry/timeout rules are billing guards (a wrong retry doubles spend).
Minimal mergeable slice: 2.1 - env validation is self-contained; 2.2 depends only on 1.1 and merges independently of 2.1.

## 3. Provider adapters

- [ ] 3.1 Add the mock provider and the shared provider contract suite (design D11, Seams).
  - `describeProviderContract(makeProvider, fixtures)` lives in test support. It covers op validity, fresh ids, the two-turn loop with the `complete` stop, the turn limit and abort.
  - Verify (unit): the suite passes for the mock, plus ai-provider "Deterministic skeleton" and "Scripted mid-stream error". `mock:invalid-first` gives invalid output on every attempt, and `mock:refused` refuses.
- [ ] 3.2 Add the OpenAI-compatible adapter (design D3, D4), with `ai` and `@ai-sdk/openai-compatible` as dependencies.
  - Read the installed package docs before coding.
  - Inject `fetch`.
  - Update TECH §5.1 and §5.3 to the shipped protocol (design D12).
  - Verify (unit with hand-authored chat-completions SSE fixtures):
    - `describeProviderContract` passes;
    - ai-provider "Two-turn skeleton" and "Turn limit";
    - the request body carries the prompt constant, the tool schema, the topic only in the user turn and `max_tokens` 8000;
    - a 500 fixture is requested exactly once and surfaces as `ProviderTransportError` without its body;
    - a truncated tool-call argument is `ProviderOutputError`.
  - Verify (gates): `pnpm licenses:check`, `pnpm dead-code` and `pnpm install --frozen-lockfile` pass.
- [ ] 3.3 Add the Claude adapter's request and turn loop (design D3, D4), with `@anthropic-ai/sdk` as a dependency.
  - Inject the client transport.
  - Use `client.beta.messages.stream` with the fallback beta, a `strict` + `eager_input_streaming` tool with `tool_choice: auto`, effort `medium`, a cached system block, `max_tokens` 8000, `maxRetries` 0 and an optional `baseURL`.
  - Verify (unit with hand-authored Messages SSE fixtures):
    - `describeProviderContract` passes;
    - "Two-turn skeleton" and "Turn limit";
    - the request body asserts every setting above, no forced `tool_choice`, and the same prompt and tool as 3.2 ("Same instruction for real adapters");
    - a `tool_use` turn is followed by `tool_result` `ok` blocks.
  - Verify (gates): `pnpm licenses:check`, `pnpm dead-code` and `pnpm install --frozen-lockfile` pass.
- [ ] 3.4 Add the Claude adapter's failure paths.
  - Update TECH §5.2 with the beta endpoint for `fallbacks` and the ack loop.
  - Verify (unit, fixtures): `stop_reason: refusal` gives `ProviderRefusedError`. An unfinished tool input at `max_tokens` and malformed input JSON each give `ProviderOutputError`. A 500 fixture is requested exactly once and gives `ProviderTransportError` without its body ("Provider HTTP error body withheld").

Suggested fixture level: expanded - Critical Path (`providers/`: billing and key handling); wire-format fidelity rests on hand-authored fixtures, which review must check against the vendor docs.
Minimal mergeable slice: 3.1 - the mock and the contract suite are green alone and unblock the route; 3.2 and 3.3 are independent of each other; 3.4 adds only failure handling on top of 3.3.

## 4. Generate route

- [ ] 4.1 Add `src/app/server/ai-services.ts` (env → one provider or `undefined`; mock pacing 150 ms).
  - Verify (unit): each `AI_PROVIDER` value yields the matching adapter, configured from env. Unset yields `undefined`. The mock is paced at 150 ms per op.
- [ ] 4.2 Add `src/app/api/ai/generate/route.ts` (design D8).
  - Read the Next.js 16 route-handler streaming guide first.
  - Update `schemas/openapi.yaml` and its snapshot, and TECH §7 and §8 (design D12).
  - Verify (unit, the real handler over the composed mock): ai-generate-api "Form-encoded body", "Signed out", "Binding mismatch", "Empty binding", "Blank topic", "Longest topic accepted", "Oversized topic", "Unknown field", "AI disabled", "Mock generation streams to done", "Error after partial output", "Stateless" (the map store is never touched) and "Browser stops the request".
  - Verify (contract): "Contract snapshot".
- [ ] 4.3 Make `scripts/dev-bg.sh` export `AI_PROVIDER=mock`, add the three `smoke/api.hurl` entries, and flip `/api/ai/generate` in `constraints.yaml`.
  - Update the AGENTS Runtime Lifecycle line to say that the verification server always uses the mock provider.
  - Verify (smoke): `pnpm dev:bg && pnpm smoke` passes, and with a real provider configured in `.env` the 200 entry still streams mock ops (ai-generate-api "Smoke against the verification server", ai-live-acceptance "Verification server ignores the configured provider").
  - Verify (gate): `pnpm test:guardrails` passes, and the PR flags the `constraints.yaml` and `AGENTS.md` edits.

Suggested fixture level: expanded - Critical Path (`src/app/api/`, `src/app/server/`, `constraints.yaml`): a new public streaming API with auth and abort semantics.
Minimal mergeable slice: 4.1 - the composition is unit-tested alone; 4.2 adds the route and its contract; 4.3 adds smoke and the inventory flip once the route exists.

## 5. Editor topic generation

- [ ] 5.1 Add the `GenerateSource` port in `map/domain` and the browser adapter `map/infrastructure/ai/http-generate-source.ts` (design D9).
  - Update the CONTEXT map integration row (design D12).
  - Verify (unit, injected fetch with bodies split mid-frame):
    - frames reassemble;
    - an `error` frame raises its code;
    - a stream ending without a terminal frame raises `provider-error`;
    - 503 raises `ai-unavailable`, 401 raises `unauthenticated` and a fetch rejection raises `network`;
    - the binding header is sent;
    - abort stops reading.
- [ ] 5.2 Add the editor store `generate(topic)` action, first-op deferral, the reducer-rejection path and the `generating` lock (design D9).
  - Verify (unit, fake `GenerateSource`):
    - topic-generation "Root text and title", "Custom title kept", "Failure before the first op", "Undo completed generation", "Undo partial generation", "Double submit" (store refusal), "Reducer rejection", "AI unavailable", "Session expired at submit", "Network failure" and "Saved after completion" (autosave holds while generating and saves once afterwards);
    - the store halves of "Stop" and "Mid-stream error";
    - refusal on a non-empty map;
    - every listed tree action refuses while generating.
- [ ] 5.3 Make the canvas inert while generating: keyboard shortcuts, the context menu, node drag and the history toolbar check `generating` and do nothing.
  - Verify (jsdom): topic-generation "Shortcut ignored during generation" (Tab and Cmd/Ctrl+Z change nothing and raise no error) and "Pan during generation" (pan handlers stay enabled); menu edits and drag do nothing while generating.
- [ ] 5.4 Render the topic form, Stop and notices in `EditorView`.
  - Compose `HttpGenerateSource` in the `src/app` editor provider.
  - Wire unmount/pagehide abort-end-flush in `EditorSession`.
  - Add README Known Limitations: no quota, local only, AI optional (design D12).
  - Verify (jsdom): topic-generation "New map", "Non-empty map", "Invalid topic cannot be submitted", "Double submit" (one request), "AI unavailable" (shows `AI 未配置`) and the Stop button's presence while generating. Unmount during generation aborts, then flushes.
- [ ] 5.5 Make `scripts/e2e-server.mjs` force `AI_PROVIDER=mock`, and add the mock generation e2e walk.
  - Verify (e2e, mock): topic-generation "Progressive appearance", "Stop", "Mid-stream error", "Leaving saves partial result", "Saved after completion" and "Undo completed generation", with zero console errors and screenshots in `.run/ui-evidence/`; ai-live-acceptance "Default e2e" (mock server half).

Suggested fixture level: expanded - user-visible editing flow across the store, the canvas lock and the save path; a lock or group slip corrupts undo or loses edits.
Minimal mergeable slice: 5.1 - the HTTP adapter is fully unit-tested and unused until 5.4; 5.2 needs 5.1; 5.3 and 5.4 each need only 5.2; 5.5 needs the route (4.2), 5.3 and 5.4.

## 6. Layout transitions

- [ ] 6.1 Add node position transitions, the mount fade-in, drag-time transition suppression and the reduced-motion override (design D10).
  - Set Playwright's default project to `reducedMotion: 'reduce'`, and add one motion-enabled spec.
  - Verify (jsdom): the transition class is removed during a live drag gesture and restored after it.
  - Verify (e2e): canvas-layout "Sibling shifts smoothly", "New node fades in", "Drag preview is immediate" and "Reduced motion". All existing e2e specs pass unchanged.

Suggested fixture level: compact - presentation-only CSS plus test configuration; no state or persistence change, but it touches every canvas e2e.
Minimal mergeable slice: atomic - the CSS, the drag suppression and the reduced-motion default must land together, or existing position assertions sample mid-transition and flake.

## 7. Live acceptance

- [ ] 7.1 Add live gating to `scripts/e2e-server.mjs`.
  - It passes the `.env` AI variables through only when `E2E_AI_LIVE=1`.
  - It exits non-zero before starting when `E2E_AI_LIVE=1` and `CI=true`.
  - Add the matching fixture to `scripts/test-guardrails.sh`.
  - Verify: ai-live-acceptance "Live under CI refused" via `pnpm test:guardrails`. The fixture asserts the non-zero exit and that no server process or provider request started. The PR flags the guardrail script edit.
- [ ] 7.2 Add `e2e/ai-live.spec.ts`, its `testIgnore` unless `E2E_AI_LIVE=1`, and the `pnpm e2e:live` script.
  - Add the script to the AGENTS daily-commands table and to `constraints.yaml` verification.
  - Move decision 0039 to implemented, citing it in the AGENTS "What agents may not do" bullet, the CONTEXT forbidden-logic row and decision 0002's Consequences.
  - Verify: ai-live-acceptance "Default e2e" (`pnpm e2e` lists no live test and reports zero skipped); `pnpm decisions:check`, `pnpm docs:check` and `pnpm test:guardrails` pass; the PR flags the `AGENTS.md` and `constraints.yaml` edits.
- [ ] 7.3 Run the live acceptance with the owner's dmxapi key, three times:
  - the platform default (`anthropic` + `https://www.dmxapi.cn` + `deepseek-v4.1-flash-1017`);
  - `openai-compatible` with the same model;
  - a Claude model through the Anthropic-native endpoint.

  Record each run's command, exit code, first-node time and completion time in the Epic.
  - Verify: ai-live-acceptance "Live run with the platform default" and "Live run with each adapter". A missed target is reported to the owner as an acceptance failure, not tuned away.

Suggested fixture level: expanded - gate integrity (`scripts/test-guardrails.sh`, `AGENTS.md`, `constraints.yaml`) and the only path that spends a real key.
Minimal mergeable slice: 7.1 - the CI refusal and its guardrail fixture merge alone after 5.5; 7.2 adds the opt-in spec and decision on top; 7.3 is an evidence-only task after everything else.
