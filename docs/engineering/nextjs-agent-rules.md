# Next.js agent rules

Moved intact from the `AGENTS.md` block that `next dev` manages (Next.js 16.4.5, `node_modules/next/dist/server/lib/generate-agent-files.js`).
`next dev` compares the block byte for byte and re-adds it after any edit, and one of its lines is longer than the 307-byte line limit for agent instruction files.
`next.config.ts` therefore sets `agentRules: false`, so `next dev` no longer writes the block, and the rule is kept here.
`AGENTS.md ## Important Development Notes` links here.
The second paragraph below describes `next dev` behavior while `agentRules` is enabled; "this file's directory" means the repo root, where `AGENTS.md` lives.

The block as Next.js writes it:

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
