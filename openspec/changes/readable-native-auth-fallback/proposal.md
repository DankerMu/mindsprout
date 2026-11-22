# Proposal

## Why

登录/注册表单在 hydration 前原生 POST 到 JSON-only API，浏览器停在原始 415 JSON 页。owner 已选择 readable failure page，而不是仅记录 limitation；API 不得接受 form credentials。

## What Changes

- 新增 `/login/native`、`/register/native` 非 API route 各处理原生 POST：不读取 body、cookie 或凭据 query，显式 303 到同一表单的 `native=unavailable` 状态。不能与 page 同 segment 定义 route，也不能复用 API endpoint。
- CredentialsForm 的原生 action 指向专用 native 处理点并保留 safe `next`；hydrated submit 继续拦截并 JSON 请求原 API。失败页展示「页面尚未加载完成，请重试」且保留原表单作为返回入口。
- API form-encoded 仍 415、无副作用；增加页面 POST 单元、真实浏览器无 JS/阻脚本/正常 JS 和 smoke 证据。同步 OpenAPI、smoke、Known Limitations 与 changeset。

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: expanded（owner 选择行为修复；agree）
Blast radius: 公共认证入口、凭据边界、开放重定向、CSRF/会话创建；错误 handler 可能泄密或使正常登录回归。
Selected risk packs: public route entry, auth/permissions/secrets, legacy compatibility, error handling, documentation。
Evidence floor: 失败行为先红后绿；页面 POST 不读 body/安全 303、两 API 415 保持、完整 CredentialsForm/账户测试、真实 Postgres 原生与 hydrated 浏览器、OpenAPI/contract/smoke、静态门禁与 CI。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `account-auth`: 原生表单 action 与 readable failure，保留 JSON-only 和无会话要求。
