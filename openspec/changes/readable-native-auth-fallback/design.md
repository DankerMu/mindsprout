# Design

## Context

CredentialsForm 同时服务 login/register；#217 保留早输入和 JSON fetch 的边界不变。#242 owner 已批准 readable failure page。Next 16 `route.md` 支持 POST handler，`redirect.md` 说明 `redirect()` 在 Route Handler 通常 307，不能拿它冒充 303；显式 Response redirect 满足 POST→GET。

## Goals / Non-Goals

**Goals:** 原生按钮/Enter 在 login/register 都回可读同页表单；无 JS 与脚本阻断一致；无凭据进入 URL、handler body/log；API JSON-only/会话语义不变。
**Non-Goals:** 不支持原生认证成功，不改变 API 415/CSRF，不读或保存 form body，不改 next/safe redirect 规则，不增加登录节流或第三方依赖，不处理 #244 退出竞态。

## Decisions

- Next 16 `15-route-handlers.md` 明确 page 与 route 不能同 segment，route group 同 URL 也冲突。因此 `src/app/login/native/route.ts` 与 `register/native/route.ts` 各导出一个小 `POST(request)`，由自身 mode 决定目标，显式 303 回 `/${mode}` readable page。proxy matcher 精确额外排除 `login/native$|register/native$`，保留 `/login/child`、`/register/child` 等保护；不公开 GET native 为页面，route 只 POST。
- 在 server account-services 提供唯一 `nativeAuthFallback(request, mode)`：仅读取 `new URL(request.url).searchParams.get('next')` 与 `mode`，经既有 safeNextPath 生成 `/<mode>?next=<safe>&native=unavailable`。没有 next 时只带 native marker。显式 303 `Response.redirect(new URL(location, request.url))`，无 Set-Cookie。不调用 request.body/json/formData/text，不读 credentials/cookie，不调用 account repository/logger。
- `CredentialsForm` 接受 `nativeUnavailable`（由 page searchParams `native === 'unavailable'` 推导）以 role=alert 显示「页面尚未加载完成，请重试」；页面自身保留原表单与登录/注册互链，作为返回入口。表单没有凭据回显。
- 原生 `action` 用 `/${mode}/native` 加原 safe next 的 URLSearchParams 表示；不引入 native flag 到 POST action。JS onSubmit 始终 preventDefault，以现有 FormData 同步捕获、JSON fetch、错误和 safe router.push 继续。
- 两个 native route 添加 pairing tests，断言 303、Location、外部/控制字符 next 归 `/`、bodyUsed false、无 cookie、不读 body；body 的 formData/json/text spy 都不调用。proxy matcher 测试同时公开两个精确 native POST endpoint 和保护相似子路径。OpenAPI 登记非 API fallback 是公开 navigation endpoint，不是成功认证 API，snapshot 人工核对；smoke 测 POST 303 及原 API 415。

## Risks / Trade-offs

- 直接外部 next → safeNextPath 保留原拒绝；重复 next 只取首值，和现有 page 对数组仅 null 的行为等价于不信任任意输入。
- 重定向后早期输入由浏览器 POST→GET 丢弃，这是明确不支持原生认证的既定边界，不得将凭据放进 query 来“保留”。
- handler 若读取 body 可能记录/持久化密码；以未消费 body、无 service 调用、无 cookie/log 的单测锁定。

Change surface: CredentialsForm + test，login/register page 与非 API route + pairing tests，account-services + test，account-auth e2e，proxy matcher tests（若需）, OpenAPI+snapshot，smoke/api.hurl，README，changeset。
Must preserve: 早输入 JSON exact payload、password mask/autocomplete、pending/errors、API 415 先拒绝无 body/account/session、safe-next、session binding、登录注册互链。
Must add/change: 原生 action 专用 public native endpoint、303 readable failure marker、表单 alert、精确 proxy exclusions，无 API schema/session/storage 变化。
Governing invariant: 未 hydration 的凭据 POST 永不进入 JSON authentication service 或 URL，只进入无副作用的公开页面 fallback，并以 303 GET 返回不携带凭据的 readable 表单。
Sibling surfaces: proxy public matcher、page searchParams、CredentialsForm hydrated/native submit、API requireJson、session cookies、OpenAPI/smoke、登录注册 next links。
Seams under test: 纯/路由 handler 单测、真实 CredentialsForm hydration、无 JS 和脚本阻断浏览器、真实 Postgres API/hydrated auth 和 hurl。
Required evidence: 四种无 JS mode/button|Enter + blocked script → readable 表单、无凭据 URL、401；API form POST 两 mode 415/无账号；正常 hydrated 登录注册仍成功；handler bodyUsed false/无 cookie/恶意 next 不逃逸。
Review focus: 不读 body/secret、不降低 JSON-only/CSRF、303 非 307、safe next、原生/hydrated 不互抢、matcher/OpenAPI/smoke 与早输入保持。
