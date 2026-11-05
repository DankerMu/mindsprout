# Issue Risk + OpenSpec Fixture

Used in Phase 0. The fixture makes the OpenSpec change a useful oracle for the implementer and reviewers; keep it short, and never let fixture writing become the main token sink. This file is the single source for the fixture-level vocabulary that `stage-change-pipeline` writes into issues as `Suggested fixture level`.

## Triage

Write at most ten lines into `proposal.md`:

```text
Issue type: feature|bugfix|refactor|test|release
Fixture level: none|compact|expanded
Upstream suggested level: <level or absent> (agree | override: <one-line reason>)
Blast radius: <what breaks if this is wrong>
Selected risk packs: <pack names, or "none">
Evidence floor: <minimum tests/commands that must pass>
```

## Fixture Levels

- `none`: docs, metadata, typo, isolated test-expectation update; no runtime behavior. The change still exists but stays minimal.
- `compact`: an ordinary isolated code change: no shared entrypoint, no format/schema change, no file publish/delete behavior.
- `expanded`: anything touching a shared entrypoint, public API, CLI, parser/reader/writer, schema or file format, auth/permissions, file IO or path safety, persisted or shared state, concurrency, publish/delete/rollback, migrations, production config, money, or legacy compatibility; also an ambiguous issue scope.

Prefer `compact` when uncertain unless an `expanded` trigger is present. Do not expand because the issue feels important.

Artifact set per level (`openspec validate` requires at least one spec delta at every level; the delta is what `openspec archive` folds into the main specs):

- `none` / `compact`: `proposal.md` (why/what plus the triage block), `tasks.md`, one minimal spec delta with a single `#### Scenario:` covering the behavior change. `design.md` is omitted; say so in one line in `proposal.md`.
- `expanded`: `proposal.md`, `design.md`, `tasks.md`, spec deltas.

## Risk Packs

Mark each pack that plausibly applies as selected or not selected, with a short reason, in `tasks.md`. Every selected pack maps to a scenario test, a verification command, or an explicit non-goal.

- Public API / CLI / script entry
- Config / project setup
- File IO / path safety / overwrite
- Schema / columns / units / field names
- Auth / permissions / secrets
- Concurrency / shared state / ordering
- Resource limits / large input / discovery
- Legacy compatibility / examples
- Error handling / rollback / partial outputs
- Release / packaging / dependency compatibility
- Documentation / migration notes

## `design.md` at `expanded`

Target 20-40 lines:

```text
Change surface: <entrypoints and modules>
Must preserve: <legacy caller/API/format behavior; downstream consumer expectations>
Must add/change: <new behavior, config, schema, files>
Governing invariant: <one sentence that must hold end to end, when the change has one>
Sibling surfaces: <producers, validators, storage, entrypoints, consumers, failure paths that share the invariant; "none - reason" where absent>
Seams under test: <public boundaries the tests target, fewest and highest possible>
Required evidence: <scenario or command: input -> expected output; failure input -> expected error, no partial output>
Non-goals: <what this issue intentionally does not cover>
Review focus: <2-5 items reviewers must verify>
```

Reviewers at `expanded` check the sibling surfaces, not only the touched lines; a fix for a finding in one surface audits the others.
