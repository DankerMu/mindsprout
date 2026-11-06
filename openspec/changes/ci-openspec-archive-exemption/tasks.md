# Tasks: ci-openspec-archive-exemption

## 1. Exemption (issue #54)

- [ ] 1.1 Red: add guardrail cases (a)–(k) from design "Fixture — issue #54" to `scripts/test-guardrails.sh` and show the exemption accept case failing
- [ ] 1.2 `constraints.yaml` `exempt_prefixes` and `.git-hooks/check-naming.sh` parsing, remainder check, path-mode normalisation, fail-closed validation, fallback parity
- [ ] 1.3 Decision record 0007 and the AGENTS.md Code Canonicality bullet
- [ ] 1.4 Evidence: `pnpm test:guardrails`, bite checks (i)–(v), bash 3.2 run, `pnpm decisions:check`, `pnpm docs:check`, `pnpm fmt:check`
- [ ] 1.5 Archive `ci-diff-guard-labels` and this change through the normal pre-commit hook, before the final review round

## Risk packs — issue #54

- Config / project setup — selected: new `constraints.yaml` key parsed by a sed pipeline; evidence = cases (a), (i), (j), (k).
- File IO / path safety — selected: prefix matching and path normalisation decide what can be committed; evidence = cases (b)–(h), bites (i)–(iii).
- Legacy compatibility — selected: every existing verdict, message and exit code outside the prefix is preserved; evidence = all pre-existing guardrail cases unchanged and passing, review of the message/exit-code diff.
- Public API / CLI / script entry — selected: check-naming.sh path-argument mode, exit codes (0/1/2) and stderr lines consumed by .husky/pre-commit and .claude/hooks/pre-write-naming.sh; evidence = cases (h), (i), (k) and all existing naming cases unchanged.
- Error handling — selected: an invalid exempt entry fails closed; evidence = case (i), bite (iv).
- Documentation — selected: AGENTS.md bullet and decision 0007; evidence = `pnpm docs:check`, `pnpm decisions:check`.
- Schema; Auth; Concurrency; Resource limits; Release / packaging — not selected: no persisted data, credentials, shared state, size limits or dependencies.
