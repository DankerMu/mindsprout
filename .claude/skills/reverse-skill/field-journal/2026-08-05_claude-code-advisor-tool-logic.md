# 2026-08-05 Claude Code CLI advisor 功能逻辑逆向

## 场景分类
二进制分析 / JS bundle 静态逆向（Bun 编译 Mach-O）

## 目标概述
分析 claude CLI 2.1.222（Bun 编译原生二进制，内嵌明文 minified JS bundle）中 advisor 功能的完整逻辑：env 门控、工具注入、模型选择、API 交互。

## 完整执行链路

1. `file` 确认目标为 Mach-O arm64（271MB），symlink 指向 `~/.local/share/claude/versions/2.1.222`。
2. 内置 grep 工具对大文件只搜前 4MB → 改用 Python `re.finditer` 全文件字节搜索拿偏移（二进制未压缩，JS 明文）。
3. 关键字符串定位：`CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL` ×6 处；`advisor` ×336 处。核心代码簇在 245.6MB 区域。
4. 提取 245617300-245619800：完整 advisor 模块函数簇（dQ/USd/TPo/bNs/SNs/a4e/nun/kUt/KJe/jSd/TNs/Xgt/WSd/vPo/EPo/vNs/GSd + 常量 Biy=2, qSd=[fable,opus,sonnet], zSd prompt）。
5. 250227479：查询执行模块——工具注入 `if(dQ()&&wL())p.push(nts)`、`y=d?vPo(i.advisorModel,g):void 0`、API 工具注入 `oe.push({type:"advisor_20260301",name:"advisor",model:y})`、system prompt 注入 `...y?[zSd]:[]`。
6. 246379380：查询循环内 attempt-model 复核 `sr=V_y(At,It)||!Ze.advisorModel||WSd(At,Ze.advisorModel)?Ze.advisorModel:void 0`。
7. 246417676：`V_y` = canonical model 相等比较（fallback 检测）。
8. 240923650：`wL()=glo()&&!qTe()`；`glo()` = firstParty|anthropicAws|anthropicGoogleCloud|foundry；`qTe()` = CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS || HIPAA。
9. 238796183：模型目录（15 模型，8 个有 advisor_rank: claude-3-5-sonnet:2, claude-sonnet-5:3, claude-opus-4-0:3, claude-opus-4-7/4-8/opus-5:4, fable-5/mythos-5:5）。
10. 259602288：二进制内嵌 API 文档——advisor 是 server-side tool，定义 `{"type":"advisor_20260301","name":"advisor","model":"..."}`，executor/advisor 配对表。
11. 255159220-255163255：`/advisor` 命令（V$f 模块，f0S=call, dui=applyAdvisor）+ 设置 UI（z$f 对话框）+ 持久化 `Mi("userSettings",{advisorModel})` / 远程 `sendControlRequest({apply_flag_settings})`。
12. 260342900-260343500：CLI `--advisor <model>` 参数完整校验链。
13. 251393225：`Vra()` 无 advisor 时从 wire 消息剥离 advisor_tool_result/server_tool_use 块，替换为 `[Advisor response]`。
14. 98009960：错误/警告字符串区（Skipping advisor 三连 + base model 无 rank 警告）。
15. 对比内嵌 zSd 与仓库 `claude-code-system-prompts/system-prompts/system-prompt-advisor-tool-instructions.md`：空白归一化后完全一致。

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| grep 工具只搜大文件前 4MB | 内置 grep 对大文件截断 | Python 全文件字节搜索 + 偏移定位 | 1min |
| 长行 minified 输出被截断 | 单行数万字符 | 在 `;{}` 后插换行再 read | 1min |
| minified 变量名（vPo/dQ/wL）无法 grep 语义 | 无源码映射 | 偏移窗口打印 + 函数签名推断 | 30min |

## 工具链发现

- Python 3 字节级搜索是 Bun 二进制静态分析主力（比 strings/grep 高效）
- 二进制内嵌 API 文档是金矿：259602288 处直接给出 advisor 工具定义与配对表
- `argumentHint` getter、`isHidden` getter 揭示 TUI 集成方式

## 关键代码/命令

```python
# 全文件模式搜索（核心手法）
import re
data = open(path,'rb').read()
offs = [m.start() for m in re.finditer(re.escape(pat), data)]

# 美化长行
out = re.sub(r'([;{}])\s*', r'\1\n', seg)
```

## 可复用的模式/脚本片段

- Bun 编译 CLI 逆向方法论：env 变量字符串 → 代码簇 → 函数链 → 内嵌文档交叉验证
- advisor 类功能的门控模式识别：`env 开关 → provider 检查 → 远程 flag → 目录 rank 检查 → 每查询复核`

## 进化动作
- [ ] 更新了路由矩阵
- [ ] 更新了 tool-index
- [ ] 更新了 bootstrap-manifest
- [ ] 更新了子 skill 文档
- [ ] 新增了 pitfalls 记录（大文件 grep 截断 → Python 字节搜索）
- [x] 无需更新

## 环境信息
- OS: macOS Darwin 23.5.0 arm64
- 目标: claude CLI 2.1.222 (Bun 编译 Mach-O, ~/.local/share/claude/versions/)
