# Proposal

## Why

同名导图的操作表单出现在列表之外，无法直观确认目标；管理员重置密码的控件与确认未点名账号。 destructive action 的持久化 ID 虽被捕获，界面却不足以防止误操作。

## What Changes

- 把导图重命名表单与删除确认呈现到所选行内；同名行仍绑定各自捕获的 ID，取消、失败、焦点与 pending 行为保持。
- 给每个管理员重置按钮添加包含用户名的可访问名称；确认同时点名账号并保留「重置后该用户的所有登录将失效」整句。
- 增加同名行真实浏览器证据，不改 API、数据、时间、样式或排序。

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: expanded (agree)
Blast radius: 行目标错误可能改名、删除或重置错误账号；呈现迁移可能破坏取消、焦点和串行化。
Selected risk packs: concurrency/shared state/ordering, auth/permissions/secrets, legacy compatibility, documentation.
Evidence floor: 新增行为先红后绿；受影响组件单元测试、map-library/account-admin 浏览器场景、typecheck/lint/boundaries/docs/OpenSpec 与 CI。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `map-library`: 操作目标的可见关联及同名行保护。
- `account-admin`: 密码重置操作和确认的目标身份。
