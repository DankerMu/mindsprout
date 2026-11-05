# 🌱 MindSprout

**AI 驱动的思维导图生成器** — 输入一句话或一段文字，让想法自动生长成结构化的思维导图。

> 名字来自 *mind* + *sprout*（发芽）：你给出一颗种子想法，AI 帮它长出枝叶。

## 愿景

- **从零到图**：一句话主题 → AI 生成完整导图骨架
- **逐节点生长**：选中任意节点，让 AI 继续展开、补充或精简
- **文本导入**：粘贴文章 / 会议纪要 / 笔记，自动提炼为导图
- **自由编辑**：拖拽、重排、改色，AI 生成的内容随时可手动修改
- **导出分享**：PNG / SVG / Markdown / OPML / FreeMind

## 规划中的技术栈

| 层 | 选型（待定） |
|---|---|
| 前端 | React + TypeScript + Vite |
| 画布 | React Flow 或 Markmap |
| AI | Claude API（结构化输出生成节点树） |
| 状态 | Zustand |
| 后端 | 轻量 API 代理（隐藏 Key、做限流） |

## 路线图

- [ ] 项目脚手架与基础画布
- [ ] 主题 → 导图的 AI 生成
- [ ] 节点级 AI 展开
- [ ] 文本导入
- [ ] 导出格式
- [ ] 本地保存 / 云端同步

## 开发

```bash
git clone https://github.com/DankerMu/mindsprout.git
cd mindsprout
# 脚手架搭建后补充安装与启动命令
```

## 许可

MIT
