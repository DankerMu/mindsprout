# Tasks

## 1. Preserve meaningful disclosure assertions

- [x] 1.1 Record a seven-case baseline/post-fix matrix at the unmodified test seam. Only passwordless clean-output acceptance is RED pre-fix; password-bearing clean acceptance and isolated full-URL/password/sentinel rejection controls are already GREEN. Passwordless sentinel-only rejection is masked pre-fix by the empty-password error. Require deterministic synthetic-URL cases for all seven after the fix, using isolated outputs to prove full-URL/sentinel checks are unconditional and nonempty-password coverage is not skipped or vacuous. Save exact assertion evidence.
- [x] 1.2 Make the minimal `undisclosed` correction so nonempty credentials retain all checks and empty passwords produce no substring assertion. Run the same cases GREEN and run the existing db-setup integration suite against owned real Postgres with passwordless and password-bearing URLs, without weakening runtime/auth behavior or acceptance tests.
- [x] 1.3 Run scoped ESLint/Prettier, `pnpm test:guardrails`, strict fixture validation and change-scope audit; confirm no source, auth policy or unrelated test changes.

## Risk packs

Selected:

- Auth / permissions / secrets: 1.1–1.3; full URL, nonempty password and sentinel remain forbidden in output, and logs/tests must not reveal supplied credentials.
- Error handling / rollback / partial outputs: 1.1–1.2; expected setup and production-refusal diagnostics remain allowed when they contain no secret.
- Legacy compatibility / examples: 1.1–1.2; existing setup, migration, bootstrap and refusal scenarios remain unchanged.
- Documentation / migration notes: 1.3; archive the test contract and record verification without changing runtime documentation.

Not selected:

- Public API / CLI / script entry: preserve the existing CLI command seam and production behavior.
- Config / project setup: no new environment variable or configuration format.
- File IO / path safety / overwrite: no filesystem behavior changes beyond existing test fixtures.
- Schema / columns / units / field names: no database schema changes.
- Concurrency / shared state / ordering: no runtime or database ordering changes; owned scratch databases isolate tests.
- Resource limits / large input / discovery: no payload or resource-limit changes.
- Release / packaging / dependency compatibility: no dependencies or release changes.
