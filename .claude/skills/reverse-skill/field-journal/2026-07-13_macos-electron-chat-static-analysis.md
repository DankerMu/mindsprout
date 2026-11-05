# 2026-07-13 macOS Electron 聊天客户端静态分析

## 场景分类

macOS / Electron / API 静态逆向

## 目标概述

对已安装的 macOS Electron 聊天客户端执行只读静态分析，确认应用架构、聊天请求链、完整性机制和模型权限边界；不导出凭据，不绕过服务端授权或风控。

## 完整执行链路

1. 读取应用 `Info.plist`、主可执行目录、Frameworks、Resources 和 PlugIns。
2. 使用 `file`、`otool`、`codesign` 确认 arm64 Mach-O、Electron 包装、签名、notarization 和 entitlements。
3. 使用 `@electron/asar` 解包 `app.asar` 到临时目录，读取 `package.json`，确认 Electron 版本和生产构建入口。
4. 对打包 JS 做字符串和上下文分析，定位 `{target_domain}/backend-api`、模型发现接口、会话管理接口和聊天流入口。
5. 还原聊天发送顺序：完整性准备 → conversation prepare → streaming conversation。
6. 确认 Sentinel proof-of-work / Turnstile 请求头及桌面附加认证、DeviceCheck、Integrity-State 头。
7. 从模型列表加载与过滤逻辑确认：客户端含模型显示常量，但实际可用模型和 reasoning effort 由服务端模型列表、账户状态与服务端执行共同决定。
8. 使用深度签名验证和 ASAR 清单复验结论，删除临时解包目录。

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| `tool-index.md` 是未刷新的模板 | 当前 skill 只提供 Windows/Linux 刷新指令，macOS 无对应生成器 | 通过绝对路径 `/usr/bin/*` 与 `which npx` 实测可用性 | 低 |
| 打包 JS 单行极长，普通 grep 上下文截断 | Vite/Rolldown 生产压缩 | 用 Python 按字面量索引提取前后上下文，避免整体格式化 | 低 |
| Source map 无 `sourcesContent` | 发布包映射文件未内嵌原源码 | 直接分析压缩模块中的类方法和常量关系 | 中 |
| `Info.plist` ASAR hash 与文件 SHA-256 不一致 | Electron ASAR integrity 可能使用特定 hash 计算口径，不能直接等同整文件 SHA-256 | 不将该对比作为篡改结论；以 `codesign --verify --deep --strict` 为完整性证据 | 低 |

## 工具链发现

- macOS 系统工具：`/usr/bin/file`、`/usr/bin/otool`、`/usr/bin/codesign`、`/usr/bin/shasum`
- ASAR：`/opt/homebrew/bin/npx --yes @electron/asar`
- 文本上下文提取：Python 标准库
- 目标是 Electron 应用；主 Mach-O 只是 Chromium/Electron 启动壳，业务逻辑主要在 `Resources/app.asar`。

## 关键代码/命令

```bash
/usr/bin/file "{app_path}/Contents/MacOS/{executable}"
/usr/bin/otool -L "{app_path}/Contents/MacOS/{executable}"
/usr/bin/codesign -d --entitlements - "{app_path}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "{app_path}"
/opt/homebrew/bin/npx --yes @electron/asar extract "{app_path}/Contents/Resources/app.asar" "{temporary_dir}"
```

确认的请求结构：

```text
POST {target_domain}/backend-api/sentinel/chat-requirements/prepare
POST {target_domain}/backend-api/f/conversation/prepare
POST {target_domain}/backend-api/f/conversation   (stream)
```

完整性头结构：

```text
OpenAI-Sentinel-Chat-Requirements-Prepare-Token
OpenAI-Sentinel-Chat-Requirements-Token
OpenAI-Sentinel-Proof-Token
OpenAI-Sentinel-Turnstile-Token
X-OpenAI-Attach-Auth
X-OpenAI-Attach-Desktop-Surface
X-OpenAI-Attach-DeviceCheck-Token
X-OpenAI-Attach-Integrity-State
```

## 对本包的改进建议

- 增加 macOS 版 `refresh-tool-index.sh`，避免 `tool-index.md` 在 Darwin 上长期保持模板状态。
- 在 macOS/Electron 路由中明确：先分析 ASAR，再决定是否深入主 Mach-O；业务 API 通常不在启动壳。
- 增加“ASAR integrity 字段不一定等同整文件 SHA-256”的说明，避免误报篡改。

## 可复用的模式/脚本片段

```python
# 对压缩后的单行 bundle 定位字面量并提取有限上下文。
idx = source.find(needle)
context = source[max(0, idx - 800): idx + 1800]
```

判定模型权限边界时，同时寻找：

```text
GET /models
GET /models/slugs
GET /tpp/models/
account plan_type
supportedReasoningEfforts
includeHidden / useHiddenModels
服务端 conversation 返回错误或 verification
```

客户端出现模型名只证明 UI/兼容代码知晓该模型，不证明当前账户可调用。

## 进化动作

- [ ] 更新了路由矩阵
- [ ] 更新了 tool-index
- [ ] 更新了 bootstrap-manifest
- [ ] 更新了子 skill 文档
- [x] 新增了 pitfalls 记录
- [ ] 无需更新

## 环境信息

- OS: macOS Darwin arm64
- 工具版本: Electron 42.1.0；Chromium 150；`@electron/asar` 由 npx 获取
- 目标平台/版本: macOS arm64 Electron 应用，版本信息已脱敏为当前安装版本证据，不记录账户或凭据

## 脱敏要求

- 未记录 Cookie、JWT、access token、设备标识或账户信息。
- 目标域名使用 `{target_domain}`，应用路径使用 `{app_path}`。

## 索引同步

已在 `_index.md` 的 Web / API / 渗透测试分类下新增本记录，并更新统计。

---
<!-- [进化统计] 本包累计完成项目: 8 | 本次新增模式: 2 | 本次修复工具链问题: 0 -->
