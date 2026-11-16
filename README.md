# 🌱 MindSprout

**AI 驱动的思维导图生成器** — 输入一句话或一段文字，让想法自动生长成结构化的思维导图。

> 名字来自 _mind_ + _sprout_（发芽）：你给出一颗种子想法，AI 帮它长出枝叶。

## 愿景

- **从零到图**：一句话主题 → AI 生成完整导图骨架
- **逐节点生长**：选中任意节点，让 AI 继续展开、补充或精简
- **文本导入**：粘贴文章 / 会议纪要 / 笔记，自动提炼为导图
- **自由编辑**：拖拽、重排、改色，AI 生成的内容随时可手动修改
- **对话改图**：侧边栏和 AI 对话，实时增删改节点
- **模型自由**：内置 Claude 与 OpenAI 兼容接口，也可以填自己的 Key 或连本地 Ollama
- **导出分享**：PNG / SVG / Markdown / OPML

## 技术栈

| 层          | 选型                                                               |
| ----------- | ------------------------------------------------------------------ |
| 框架        | Next.js 16 + TypeScript                                            |
| 画布        | React Flow + d3-hierarchy                                          |
| 状态        | Zustand + undo/redo                                                |
| AI          | 提供方抽象层：Claude、OpenAI 及兼容接口、本地开源模型（Ollama 等） |
| 数据 / 认证 | Postgres（RLS）+ 自建用户名密码账号（决策 0023）                   |
| 部署        | Vercel                                                             |

详见 [docs/PRD.md](docs/PRD.md) 与 [docs/TECH.md](docs/TECH.md)。

## 路线图

- [ ] M1 画布：手动建树、拖拽、布局、本地保存
- [ ] M2 账号与云存储
- [ ] M3 主题生成（Claude / OpenAI 兼容）
- [ ] M3.5 开源模型与自定义提供方
- [ ] M4 节点级生长
- [ ] M5 文本导入与对话式
- [ ] M6 导出与打磨

## Known Limitations

- **无 AI**：暂不支持 AI 生成、展开或对话改图，导图需手动编辑。
- **保存窗口**：最后一次已提交的编辑后等待 500 ms 触发自动保存，连续编辑会重置计时；立即刷新可能丢失自上次成功保存以来的全部待保存修改，包括早于 500 ms 的修改。页面卸载时仅尽力保存，不保证成功；未提交的编辑草稿或保存失败的修改不保证保留。
- **仅 LR 布局**：只支持从左向右排列，不能切换布局方向。
- **无导出**：暂不支持 PNG、SVG、Markdown 或 OPML 导出。
- **开发热更新**：原生修复的平台范围与独立的 SPA-only HMR 限制见 [原生开发说明](docs/engineering/native-hmr.md#known-limitations)。

## 开发

```bash
git clone https://github.com/DankerMu/mindsprout.git
cd mindsprout
```

启动 `pnpm dev` 前，执行[开发工作流](AGENTS.md#development-workflow)中的完整本地 setup；环境配置与日常命令也以该页为准。
原生 HMR 修复的构建、验证、安装和故障处理见 [原生开发说明](docs/engineering/native-hmr.md)。
依赖补丁（pnpm `patchedDependencies`）的维护与移除见 [依赖补丁说明](docs/engineering/dependency-patches.md)。

### E2E

完成上述本地 setup、确认 Postgres 16 可用后，运行 `pnpm exec playwright install chromium` 安装浏览器，再运行 `pnpm e2e`；单项检查用 `pnpm verify-ui "<测试标题正则>"`。

两个命令都先创建或重置 `app_e2e`、迁移并应用开发角色 bootstrap，再由 Playwright 启动独占的 `http://localhost:3100` 服务，测试结束后关闭服务。输出位于 `.next-e2e/`，截图仍在 `.run/ui-evidence/`；开发服务 `:3000` 与默认 `.next/` 不受影响。

仓库根目录的 `.env` 或导出的环境变量必须同时提供 `DATABASE_URL`（应用角色）和 `MIGRATION_DATABASE_URL`（可创建数据库的 owner）；导出值优先。准备脚本、Playwright 和服务启动脚本分别加载并校验环境，将两个连接目标强制派生为 `app_e2e`，不会使用 `app_dev`。数据库 URL 只注入独占 Next 子进程的环境，不写入 Playwright 配置或启动命令，原生 JSON 报告不携带这些凭据。直接运行 Playwright 不负责重置数据库，缺少或无效的 URL 会在启动服务前报错。

同一数据库环境中的 `e2e` 和 `verify-ui` 必须串行执行：每次调用都会清空 `app_e2e`，不可并发运行或存放需保留的数据。端口 `3100` 必须空闲，`BASE_URL` 不能切换测试目标。隔离约定见[决策 0026](decisions/implemented/testing/0026-isolated-e2e-database-and-server.md)。

## 许可

MIT
