# Tasks

## 1. Default lint scope

- [x] 1.1 Capture a fresh failing scope probe against the actual local OMP paths, with project/near-miss paths as controls; retain the recorded default-command failure without rerunning it solely for confirmation.
- [x] 1.2 Run `openspec validate exclude-local-omp-lint --strict --no-interactive` and require success before authoring the decision record or editing `eslint.config.mjs`.
- [x] 1.3 Record the process decision, then add only `.omp/**` to the existing global ignore block; verify the same scope probe passes, default `pnpm lint` succeeds and a deliberate project-source `no-console` violation still fails.
- [ ] 1.4 Verify typecheck, formatting, docs and decisions; confirm source/tests/scripts/rules and other ignore entries remain unchanged, obtain risk-scaled cross-review and exact-head CI, then merge.

## Risk packs

- Config / project setup — selected: root lint discovery boundary. Evidence: narrow scope RED→GREEN and exact config diff.
- Public API / CLI / script entry — selected: default pnpm lint and direct ESLint share config. Evidence: no-override default command and direct API probe.
- Resource limits / large input / discovery — selected, discovery only: local tooling must not enter project lint while project and near-miss paths remain discoverable. Evidence: actual-tooling scope RED→GREEN with real-source, lookalike and nested-path controls; no new cap or performance claim.
- Error handling / rollback / partial outputs — selected: project violations must still reject, not disappear or crash parsing. Evidence: stdin source sentinel returns exit1 with `no-console`; no rule/threshold changes.
- Legacy compatibility / examples — selected: existing source, typed checks and neighboring tool-directory exclusions remain. Evidence: project/near-miss scope controls, typecheck and diff audit.
- Documentation / migration notes — selected: process decision defines the tooling boundary and rejected alternatives. Evidence: supersession check plus docs/decisions gates; no product changeset.
- File IO / path safety / overwrite; Schema; Auth; Concurrency; Release / packaging — not selected: no runtime IO/schema/credentials/shared-state/dependency behavior changes; lint reads files through its existing mechanism.
