---
id: 0002
title: Provider abstraction over Claude, OpenAI-compatible and local models
kind: architecture
status: implemented
date: 2026-11-05
---

# Provider abstraction over Claude, OpenAI-compatible and local models

Status: active

## Problem

The product must work with Claude, OpenAI-style APIs (OpenAI, DeepSeek, Qwen, Moonshot, …) and locally hosted open models (Ollama, vLLM, LM Studio), including user-supplied keys and base URLs. Coupling the canvas to one vendor SDK would make each new provider a rewrite.

## Decision

- The `ai` bounded context exposes one port: `Provider.streamOps(request) → AsyncIterable<TreeOp>`. The canvas never sees a vendor type.
- Claude connects through the official `@anthropic-ai/sdk` directly (tool use with `strict: true`, streaming, prompt caching, server-side `fallbacks: "default"`); every OpenAI-compatible endpoint, including local servers, goes through one `openai-compatible` adapter parameterised by base URL, key and model.
- Two output channels: tool calling where the model supports it reliably; otherwise a JSON mode validated with Zod, truncated at the node/depth limits, retried once, then surfaced as an error.
- Providers declare capabilities (`supportsToolCalling`, `supportsStreaming`, `supportsJsonMode`); a router picks the channel. User-supplied keys are encrypted at rest and decrypted only server-side.

## Alternatives considered

- **Vercel AI SDK for every provider including Claude** — lost: it lags the Claude API on tool-use streaming and cache features the product depends on; kept only as the OpenAI-compatible adapter base.
- **One vendor only (Claude)** — lost: contradicts the product requirement for local open models and bring-your-own-key.
- **Per-vendor code paths in the canvas** — lost: N providers × 3 interaction modes of drift; the TreeOp port removes the multiplication.

## Consequences

- `src/contexts/ai/infrastructure/providers/` holds one adapter per transport; `application/` holds the router and prompt assembly; `domain/` holds `TreeOp` schemas and capability types.
- Tests and CI never call paid keys: provider tests use recorded fixtures or a mock provider (`AGENTS.md ## Agent Operating Rules`).
- See `docs/TECH.md` §5 for the full design.
