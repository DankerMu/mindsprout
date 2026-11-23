# Proposal

## Why

The required Darwin native-browser test has twice failed before sending SIGINT because the signal child did not report browser readiness within 10 seconds. Existing evidence cannot distinguish browser launch, Chromium connection, IPC delivery, or parent-side handling; a successful later qualification cannot diagnose the original failure.

## What Changes

- Report the launched browser PID before connection begins so the parent can verify identity and reap a partially started browser; add fixed launch/connect/ready state to readiness failures.
- Report bounded child exit/error and output status without publishing arbitrary raw stderr, credentials, browser arguments or environment data.
- Keep the actual `launchNativeBrowser` → `chromium.connect` → `ready` path, process ownership, signal sending, cleanup assertions and 10-second readiness deadline unchanged.
- Establish a real failure-path regression for the new evidence, then run the unchanged real-browser native browser test suite; do not claim a root cause or deterministic reproduction without evidence.

Issue type: test
Fixture level: expanded
Upstream suggested level: absent (override: CI gate, real process/browser lifecycle, concurrency and diagnostic file output)
Blast radius: native required CI 信号测试的诊断准确性与资源清理；无产品运行路径。
Selected risk packs: CI/script entry, concurrency/shared state/ordering, file IO/path safety, auth/permissions/secrets, error handling/rollback, resource limits, legacy compatibility。
Evidence floor: launch 后立即验证归属、connect 阻塞时 child/browser 可回收，超时报告固定阶段/退出状态且不泄露原始 stderr；迟到事件不逆转、信号/清理原断言不变，`pnpm native:browser:test` 与静态门禁通过。没有原始间歇性根因证明。

## Capabilities

### New Capabilities

- `native-signal-diagnostics`: test-owned signal-fixture readiness and bounded failure attribution.

### Modified Capabilities

None.

## Impact

- Signal-fixture parent/child and their existing Node native tests; no production code or workflow weakening.
- Diagnostic fields must exclude credentials, request data, browser arguments and unbounded raw logs.
