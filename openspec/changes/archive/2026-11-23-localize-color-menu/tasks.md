# Tasks

## 1. Localized labels and swatches

- [x] 1.1 先写 component 红测：六个菜单项可访问名为红/橙/黄/绿/蓝/紫，色块带对应 token class 且 `aria-hidden`；蓝选择和 grouped undo 仍存英文 `blue`。运行 focused test 确认旧英文 label/缺色块失败。
- [x] 1.2 实现 display-only label/colorToken 元数据与复用 node CSS 的 swatch，保持 id、dispatch、clear、keyboard 和持久化不变；不得复制颜色 hex。更新既有英文 unit locators，focused test 转绿。

## 2. Browser and qualification evidence

- [x] 2.1 更新 e2e helper 按中文名点击、保留英文状态断言；扩展现有 theme 用例逐一比较六个 swatch 与节点 computed background（light/dark），保存菜单截图且 console 零错误。运行 `pnpm verify-ui "node context menu"`。
- [x] 2.2 添加 patch changeset，运行 scoped unit、fmt/lint/typecheck/boundaries、strict OpenSpec/docs/decisions 与 required CI；审查 spec 英文只表示内部 token，OpenSpec archive 前确认最终 head checks 全绿。

最终 head `0756126b482e6ddfa90f0e8598ac70e8c8ebb695` 的 required CI run `45171491811`、E2E 与 Darwin/Linux installed native 全部通过；PR #271 已合并，#238 已关闭。
