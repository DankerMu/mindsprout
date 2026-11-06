---
id: 0009
title: Disable the Next.js managed AGENTS.md block
kind: process
status: proposed
date: 2026-11-06
---

# Disable the Next.js managed AGENTS.md block

## Problem

Agent instruction files (`AGENTS.md`, `CLAUDE.md`) must stay within 32768 bytes per file and 307 bytes per line, counted in UTF-8. The `instruction-guard` hook from my-agents enforces this, and `AGENTS.md` was 40.9 KB with 33 lines over the limit.

Most of that could be fixed by editing `AGENTS.md`. One line could not. `next dev` writes a managed block between `<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->`, and one line in it is 333 bytes. When `next dev` detects an AI coding agent, it compares the block byte for byte with its own copy and rewrites it if they differ (Next.js 16.4.5, `node_modules/next/dist/server/lib/generate-agent-files.js`). Splitting the line would last only until the next `pnpm dev`.

## Decision

- `next.config.ts` sets `agentRules: false`. With this setting `next dev` removes the managed block instead of writing it.
- The block moves word for word to `docs/engineering/nextjs-agent-rules.md`.
- `AGENTS.md ## Important Development Notes` entry 6 keeps the rule on the hot path: read `node_modules/next/dist/docs/` before writing Next.js code.

## Alternatives considered

- **Keep the block as is**: `AGENTS.md` fails the line limit on every check, so the size gate stops working for this repo.
- **Split the long line inside the block**: `next dev` puts the original back the next time an agent starts it, leaving an uncommitted change in the tree that fails the gate again.
- **Exempt managed blocks in the size gate**: this loosens a gate to fit one file, and every tool that writes its own block could use the same exemption.

## Consequences

- When a Next.js upgrade changes the managed text, `next dev` no longer updates it here. Whoever does the upgrade compares `buildAgentRulesBlock()` in `generate-agent-files.js` with `docs/engineering/nextjs-agent-rules.md`.
- Setting `agentRules` back to `true` (or removing the key) brings the block back, and the 333-byte line with it.
