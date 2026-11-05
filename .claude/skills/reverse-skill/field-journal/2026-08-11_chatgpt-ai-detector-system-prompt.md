# 2026-08-11 ChatGPT AI Detector 系统提示词逆向

## 场景分类
JS 逆向 / Web 前端（Prompt 提取）

## 目标概述
逆向 chatgpt.com/writing/ai-detector/ 的 system prompt：定位工具提示词在客户端 bundle 中的位置与组装逻辑。

## 完整执行链路

1. **页面观察（Observe）**：headless Chromium 打开目标页，确认工具 UI（Writing tool prompt 文本框 + Send + 三个 starter 卡片：Reduce AI tone / Make it original / Polish writing）。编辑器是 ProseMirror（`[contenteditable]` div），不是 textarea。
2. **动态尝试（Capture）**：输入样例文本提交 → 命中 `/backend-anon/conversation/init`、`/backend-anon/conversation/prepare`、`/backend-anon/sentinel/chat-requirements/finalize`，返回 `{"persona":"chatgpt-noauth","force_login":true}` + turnstile required。**匿名路径被强制登录拦截**，动态抓包不可行（无登录态）。
3. **静态分析（Rebuild）**：切换策略，抓 `chatgpt.com/cdn/assets/manifest-*.js` 列出全部 chunk，浏览器内 fetch + 正则扫描 1175 个 chunk 的提示词特征串（`ai-generated` / `detector` / `perplexity` / `burstiness` / `writing_tool_slug` 等）。
4. **定位**：命中 `872491a3-c9mojeznyc7o9mzu.js`（写作工具注册表，43KB），内含全部 21 个 writing tool 的定义。AI Detector 定义在 `writing-tools.ai-detector.*` 消息键下。
5. **追组装逻辑**：`(_lang).writing._toolSlug-cgnsf23n.js` 路由 chunk 中 `En()` / `Tn()` 负责把 `composerPromptTemplate` + 控件值 + 源文本拼成最终用户消息；提交走 `WritingSuite=submit` 参数创建会话，**客户端不附加任何 tool 级 system message**。

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| curl 拿不到页面 HTML | Cloudflare managed challenge | 用浏览器会话（已过 CF）内 fetch，不依赖 curl | 5min |
| `tab.type` 打不进输入框 | 真实输入框是 ProseMirror contenteditable，textarea 是隐藏代理（rect 0x0） | `page.evaluate` focus ProseMirror + `page.keyboard.type` | 10min |
| 原生 setter + input 事件不触发 React | React 受控组件需要真实按键流 | 改用真实键盘事件 | 5min |
| `performance.getEntriesByType` 只显示 auth-cdn 资产 | 页面被 force_login 重定向到 auth 页，buffer 被冲掉 | 重新 goto 工具页后枚举，或直接抓 manifest | 10min |
| manifest 中有已删除的 chunk（`r.b749fb…`） | CDN BlobNotFound，manifest 未清理 | 跳过，不影响 | 2min |
| 匿名 API 强制登录 | sentinel turnstile 未通过 → `force_login:true` | 放弃动态，走纯静态 | 5min |

## 工具链发现

- **无需 js-reverse MCP**：本机无 `js-reverse_*` 工具面，直接用 xd://browser（真实 Chromium + puppeteer）完成 Observe/Capture/静态抓包，够用。
- 关键技巧：`fetch(chunkURL)` 在页面内取同源 CDN chunk，绕开 CF 与 CORS；manifest 可枚举全部 1175 个 chunk。
- sourcemap 存在（`//# sourceMappingURL=`），本任务未用到即可定位；要读源码可进一步拉 .map。

## 关键代码/命令

```js
// 扫描全部 manifest chunk 的特征串
const manifest = await (await fetch('https://chatgpt.com/cdn/assets/manifest-*.js')).text();
const names = [...new Set(manifest.match(/\/cdn\/assets\/[^"]+\.js/g) || [])];
// 对每个 name fetch 后 match /AI-generated|ai[- ]generated|detector/gi
```

组装逻辑（路由 chunk 原文）：
```js
// En: 模板 + 控件值
let t = intl.formatMessage(tool.composerPromptTemplate, wn(e));
// Tn: 追加源文本
let n = e.sourceText.trim();
return n ? `${t}\n\n${(hasAttachments
  ? [intl.formatMessage(Dn.attachedFilesAndTextInstruction), intl.formatMessage(Dn.sourceTextLabel), n]
  : [intl.formatMessage(Dn.sourceTextLabel), n]).join('\n')}` : t;
```

## 可复用的模式/脚本片段

- **无登录态提取 OpenAI writing tool 提示词模板**：工具定义全部在 `872491a3-*.js` 的 `hr=mr({...})` 注册表里，消息键 `writing-tools.<slug>.*`，模板键为 `promptTemplate`（`composerPromptTemplate`）。
- 其余写作工具（ai-humanizer / summarizer / grammar / paraphrase / citation 等）的模板、placeholder、starter 卡片同一处可取，无需登录。
- 会话提交参数 `WritingSuite=submit`，`composer_replay` 机制：工具页即会话 composer 的伪装形态。

## 对本包的改进建议

- 路由矩阵 "find frontend signature" → js-reverse 适合；但"提取网页工具/应用的 system prompt"这种纯静态 bundle 扫描任务，可考虑在 js-reverse 中加一个 `static-bundle-scan` 小节（manifest 枚举 + 特征串扫描）。
- tool-index 仍是 Windows 模板，本机（macOS）没有可用值，建议运行 refresh 脚本生成实际索引。

## 进化动作
- [ ] 更新了路由矩阵
- [ ] 更新了 tool-index
- [ ] 更新了 bootstrap-manifest
- [ ] 更新了子 skill 文档
- [x] 新增了 pitfalls 记录（本文件）
- [x] 无需更新

## 环境信息
- OS: macOS 14.5 (darwin 23.5.0, arm64)
- 工具版本: Chromium（headless，通过 xd://browser）
- 目标平台/版本: chatgpt.com writing suite（2026-08-11 抓取，manifest-8eb3398c.js 构建）
