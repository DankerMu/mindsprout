# 2026-08-07 macOS replayd 高 CPU 排查

## 场景分类
系统诊断 / macOS 进程分析

## 目标概述
分析本机 pid=90599 (replayd) 高 CPU 原因，并盘点当前 CPU 占用最高的进程。

## 完整执行链路

1. `ps -p 90599` 确认进程身份：`/usr/libexec/replayd`（ReplayKit 屏幕录制/广播守护，launchd 拉起）
2. `sample 90599 3` 采样：发现 ~92% 采样点处于等待态（`__workq_kernreturn`/`semaphore_wait_trap`/`mach_msg2_trap`），但累计 CPU 84:37:13 / 运行 65.7h = **平均 1.29 核满载** → 判定为突发型消耗，采样窗口需拉长
3. 调用图分析：热点在 `DispatchQueue_23: com.apple.NSXPCListener.service.com.apple.replayd` — 每次新连接 → `service_connection_handler_make_connection` → replayd 内 `+[NSXPCInterface interfaceWithProtocol:]` 全量重建协议签名（`setProtocolMetdataWithMethods` → `signatureWithObjCTypes:` → `__CFSearchSignatureROM`/`_platform_strcmp`）+ `NSBundle initWithPath:` stat/access 文件检查
4. 队列名暴露连接方：`com.apple.NSXPCConnection.user.com.apple.replayd.{4839,45664,92687}` — 全部是 Chrome 进程（92687 是 omp 派生的 Chrome，PPID=17754 bun/omp）
5. `log show --predicate 'process == "replayd"'`：确认连接风暴 — `RPConnectionManager processNewConnection:` accepted PID 4839/92687 → consumeSandboxExtension → 随后 `xpc_connection_cancel()` invalidated，30 分钟内多次连接/取消循环
6. 并行盘点全系统：`ps aux | sort -nrk 3` + `top -l 2`，发现 loadavg 96-130（10 核机器），85+ 个 R 态进程 — 系统级过载
7. iTerm2 也采样（95.7% CPU）：热点为 `__accept`/`writev`/`dataWrite`/`__select` — 终端 I/O 忙（omp 大量输出），非死循环

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| sample 3s 显示空闲但 ps 显示 82% CPU | replayd 是突发型消耗，短窗口采到静默期 | 拉长到 10s + 对比累计 CPU 时间/运行时长 | 5min |
| stat 调用栈 grep 无匹配 | 行内有双空格 `stat  (in libsystem_kernel` | 修正正则空格数 | 1min |
| ps %CPU 是衰减均值，误判"当前"占用 | macOS ps 的 %CPU 为加权历史均值 | 用 `top -l 2 -s 1` 取第二次快照看瞬时值 | 2min |

## 工具链发现
- `sample` + 调用图尾部 "Sort by top of stack" 是 macOS 进程热栈最快入口
- `log show --predicate 'process == "X"'` 直接看到守护进程的接受/拒绝/取消日志，比猜栈更快定位连接风暴
- NSXPC 队列名自带客户端 PID（`com.apple.replayd.peer[PID]`），是连接方身份的直接证据

## 关键代码/命令

```bash
ps -p 90599 -o pid,ppid,user,%cpu,%mem,etime,command
sample 90599 10 -file /tmp/s.txt        # 长采样抓突发
# 调用图 grep 热点: NSXPCInterface / signatureWithObjCTypes / xpc_connection_cancel
log show --last 30m --predicate 'process == "replayd"' --style compact
top -l 2 -s 1 -o cpu -n 15 -stats pid,command,cpu,time,threads   # 瞬时 CPU 排行
vm_stat; sysctl vm.loadavg               # 内存压缩压力 + 负载
ps -eo state,pid,comm | awk '$1 ~ /^R/{r++} END{print r}'  # R 态进程数 vs 核数
```

## 对本包的改进建议
- macOS 进程诊断（高 CPU/连接风暴）在路由矩阵中无明确入口，当前归入 `reverse-engineering/platforms.md` 的 macOS 节尚可，但可考虑新增 "系统诊断" 场景行

## 可复用的模式/脚本片段
- **macOS 高 CPU 排查套路**：ps 身份确认 → sample 长采样 → 调用图 grep 业务帧 → 队列名提取客户端 PID → log show 验证连接风暴 → top -l 2 验证瞬时占用 → loadavg/R 态数判断系统级过载
- **关键判据**：累计 CPU 时间 ÷ 运行时长 > 1 核 = 真实持续消耗；短采样全等待 ≠ 空闲（突发型）

## 进化动作
- [x] 更新了路由矩阵（本次未改动，建议项已记录）
- [ ] 更新了 tool-index
- [ ] 更新了 bootstrap-manifest
- [ ] 更新了子 skill 文档
- [x] 新增了 pitfalls 记录（本次日志）
- [ ] 无需更新

## 环境信息
- OS: macOS 14.5 (23F79) arm64 (M1 Pro, 10 核)
- 工具版本: sample (macOS 自带), log (macOS 自带), top 3.0
- 目标平台/版本: replayd 534.5, Google Chrome 151.0.7922.72, iTerm2 3.6.6
