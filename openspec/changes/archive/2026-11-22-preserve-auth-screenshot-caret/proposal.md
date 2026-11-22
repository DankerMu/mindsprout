# Proposal

## Why

The account-auth form-switch CI failure showed hydration differences matching Playwright's default caret-hiding style mutation. The precise scheduling is unreproduced; screenshots must not introduce that avoidable DOM mutation while strict console assertions remain intact.

## What Changes

- Pass `caret: 'initial'` for the two existing screenshots in the account-auth form-switch browser scenario.
- Preserve credentials, links, session checks, screenshots and zero unexpected console/page-error assertions.
- Do not change production hydration, input behavior, timeouts or CI configuration.

Issue type: test
Fixture level: expanded
Upstream suggested level: absent (override: concurrency/ordering and legacy-compatibility packs are explicit expanded triggers; implementation stays at two screenshot options)
Blast radius: 证据截图或浏览器时序；不改产品行为。
Selected risk packs: concurrency/shared state/ordering (测试与 hydration 时序), legacy compatibility (保留认证场景和严格噪音断言)。
Evidence floor: 两个现有截图调用期间的 caret inline-style 瞬变直接为零（临时 mutation diagnostic 或等效 pinned-Playwright 实现证据）；表单切换场景通过、零意外 console，静态检查和最终 CI 通过。green/no-residue 不冒充确定性间歇复现或根因证明。

Design: required — 见 `design.md`。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-auth`: browser evidence capture SHALL NOT alter input caret state during the existing form-switch scenario.

## Impact

- `e2e/account-auth.spec.ts` and its existing browser evidence.
- No product runtime, API, persistence or dependency changes.
