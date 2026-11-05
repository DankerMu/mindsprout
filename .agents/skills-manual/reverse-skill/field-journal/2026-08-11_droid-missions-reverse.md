# [2026-08-11] Droid Missions 逆向提取（Bun 单文件可执行）

## 场景分类
二进制分析 / JS 逆向（Bun compiled executable 内嵌 bundle 提取）

## 目标概述
逆向分析 `/Users/chenwenjie/.local/bin/droid`（Factory droid CLI v0.193.0），提取 missions 功能全部 prompt 与业务逻辑，锚点 https://docs.factory.ai/missions/overview

## 完整执行链路

1. 路由：`routing.md` → `reverse-engineering/`（Go/Rust/编译产物分支）+ `radare2/`（CLI 侦察）
2. 目标识别：`file` → Mach-O 64-bit arm64 EXECUTE；`otool -L` → libicucore/libc++（JSC 特征）；`strings | grep bun` → Bun `--compile` 单文件（JavaScriptCore + Bake）
3. 版本确认：`droid --version` → 0.193.0；`~/.factory/` 下发现 `prompts/`、`missions/`、`droids/` 磁盘明文基线（3 个月前同步）
4. 磁盘基线：`~/.factory/prompts/` 10 个 mission prompt 文件，作为交叉验证
5. Bundle 定位：`strings -a -t d -n 5` 全量转储（294,481 行）；Python 扫描可打印区段 → 最长 19.1MB 区段，起点 62,734,363（前导 `/$bunfs/root/droid`，内容 `// @bun`）
6. Bundle 提取：`62734363..81891237` → 19,156,874 B（sha256 f3c0b45b…）
7. Prompt 提取：写带状态 JS 字符串字面量提取器（单/双引号/反引号 + 模板 `${}` 深度），按 10 个标题锚点提取完整字面量、unescape 还原
8. Code slice 提取：按唯一字符串锚点 + 括号平衡切割 10 个模块（executors/MissionRunner/MissionFileService/skill validation/工具别名）
9. 业务逻辑：深读 mission-runner 状态机、start-mission-run 门禁、end-feature-run 契约、验证注入、失败分类
10. 新旧对比：与 2026-07-01 旧提取（SHA 6027f68d）逐文件 diff → 仅 orchestrator core prompt 实质性变更
11. 产出：`droid-reverse-2026-08-11/`（README、business-logic.md、prompt-system/ 11 文件、code/core-logic + raw-slices、bundles/）

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| 首版字符串提取器只抓 4.9 万字面量（旧版 35.5 万） | 普通正则不支持模板插值/转义 | 写带状态扫描器（`${}` 深度跟踪 + JS unescape） | 10min |
| 括号平衡切出的 code slice 只有 160B | 锚点在方法体内，先切到内层块 | 改为"锚点向前找 `class X{`/`function X(`/`M(()=>{` 模块注册点 + 平衡到闭合" | 15min |
| 05/07/10 三个 slice 偏小 | 对应模块在新版中重构/拆分（enforceMissionAccess 移入 08） | 对照旧版 raw slice 逐段核对，按模块注册点重新定位 | 10min |
| 浅正则 sourcemap 扫描 0 命中 | 真 sourcemap 含嵌套对象，`[^{}]*` 不匹配 | 改用 `sourcesContent`/`mappings` 标记深扫 | 2min |
| 新二进制 bundle 起点与旧版相同（62734363） | 巧合：bun 运行时布局未变，仅内容变长（17.5→19.1MB） | 直接复用旧起点评判，尾部重新扫描 | 1min |

## 工具链发现

- **Bun `--compile` 可执行文件特征**：Mach-O + libicucore/libc++ + `// @bun` 头部 + `/$bunfs/root/droid` 标记 + 明文内嵌压缩 JS（可 strings 直接提取）
- 无 sourcemap（仅一个 Next.js polyfill sourcemap，与应用代码无关）——prompt 只能走字符串字面量管线
- node 可用；`go version -m` 判 Go 失败（非 Go 二进制）
- 本机无 rabin2/r2（tool-index 未生成），纯 strings + Python 足够

## 关键代码/命令

```bash
strings -a -t d -n 5 /Users/chenwenjie/.local/bin/droid > /tmp/droid.strings
# bundle 锚点: // @bun @ 62734363, 前导 /$bunfs/root/droid
# 提取: dd/python 切 62734363..81891237 → main-bundle.min.js (19.1MB)
# prompt: 带状态 JS 字符串提取器（反引号 + ${} 深度 + unescape）
# code: 唯一字符串锚点 + 括号平衡 → 10 slices
```

## 对本包的改进建议

- `routing.md`：新增「Bun compiled executable」→ `js-reverse/` 或 `reverse-engineering/languages-compiled.md` 路由条目（当前 Go/Rust 分支未覆盖 Bun/JS 单文件）
- 本机 tool-index 未生成（模板状态），建议跑 refresh 脚本

## 可复用的模式/脚本片段

- **Bun `--compile` bundle 定位法**：扫描最长可打印区段 → 校验前导 `// @bun` + `/$bunfs/root/droid` → 提取
- **带状态 JS 字符串字面量提取器**（模板插值深度 + 完整 unescape）——可提取任意 minified bundle 中的 prompt/文案
- **code slice 切割**：模块注册点正则（`var X=M(()=>{` / `class X{` / `import … from`）+ 括号平衡

## 进化动作
- [ ] 更新了路由矩阵（建议：Bun compiled → js-reverse）
- [ ] 更新了 tool-index（建议：本机跑 refresh）
- [ ] 更新了 bootstrap-manifest
- [ ] 更新了子 skill 文档
- [x] 新增了 pitfalls 记录（本文件）
- [ ] 无需更新

## 环境信息
- OS: macOS 14.5 (Darwin 23.5.0, arm64)
- 工具版本: bun ~/.bun/bin/bun, node 24 (/opt/homebrew/bin), go 1.x
- 目标平台/版本: droid 0.193.0 (Mach-O arm64, Bun compiled)

## 索引同步
- [ ] 更新 `_index.md` 按场景分类（二进制/JS）
- [ ] 更新统计
