# Tasks

## 1. Explicit navigation precedence and lifecycle

- [x] 1.1 先以 MapLibrary、AdminUserList list/reset 与 SessionMenu 的可控 promise 测试证明 logout 成功后旧 epoch 仍能导航 next；在现有 provider 增加唯一 epoch lifecycle，捕获发起 epoch 并在 401 同步比较，logout response.ok 后先递增再 `/login`。`pnpm vitest run src/app/providers/MapRepositoryProvider.session.test.tsx src/components/account/SessionMenu.test.tsx src/components/library/MapLibrary.test.tsx src/components/account/AdminUserList.test.tsx` 红/绿记录 exit 和关键失败。
- [x] 1.2 实现 `active → signing-out → public-auth → active`：CredentialsForm mount 只确认 public-auth，成功 response.ok 才恢复 active；protected mount 不能清除 signing-out，显式 public→protected 路由边界可开启 active。401 必须 captured epoch 当前且 phase=active。新增 cleared-binding/provider remount 在 `/login` held 时的新 list 401 红测，证明仍精确 `/login`；同 realm login/register、StrictMode、后续真实过期仍 next，logout 500/network 不递增。更新 `pnpm vitest run src/components/account/CredentialsForm.test.tsx src/app/providers/MapRepositoryProvider.session.test.tsx` 红/绿并保留 early-input/session binding。

## 2. Real browser race and sibling expiry

- [x] 2.1 在 account-auth 或 m2 acceptance 以 route 同时控制 logout 204 后 `/login` 完成和列表 401：401 在 outgoing page 仍 mounted 时到达，再释放 navigation，最终精确 `/login` 且不 next、cookie 无效；保留原 m2 signOut 精确断言、真实初始过期 `/login?next=%2F`、admin list/reset 真过期 next 和 editor pending-save/new-tab recovery。记录 `pnpm e2e e2e/account-auth.spec.ts e2e/m2-acceptance.spec.ts` 红/绿命令/exit/关键输出，截图/零意外 console，运行完整 `pnpm e2e`。

## 3. Delivery

- [x] 3.1 添加 patch changeset，运行 unit/coverage、integration、typecheck/lint/boundaries/docs/strict OpenSpec 和 #255 所需 CI 层；说明本修复与 #242 的依赖仅为同基线验证，不合并两个 issue。

Risk-pack mapping: auth/permissions/secrets → 1.1/2.1 不削弱 401/cookie/RLS；concurrency/shared state/ordering → 1.1/1.2/2.1 epoch、合法新生命周期与旧回调失效；legacy compatibility → decision 0025 next、logout failure、保存恢复和 acceptance；documentation → account-auth delta 与 changeset。未选 public API/schema/file IO/config/release，因为不改变这些边界。
