# Tasks

## 1. Safe public form fallback

- [x] 1.1 先为 `/login/native`、`/register/native` 添加红测（page 与 route 同 segment 禁止，故不用同页 handler）：303 到同 mode 的 safe next/native marker，外部/控制字符 next 归 `/`，body/formData/json/text 未读、bodyUsed false、无 cookie/service 调用；proxy matcher 精确公开两个 native POST endpoint、保护相似子路径。实现 account-services 唯一 fallback、两个 route handlers、matcher 并转绿。`pnpm vitest run src/app/login/native/route.test.ts src/app/register/native/route.test.ts src/app/server/account-services.test.ts src/proxy.test.ts` 红/绿均记录命令、exit 和相关输出。
- [x] 1.2 先更新 CredentialsForm 原生 `/${mode}/native` action/native alert 单测为红；实现专用非 API POST action 和「页面尚未加载完成，请重试」，保留早输入 JSON、pending/errors、互链、正常 safe next 全绿。`pnpm vitest run src/components/account/CredentialsForm.test.tsx` 红/绿均记录命令、exit 和相关输出。
- [x] 1.3 保留 login/register API form-encoded 415/无账号/无 session 单测，补 OpenAPI+snapshot 与 smoke POST 303、原 API 415；运行 `pnpm test:contract` 和 `pnpm dev:bg && pnpm smoke && pnpm dev:stop`。

## 2. Actual native and hydrated browser behavior

- [x] 2.1 将 `e2e/account-auth.spec.ts` native button/Enter × login/register 与阻脚本断言改为专用 `/mode/native` POST、303 readable 表单、无凭据 URL、401、safe next，先红后绿；保留/补直接 API form POST 双 mode 415 无副作用。`pnpm e2e e2e/account-auth.spec.ts` 红/绿均记录命令、exit 和相关输出，含 legacy recovery 真实浏览器、截图/零 console。

## 3. Delivery

- [x] 3.1 更新 README Known Limitations（原生提交失败回表单、需等待 hydration），添加 patch changeset，运行 `pnpm test:unit`、`pnpm test:integration`、完整 `pnpm e2e`、typecheck/lint/boundaries/docs/strict OpenSpec；记录 CI native installed 独立 readiness 结果。

Risk-pack mapping: public route entry → 1.1/1.3 proxy 公开 page POST 和 OpenAPI/smoke；auth/permissions/secrets → 1.1/1.3/2.1 不读 body、无 session/account、API 415、无 URL secret；legacy compatibility → 1.2/2.1 早输入、正常 JSON、session recovery；error handling → 1.1/2.1 readable alert/303/失败无副作用；documentation → 1.3 OpenAPI/smoke 与 3.1 README/changeset。未选 schema（现有 Credentials schema 不变）、file IO、resource limits、release/dependency，因为无这些改动。
