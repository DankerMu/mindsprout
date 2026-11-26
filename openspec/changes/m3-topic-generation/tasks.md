# Tasks

## Conventions

**Module boundaries.** Follow `AGENTS.md ## Directory Map` and design D1. ai reaches map only through `src/contexts/ai/acl/map.ts`. The browser reaches ai only through `/api/ai/generate`.

**Tests and docs.**

- TDD is required, and coverage is ≥ 90% per file. Every new `src/**` file ships its paired test.
- Each task lands the docs its own work calls for.
- A task that edits a Critical Path flags it in its PR and attaches `pnpm test:guardrails` evidence where gates are touched. The Critical Paths here are `src/contexts/ai/infrastructure/providers/`, `src/app/api/`, `src/app/server/`, `constraints.yaml` and `AGENTS.md`.

**No real key.** Every task verifies with the mock provider or injected wire fixtures. The only exception is the opt-in live run in 8.2 (decision 0039).

**Verification tiers.**

| Tier     | What it is                                                                    |
| -------- | ----------------------------------------------------------------------------- |
| unit     | Vitest in node or jsdom; the per-file coverage gate.                          |
| contract | `pnpm test:contract` (OpenAPI snapshot).                                      |
| smoke    | `pnpm smoke` (hurl) against a running server with `AI_PROVIDER=mock`.         |
| e2e      | `pnpm e2e` (Playwright, own server and database, mock provider).              |
| live     | `E2E_AI_LIVE=1 pnpm e2e --grep live`, local only, with the owner's key (8.2). |

**Scenario naming.** A task's verify clause names the spec scenarios it proves.

**Ordering.**

1. 1.1, 2.1, 3.1, 6.1 and 7.1 have no prerequisites. 6.1 defines its own error codes in map, because map never imports ai.
2. 2.2 needs 2.1. 3.2 needs 2.1. 4.1 needs 2.1 and 2.2.
3. 4.2 and 4.3 each need 1.1 and 4.1.
4. 5.1 needs 3.1, 3.2, 4.1, 4.2 and 4.3.
5. 6.2 needs 6.1. 6.3 needs 5.1 and 6.2.
6. 8.1 needs 6.3. 8.2 needs every other task.

## 1. Dependencies

- [ ] 1.1 Add `ai`, `@ai-sdk/openai-compatible` and `@anthropic-ai/sdk` as runtime dependencies (design D3, D4).
  - Use exact current versions per the Renovate minimum-age rule, with lockfile pairing.
  - Import nothing from them in this task.
  - Verify: `pnpm install --frozen-lockfile` succeeds on a clean checkout, `pnpm licenses:check` and `pnpm test:licenses` pass, `pnpm dead-code` passes (knip ignore entries carry a reason and the exit condition "removed when 4.2/4.3 import them"), and `pnpm build` passes.

Suggested fixture level: none - manifest and lockfile only, no behaviour; the license and lockfile gates are the whole proof.
Minimal mergeable slice: atomic - three packages in one manifest and lockfile change; splitting them only repeats the same lockfile churn.

## 2. AI domain

- [ ] 2.1 Add the ai domain core (design D1, D2).
  - `src/contexts/ai/acl/map.ts` re-exports `TreeOp`, `parseTreeOp` and the node types.
  - `ai/domain/` gets:
    - the `Provider` port and `GenerateRequest`;
    - the Generate tool input schema (strict Zod);
    - `ProviderOutputError` / `ProviderTransportError` with the error-code union `timeout | provider-error | invalid-output | refused`;
    - the op assembler with injected `idFactory` and caps `{ depth: 2, perParent: 7, total: 60 }`.
  - Verify (unit): ai-provider "Model temporary ids are replaced", "Unknown parent is invalid output", "Duplicate temporary id is invalid output", "Malformed tool input is invalid output", "Third level dropped", "Per-parent overflow truncated" and "Total cap ends generation" (as the assembler's `exhausted` signal). Every emitted op passes map's `parseTreeOp`. `pnpm boundaries` passes with the new acl file.
- [ ] 2.2 Add the unified Generate prompt (design D6) as a constant in `ai/application/generate-prompt.ts`.
  - Verify (unit): the text states two levels below the root, 3–7 children, ≤ 40 characters, mutually exclusive siblings, language follows the topic, tool-only changes, one parent per call and `root` with temporary ids. A builder places the topic only in the user turn, which is ai-provider "Same contract for every adapter" for the shared part.

Suggested fixture level: compact - pure domain logic and a constant; no I/O, but the assembler is the single safety net for model output.
Minimal mergeable slice: 2.1 - the assembler, port and acl are green alone; 2.2 is an additive constant that depends only on the tool name fixed in 2.1.

## 3. Configuration and generate use case

- [ ] 3.1 Extend `src/shared/env.ts` with the AI fields and cross-field rules (design D7).
  - Document the keys by name in `.env.example`, with the dmxapi platform default and `AI_MODEL=deepseek-v4.1-flash-1017`. Remove the now-misleading `OLLAMA_BASE_URL` line, which comes back in M3.5.
  - Verify (unit): ai-provider "AI not configured", "Partially configured provider fails at load" (each missing variable is named), "Claude provider configuration" and "Mock refused in production". Existing env tests still pass.
- [ ] 3.2 Add `generate(provider, request, { timeoutMs, signal })` in `ai/application/` (design D5), with the `ai.generate` span (attributes only, no topic).
  - Verify (unit, fake providers and controllable timers): ai-provider "Retry succeeds", "Retry exhausted", "Failure after first op" and "Slow provider". An abort before the first op does not retry. A spy logger proves "Provider HTTP error body withheld" for the logging half.

Suggested fixture level: compact - config parsing and one orchestration function, both deterministic with injected time; no transport.
Minimal mergeable slice: 3.1 - env validation is self-contained; 3.2 depends only on 2.1 and merges independently of 3.1.

## 4. Provider adapters

- [ ] 4.1 Add the mock provider and the shared provider contract suite (design D11, Seams).
  - `describeProviderContract(makeProvider)` lives in a test-support module. It covers op validity, fresh ids, caps and abort for any adapter.
  - Verify (unit): the suite passes for the mock, plus ai-provider "Deterministic skeleton" and "Scripted mid-stream error". `mock:invalid-first` fails validation on every attempt.
- [ ] 4.2 Add the OpenAI-compatible adapter on the AI SDK with an injected `fetch` (design D3, D4).
  - Read the installed package docs before coding.
  - Settings: SDK retries 0, `maxOutputTokens` 8000, at most 4 steps, a tool `execute` that answers `ok`, and a configured base URL.
  - Verify (unit with hand-authored OpenAI chat-completions SSE fixtures): `describeProviderContract` passes, a two-turn tool loop yields ops from both turns, an HTTP 500 body surfaces as `ProviderTransportError` without its body, and a truncated tool-call argument stream is `ProviderOutputError`.
- [ ] 4.3 Add the Claude adapter on `@anthropic-ai/sdk` with an injected client transport (design D3, D4).
  - Settings: `client.beta.messages.stream`, the fallback beta, `strict` + `eager_input_streaming` tool with `tool_choice: auto`, effort `medium`, a cached system block, `max_tokens` 8000, `maxRetries` 0, and an optional `baseURL`.
  - Verify (unit with hand-authored Messages SSE fixtures): `describeProviderContract` passes. The request body asserts the settings above and that no forced `tool_choice` is sent. A `tool_use` turn is followed by `tool_result` `ok` blocks. `stop_reason: refusal` gives `refused`. Incomplete input at `max_tokens` gives `ProviderOutputError`.

Suggested fixture level: expanded - Critical Path (`providers/`: billing and key handling); wire-format fidelity is proven only by fixtures, so review must check them against vendor docs.
Minimal mergeable slice: 4.1 - the mock and the contract suite are green alone and unblock the route; 4.2 and 4.3 are independent of each other and each depends on 1.1 and 4.1.

## 5. Generate route

- [ ] 5.1 Add `src/app/server/ai-services.ts` (env → one provider or `undefined`) and `src/app/api/ai/generate/route.ts` (design D8).
  - Read the Next.js 16 route-handler streaming guide in `node_modules/next/dist/docs/` first.
  - Update `schemas/openapi.yaml` and its snapshot, add the 401/400/200-mock entries to `smoke/api.hurl`, and flip `/api/ai/generate` to "covered by smoke/api.hurl" in `constraints.yaml`.
  - Verify (unit, real handler over composed mock): ai-generate-api "Signed out", "Blank topic", "Oversized topic", "Unknown field", "AI disabled", "Mock generation streams to done", "Error after partial output", "Stateless" (the store is never touched) and "Browser stops the request" (the provider sees the abort).
  - Verify (contract): "Contract snapshot".
  - Verify (smoke): the three hurl entries pass against a mock-configured dev server.
  - Verify (gate): `pnpm test:guardrails` passes, and the PR flags `constraints.yaml`.

Suggested fixture level: expanded - Critical Path (`src/app/api/`, `src/app/server/`, `constraints.yaml`): new public API surface with streaming, auth and abort semantics.
Minimal mergeable slice: atomic - the route, its composition, its OpenAPI entry and its smoke entries must land together, or the contract and route-inventory gates disagree.

## 6. Editor topic generation

- [ ] 6.1 Add the `GenerateSource` port in `map/domain` and the browser adapter `map/infrastructure/ai/http-generate-source.ts` (design D9).
  - The adapter sends the Session binding, parses SSE, validates each op with `parseTreeOp` and raises typed `GenerateError` codes, including `ai-unavailable` and `unauthenticated`.
  - Verify (unit, injected fetch with chunked bodies split mid-frame): frames reassemble, an `error` frame raises its code, a stream ending without a terminal event raises `provider-error`, 503 raises `ai-unavailable`, 401 raises `unauthenticated`, and abort stops reading.
- [ ] 6.2 Add the editor store `generate(topic)` action and the `generating` lock (design D9).
  - Verify (unit, fake `GenerateSource`): topic-generation "Root text and title", "Custom title kept", "Undo completed generation", "Undo partial generation", "Shortcut ignored during generation" (store refusals), the store halves of "Stop" and "Mid-stream error", "AI unavailable" (no undo entry, map unchanged), and "Saved after completion" (autosave holds while generating and saves once afterwards). A refusal on a non-empty map is covered. A reducer rejection reverts the whole group and shows `生成失败`.
- [ ] 6.3 Render the topic form, Stop and notices in `EditorView`, and wire unmount/pagehide abort-then-flush in `EditorSession`.
  - Make `scripts/e2e-server.mjs` force `AI_PROVIDER=mock`.
  - Verify (jsdom): topic-generation "New map", "Non-empty map", "AI unavailable" (shows `AI 未配置`), "Pan during generation" (pan handlers stay enabled) and disabled edit controls while generating.
  - Verify (e2e, mock): "Progressive appearance", "Stop", "Mid-stream error", "Leaving saves partial result", "Saved after completion" and "Undo completed generation" in the browser, with zero console errors and screenshots in `.run/ui-evidence/`.

Suggested fixture level: expanded - user-visible editing flow across the store, the canvas lock and the save path; a lock or group slip corrupts undo or loses edits.
Minimal mergeable slice: 6.1 - the HTTP adapter is fully unit-tested and unused until 6.2; 6.2 depends on 6.1; 6.3 depends on 6.2 and 5.1.

## 7. Layout transitions

- [ ] 7.1 Add node position transitions and mount fade-in, the drag-time transition suppression and the reduced-motion override (design D10).
  - Set Playwright's default project to `reducedMotion: 'reduce'` and add one motion-enabled spec.
  - Verify (jsdom): the transition class is removed during a live drag gesture and restored after it.
  - Verify (e2e): canvas-layout "Sibling shifts smoothly" (motion enabled; the computed style carries the transition, and the final box equals the layout position after settling), "Drag preview is immediate" and "Reduced motion". All existing e2e specs pass unchanged.

Suggested fixture level: compact - presentation-only CSS plus test configuration; no state or persistence change, but it touches every canvas e2e.
Minimal mergeable slice: atomic - the CSS, the drag suppression and the reduced-motion test configuration must land together, or existing position assertions become flaky.

## 8. Live acceptance and closure

- [ ] 8.1 Add live mode (design D11, decision 0039).
  - `scripts/e2e-server.mjs` passes the `.env` AI variables through only when `E2E_AI_LIVE=1`, and refuses `E2E_AI_LIVE=1` with `CI=true`.
  - Add `e2e/ai-live.spec.ts`, which skips with a printed reason otherwise.
  - Move decision 0039 to implemented, and amend the AGENTS "What agents may not do" and CONTEXT forbidden-logic rows to cite it.
  - Verify: ai-live-acceptance "Default e2e" (the default run skips live and uses the mock) and "Live under CI refused" (a script test for the exit code with no provider call). `pnpm test:guardrails` and `pnpm decisions:check` pass. The PR flags the `AGENTS.md` edit.
- [ ] 8.2 Close M3.
  - Reconcile TECH §5 with the shipped protocol: flat per-parent calls, temporary-id remap, tool-result loop, the beta endpoint for `fallbacks`, and no `listModels` or capability flags until M3.5.
  - Add README Known Limitations: no quota, local only, and AI optional.
  - Update CONTEXT's map integration row (HTTP, not `acl/ai.ts`).
  - Run the live spec with the owner's dmxapi key and `deepseek-v4.1-flash-1017`. Record the measured first-node and completion times, plus the answers to open items O1 (Anthropic-native support at dmxapi: attempt one live run with `AI_PROVIDER=anthropic` if supported) and O2, in the Epic.
  - Verify: `pnpm docs:check` passes, and the live run output (command, exit code, timings) is attached for ai-live-acceptance "Live run with the platform provider". A failed timing is reported as an acceptance failure, not tuned away.

Suggested fixture level: compact - test harness gating and documentation; 8.1 touches `AGENTS.md` (gate integrity), which the guardrail evidence covers.
Minimal mergeable slice: 8.1 - live gating with its decision record merges alone after 6.3; 8.2 (docs and the live acceptance record) follows every other task.
