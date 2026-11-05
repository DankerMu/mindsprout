# 2026-08-10 workbuddy-dmg-electron-frontend-extraction

## 场景分类
macOS Electron 应用逆向 / 前端 JS 提取 / 设计系统提取

## 目标概述
从 WorkBuddy darwin-arm64 DMG（腾讯 WorkBuddy 桌面版 5.3.11，Electron）提取前端代码、样式、设计 token、图片/图标/字体等全部可提取资源。

## 完整执行链路

1. `hdiutil imageinfo` 确认 DMG 类型（UDIF zlib）→ `hdiutil attach -nobrowse -readonly` 挂载
2. 定位 `WorkBuddy.app/Contents/Resources/app.asar`（270MB）+ `app.asar.unpacked`（355MB）+ `vendor/`
3. `npx @electron/asar extract` 解包 → renderer/ 下 988 JS + 90 CSS + 图片/字体/音频
4. 关键发现：909/988 JS chunk 保留 `//#region <原始源码路径>` 注释 → 自写 Node 脚本按 region 重组源码
5. 重建出 18070 个源文件（104MB），含 `packages/agent-ui`（3091）、`cb-chat-ui`、`workbuddy-server` 等 13 个内部包
6. 设计系统提取：cb-bridge CSS chunk 解析出 light 603 / dark 857 个 `--wb-*` token → design-tokens.json
7. 架构分析：路由图谱（route-config.ts）、主进程（main/index.js）、preload IPC contract、内置插件/skills/welcomemode
8. 资源分类归档（css/js/images/icons/fonts/sounds/splash）+ 报告

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| asar extract 报 ENOENT app.asar.unpacked | asar 内 unpacked 条目引用外部目录，只拷了 asar | 把 `app.asar.unpacked/` 一并拷到 asar 旁再 extract | 1min |
| `--wb-*` token 值不在 CSS | 语义 token 由 JS/SCSS 编译后注入，主 palette 在 cb-bridge chunk CSS | 全量 grep `--wb-palette-` 定位 cb-bridge-BGn0PDcg.css | 2min |
| SCSS/LESS region 块内容为空 | SCSS 已编译进 CSS，region 只剩空 init | 改从编译后 CSS 提取 token 真源 | 1min |

## 工具链发现

- `npx -y @electron/asar`：Node 26 下可用；解包大 asar（270MB）需注意 unpacked 外部目录
- `sips -s format png icon.icns --out x.png`：icns→png 一键转换
- `hdiutil attach -readonly` + 用完 detach：只读挂载安全
- 本机无 sourcemap，但 `//#region` 注释重建源码 = 本任务最大杠杆

## 关键代码/命令

```
hdiutil attach -nobrowse -readonly work.dmg -mountpoint /tmp/mnt
npx -y @electron/asar extract app.asar extracted
sips -s format png icon.icns --out app-icon.png
# region 重组核心（见 ~/Downloads/workbuddy-re/reconstruct-sources.js）
regionRe = /\/\/#region\s+(\S+)\r?\n([\s\S]*?)\/\/#endregion/g
```

## 对本包的改进建议

- 路由矩阵缺 "macOS Electron app / DMG 前端提取" 入口：`js-reverse/` 偏网页签名，`reverse-engineering/platforms.md` 偏 Mach-O。建议新增 `electron-app-extraction` 或并入 platforms.md 加一节
- bootstrap 是 PowerShell/Windows 导向，macOS 主机上全部不适用；tool-index 应标注平台相关性

## 可复用的模式/脚本片段

- **Vite region 源码重建脚本**（reconstruct-sources.js）：对任何保留 `//#region` 的 Vite/rolldown bundle 通用，输出原始文件树 + _SOURCE-INDEX
- 设计 token JSON 解析：按 `:root`/`body[data-vscode-theme-name]` 选择器分 mode 抓 CSS 变量

## 进化动作
- [x] 新增了 pitfalls 记录（本文件）
- [ ] 更新了路由矩阵
- [ ] 更新了 tool-index
- [ ] 更新了 bootstrap-manifest
- [ ] 更新了子 skill 文档
- [ ] 无需更新

## 环境信息
- OS: macOS 14.5 (arm64)
- 工具版本: node v26.5.0, @electron/asar (npx), hdiutil
- 目标平台/版本: macOS arm64, WorkBuddy 5.3.11.35348084-45487630

## 脱敏要求
- 目标为本地下载的公开分发 DMG，域名/端点均为产品公开信息；无 token/凭据入档。

## 索引同步
已同步 `_index.md`：场景=macOS Electron 应用逆向；模式=region 源码重建 + 设计 token 提取；实体=workbuddy / tencent / electron。
