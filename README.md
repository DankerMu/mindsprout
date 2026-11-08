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
| 框架        | Next.js 15 + TypeScript                                            |
| 画布        | React Flow + d3-hierarchy                                          |
| 状态        | Zustand + Immer + undo/redo                                        |
| AI          | 提供方抽象层：Claude、OpenAI 及兼容接口、本地开源模型（Ollama 等） |
| 数据 / 认证 | Supabase（Postgres + Auth + RLS）+ Drizzle                         |
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
- **仅浏览器存储**：导图保存在本地 IndexedDB，无云端备份或同步；IndexedDB 无法打开时仅保存在当前会话内存中，完整刷新页面后这些数据会丢失。
- **保存窗口**：最后一次已提交的编辑后等待 500 ms 触发自动保存，连续编辑会重置计时；立即刷新可能丢失自上次成功保存以来的全部待保存修改，包括早于 500 ms 的修改。页面卸载时仅尽力保存，不保证成功；未提交的编辑草稿或保存失败的修改不保证保留。
- **仅 LR 布局**：只支持从左向右排列，不能切换布局方向。
- **无导出**：暂不支持 PNG、SVG、Markdown 或 OPML 导出。

## 开发

```bash
git clone https://github.com/DankerMu/mindsprout.git
cd mindsprout
# 脚手架搭建后补充安装与启动命令
```

## 许可

MIT
