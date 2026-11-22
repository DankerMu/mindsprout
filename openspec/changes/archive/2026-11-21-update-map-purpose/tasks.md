# Tasks

## 1. Align capability summaries

- [x] 1.1 Change only the two existing Purpose paragraphs to the issue #228 meaning; compare the final diff to show no requirement, scenario or other prose changes. Run scoped Prettier and strict validation of both main specs.
- [x] 1.2 Run `pnpm docs:check`, `pnpm decisions:check` and a diff audit against current cloud-storage behavior. Preserve all consumers, tests, runtime code and the user's unrelated hook modification.

## Risk packs

Selected:

- Documentation / migration notes: 1.1–1.2; keep signed-in cloud storage terminology consistent in both summaries.

Not selected:

- Runtime/API/CLI/config/file IO/schema/auth/concurrency/resources/error handling/release: no executable or configuration changes.
- Legacy compatibility / examples: all existing normative contracts must remain byte-identical.
