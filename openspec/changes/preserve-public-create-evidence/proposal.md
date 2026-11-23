# Proposal

## Why

The original unprofiled Darwin public-create timeout has raw network/capture artifacts but an empty `public-create-outcome`. A separate `--profile` replay cannot supply the original attempt's budget, action/readiness terminal state or failed-tail observations.

## What Changes

- Reuse the existing navigation diagnostic state machine and safe projection in the default required invocation, without enabling profiler commands, marker/route sampling, new listeners, HTTP requests, `.next-profiles` or `safe/`.
- Publish one bounded `public-create-evidence` JSONL event with original budget/action/outcome and explicit partial marker/route channels; retain the legacy empty outcome and raw network event unchanged.
- Finalize a failed default attempt after existing failure capture so late network receipts stay `failed-tail`; tag related DOM capture metadata without interpreting it as readiness. Preserve ready/save-assertion ordering, five-second deadline, noise gates and cleanup.
- Update the default contract, native guide and decision records. Original failure and independent replay remain separate; no root-cause or latency-repair claim.

Issue type: test
Fixture level: expanded
Upstream suggested level: absent (override: shared CI entrypoint, default diagnostic output, async lifecycle and persisted artifact contract)
Blast radius: required native qualification 的证据归属与默认 observer 开销；不改变产品运行路径或资格结果。
Selected risk packs: CI/script entry, concurrency/shared state/ordering, file IO/path safety, auth/permissions/secrets, schema/field names, documentation/migration notes, error handling/rollback, resource limits, legacy compatibility。
Evidence floor: default first-create 红绿回归覆盖 claim/start 相位、budget/action/outcome、partial channels、late network/capture、root failure、ready/save 与 ready 后 trial failure；两种真实 unprofiled mode、`pnpm native:browser:test`、静态/文档/决策/OpenSpec 与 required CI 通过，无 profiler/sampler/extra HTTP 或敏感字段。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `development-navigation`: default qualification retains bounded non-authoritative public-create evidence; opt-in profiling remains a separate richer diagnostic.

## Impact

- Shared `observeNavigation` default wiring, finalization after existing failure capture, focused native fixtures/tests, native guide and decisions 0031 plus its partial successor.
- No application code, API/schema, dependency, CI workflow, native package, retry/warmup or deadline change; no changeset for test tooling.
