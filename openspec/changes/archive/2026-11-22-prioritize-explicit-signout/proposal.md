# Proposal

## Why

导图库列表 GET 在显式 logout 成功后迟到 401，会用 `/login?next=%2F` 覆盖已经发起的 `/login`，违反 sign-out 目标。CI #255 再次复现，#244 已给出同类 trace；不能放宽精确 URL 或认证检查。

## What Changes

- 为共享页面会话建立一个轻量 navigation-intent：成功 logout 后、发起 `/login` 之前标记当前页面退出；不再将旧页面未决加载的 401 视为真实过期。
- MapLibrary 与 AdminUserList 的 live 401 document redirect 检查该意图；普通过期加载仍 `/login?next=<current>`。编辑器的保存失败/待编辑恢复不触碰。
- 增加可控延迟的组件与真实浏览器回归：logout 204 后列表 401 最终仍 `/login`；logout 失败不设导航意图；初始过期保留 next。

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: expanded (agree: shared navigation state/auth)
Blast radius: 退出目标错误、真实过期被吞、跨页导航取消状态泄漏、账号隔离与 acceptance 稳定性。
Selected risk packs: auth/permissions/secrets, concurrency/shared state/ordering, legacy compatibility, documentation。
Evidence floor: 可控竞态先红后绿；SessionMenu/MapLibrary/AdminUserList 测试，真实浏览器 logout 与 expired-load、完整 E2E、静态门禁与 CI。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `account-auth`: 显式 logout 导航优先于旧页面的过期加载回调，保留真实过期策略。
