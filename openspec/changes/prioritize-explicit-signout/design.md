# Design

## Context

SessionMenu 与 MapLibrary/AdminUserList 是 siblings，provider 只管理 map repository。logout 成功只 router.push('/login')；列表迟到 401 按 decision 0025 window.location.assign(next)。binding cookie render-key 不会自动 render，不能假定 provider 自然取消旧列表。CredentialsForm 的登录/注册也可能保持同一 document，因此全局退出布尔不能依靠 document replacement 清除。

## Goals / Non-Goals

**Goals:** 成功显式 logout 的 `/login` 不可被当前旧页面回调覆盖；真实过期仍 fresh-document next；logout 失败保持当前会话可重试；同 realm 登录/注册/受保护页面新生命周期不继承旧意图。
**Non-Goals:** 不改 API/cookie/RLS/401、不延迟 logout 等 list、不放宽 URL 断言、不引入保存期重定向、不处理 #239 通知或 #242 native form。

## Decisions

- 在现有 `MapRepositoryProvider` 的持久 client provider 边界提供轻量 session-navigation lifecycle，不新建第二套 provider/auth store。模块含单调 epoch 与明确 phase：`active → signing-out → public-auth → active`。`signOutStarted()` 仅在 logout response.ok 后、router.push('/login') 前递增 epoch 并进入 signing-out；list/reset 发起时捕获 epoch，401 必须同时满足 captured epoch 仍当前且 phase=active 才能导航。
- signing-out phase 跨 outgoing provider/binding remount 保留，不得由 protected SessionMenu mount 清除。401 handler 对 signing-out 或 public-auth 中的旧页面返回，不做 redirect。新请求即使在 binding remount 后发起，也因为 phase 非 active 被拒绝导航；单纯比较 epoch 不足。
- 若 `/login` 提交前有不同的受保护 pathname 提交，provider 保持 signing-out 并以 document replacement 重新发起精确 `/login`，使被中断的 client transition 不会把用户留在旧会话页面。相同 pathname 的 binding/provider remount 不重新发起导航。
- `publicAuthMounted()` 只能由实际 `/login`/`/register` 的 CredentialsForm mount effect 调用，建立 public-auth 边界（mount 不代表认证成功）。成功 hydrated login/register 的 response.ok 后、router.push(safeNext) 前调用 `resumeAuthenticatedNavigation()` 递增 epoch 并进入 active。已处于 public-auth 后直接访问受保护页时，由 pathname 明确从 public route 进入 protected route 的 provider effect 建立 active；旧 protected mount 不满足这个边界。StrictMode replay 必须幂等，不得在每次 mount 无条件 resume。
- MapLibrary/AdminUserList 的 load 捕获 epoch；401 先检查 lifetime/cancelled/mounted 与 epoch 仍当前，再按原 0025 document redirect。过期响应不是全局 suppression：signout 使旧 epoch 永远失效，后续 resume 也不能复活旧回调。Admin reset 发起时也捕获 epoch；list 和 reset 两条 401 都经过同一 guard，错误/secret/focus/locked 处理不变。
- 现有 provider 提供 navigation scope，独立挂载这些组件时也必须提供该 scope。context 只暴露稳定的 epoch/lifecycle 函数，不改变 map repository state，也不读取用户信息或 cookie。401 回调同步比较发起时捕获的 epoch 与当前状态。
- logout 失败/non-ok/network 绝不递增。登录失败不恢复。Editor pending-save expiry 不订阅此导航 epoch，继续保留编辑和 new-tab relogin，不被改为 redirect。

## Risks / Trade-offs

- 在受保护页面 mount 恢复 epoch 前必须同步 retire 旧 callbacks：旧 list 已捕获较小 epoch，后续增加仍无法导航。mount cleanup/effect 顺序与 StrictMode replay 必须用单测固定，不能靠 document replacement。
- 在现有 provider 加 lifecycle 增加少量 render/context 复杂度，但消除 module-global flag 污染合法登录。没有第二 auth source、cookie store 或请求串行化。

Change surface: MapRepositoryProvider + 新 session-navigation lifecycle helper/tests，SessionMenu，CredentialsForm，MapLibrary，AdminUserList 及测试，account-auth/m2 真实浏览器竞态，account-auth spec delta，patch changeset。
Must preserve: logout 204 清 cookie、失败 alert、真实过期 next、0025 document navigation、session binding/保存恢复、正常 hydrated auth、same-document account-switch guards。
Must add/change: 成功 logout epoch 优先、合法新生命周期恢复、旧 list/reset 401 失效，无 API/存储变更。
Governing invariant: 异步 list/reset 只能在发起时捕获的导航 epoch 仍为当前时触发过期导航；logout 或合法新生命周期使旧 epoch 永久失效，最终显式 logout 仍 `/login`。
Sibling surfaces: provider mount/binding、SessionMenu signout/mount、CredentialsForm login/register、MapLibrary list、AdminUserList list/reset expiry、editor pending-save（不订阅）。
Seams under test: provider lifecycle 单测、组件可控 promise/StrictMode、真实浏览器 route 延迟和最终 document URL。
Required evidence: logout 204 后仍挂载的 list 401 不覆盖 `/login`；初始/后续真实过期仍 next；logout 失败不设 epoch；login/register 和受保护 mount 恢复；admin reset 同 guard；cookie/session/API 不变。
Review focus: epoch 捕获与同步比较、mount resume 不复活旧回调、StrictMode、same-document auth、无 auth bypass、不新增第二套状态或错误取消编辑器保存。
