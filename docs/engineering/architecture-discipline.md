# Architecture discipline — DDD (strict) and TDD (required)

Full clauses relocated from `AGENTS.md ## Architecture Discipline`, which keeps the hard rules and links here.

## Domain-Driven Design

This codebase uses Domain-Driven Design to keep business logic and infrastructure separate. The canonical vocabulary lives in `../../openspec/glossary.md`; bounded-context ownership and invariants in `../../CONTEXT.md`. When a term in conversation conflicts with the glossary, surface the conflict — never introduce a synonym silently. When a term is resolved, update the glossary inline.

### Layering (per bounded context, enforced by `pnpm boundaries`)

| Layer                           | Path                                 | May depend on                               | Forbidden to import                                             |
| ------------------------------- | ------------------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| Domain                          | `src/contexts/<ctx>/domain/`         | itself, `src/shared`, `zod` (decision 0005) | framework, infra, application                                   |
| Application                     | `src/contexts/<ctx>/application/`    | domain                                      | infrastructure, presentation                                    |
| Infrastructure                  | `src/contexts/<ctx>/infrastructure/` | domain (via ports), application             | presentation                                                    |
| Presentation / composition root | `src/app/`, `src/components/`        | application                                 | infrastructure directly (components), other contexts' internals |

### Bounded contexts

| Context | Path                    | Owns                                                                                  | Anti-corruption layer to                             |
| ------- | ----------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| map     | `src/contexts/map/`     | MindMap, MindNode, TreeOp reducer, undo grouping, layout model                        | ai (consumes TreeOps), export (hands tree snapshots) |
| ai      | `src/contexts/ai/`      | Provider port, adapters, prompt assembly, capability router, quota                    | map (emits TreeOps only)                             |
| account | `src/contexts/account/` | identity, user-supplied provider credentials (encrypted), persistence of maps via RLS | map, ai                                              |
| export  | `src/contexts/export/`  | serialisers (PNG/SVG/Markdown/OPML)                                                   | map (read-only)                                      |

Contexts never import each other's domain types directly. Translation lives in `src/contexts/<ctx>/acl/<other>.ts`; foreign types do not leak past it.

### Aggregates, repositories, domain services, value objects

- An aggregate has exactly one root entity (`MindMap`; its `roots[0]` is the primary `MindNode`, further roots are floating subtrees — decision 0004). External references go through the root.
- A single transaction touches one aggregate. Cross-aggregate coordination uses domain events (past-tense names: `MapCreated`, `NodesGrown`), dispatched after commit; payloads are additive-only contracts.
- One repository interface per aggregate root, defined in `domain/`, implemented in `infrastructure/persistence/`, injected into application services. Methods are named in domain terms.
- Domain services are stateless, live in `domain/`, and exist only when behaviour fits no entity or value object.
- Value objects are immutable; equality by value. Implemented as readonly objects with constructor validation.
- Significant boundary decisions (splitting an aggregate, why a translation exists) are decision records under `../../decisions/implemented/architecture/`.

## Test-Driven Development (required)

The test is the specification. Write the test before the implementation; if the test cannot be written, the requirement is not yet clear enough to implement.

### Cadence

1. **Red** — the smallest failing test for the next behaviour. Confirm it fails for the right reason.
2. **Green** — the minimum code that passes. No premature generalisation.
3. **Refactor** — names, structure, duplication, tests still green.
4. **Commit** — at green-and-clean points; messages describe behaviour.

Skipping red-first because "the change is small" is exactly when discipline matters most.

### Naming, structure, scope

- Test names are behaviour sentences: `rejects orders with zero quantity`.
- Arrange / act / assert, separated by blank lines. One concept per test.
- Test files mirror source files: `src/foo.ts` → `src/foo.test.ts` (pre-commit guard `scripts/check-test-pairing.sh`).
- Tested: public functions with non-trivial behaviour, every conditional branch, error paths, boundary conditions.
- Not tested: pure pass-through wiring, generated code (migrations, OpenAPI stubs), trivial getters, test scaffolding.

### Isolation and flakiness

- No shared mutable state between tests; fresh fixtures; parallel by default; a serial test says why in a comment.
- Database tests use transactions that roll back or a disposable database per suite (`tests/integration/`).
- A flaky test is a bug: quarantine with a `flaky` marker linked to an issue, fix or delete within 14 days.

### Strict enforcement

- No production code without a failing test first. A new `src/**` file without its paired test fails pre-commit.
- Coverage gate 90% per file (`vitest.config.ts`); below it CI fails.
- Mutation testing (`pnpm mutation`, Stryker) runs weekly; surviving mutants are reviewed by the reviewer agent.
- Every external boundary (route handler, provider adapter, persistence) has at least one integration test against a real backing service.
- Forbidden: disabling tests to pass CI; `it.skip` without a linked issue and deadline; tests that only assert "no exception"; mocking the system under test.
