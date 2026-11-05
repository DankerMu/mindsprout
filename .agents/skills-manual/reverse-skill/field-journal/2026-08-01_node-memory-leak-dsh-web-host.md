# 2026-08-01 Node 进程内存泄露分析（dsh web host, PID 27192）

## 场景分类
其他 / 运行时内存泄露诊断（macOS + Node.js V8 + CDP）

## 目标概述
分析进程 27192（dsh web 模式 host）持续增长的内存，定位泄露源。

## 完整执行链路

1. 确认进程：`node --import tsx .../bin.ts web`，dsh 宿主进程（本会话宿主）。
2. 分层采样建立时间序列：
   - `ps` RSS/VSZ、`vmmap -summary`（MALLOC zone、Memory Tag 255）
   - `leaks <pid>`（malloc 层，仅 CFString 小对象，可忽略）
   - `kill -USR1 <pid>` 动态开启 inspector（Node 官方机制）→ CDP `Runtime.evaluate` 采样 `process.memoryUsage()`：arrayBuffers 293→366→594→667→742 MB，斜率 ~5 MB/min 线性增长（确认泄露）。
3. `HeapProfiler.takeHeapSnapshot` ×2（480MB/597MB，间隔 47min）：
   - 计数对比：Uint8Array/ArrayBuffer 97.3万→143.8万（+46.5万），native self 381→569 MB。
   - 持有链：ReadableStreamDefaultController.queue → {value:Uint8Array,size} → ArrayBuffer（~370B/组）。
   - queue 元素内容：`data: {"type":"server-request","rpcId":"..."}`（dsh RPC SSE 帧）。
4. 代码定位：`packages/host/apiproxy/src/fetch/handler.ts` 的 `sseResponse`（`new ReadableStream({start})` 里 `for await` + `controller.enqueue()` 无背压）+ `packages/client/connection/src/http-bridge.ts`（drain 等待）。
5. 传输层确认：`netstat` 显示 3080→Chrome(94633) 62708 连接 **Send-Q 积压 384KB**（客户端停读）→ TCP 背压 → bridge 卡 drain → enqueue 无界堆积。

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| heap snapshot >512MB 无法 JSON.parse | V8 字符串长度上限 2^29-1 | 流式扫描器（字节级数字解析，按 node_fields stride 计数）| 1h |
| 快照 2 解析出"垃圾持有者" | 用快照 1 的 strings 表解析快照 2 的 name id（字符串表会随新字符串增长，id 不稳定）| 从快照 2 提取 strings 数组（状态机提取器），重新解析 | 40min |
| 流式解析 0 节点 | slot 计数器误用 nodeIdx（不增长）| 独立 fieldIdx 计数 | 10min |
| 边→from 节点错乱 | 边序号≠from 节点索引 | 按节点顺序遍历（节点 i 拥有 edge_count[i] 条边）| 20min |
| callFunctionOn 反复报 `.for is not iterable` | 目标进程自身 busy 且内部有未捕获异常，干扰 CDP 执行 | 放弃 CDP 内遍历，改用离线快照流式分析 | 1h |
| CDP getObjectByHeapObjectId "Object is not available" | 快照后对象 id 失效 | 放弃，改用 queryObjects（注意 returnByValue 会丢 objectId）| 20min |

## 工具链发现

- macOS：`leaks`/`vmmap -summary`/`heap`/`malloc_history` 全可用；`vmmap` 的 dirty+swap 才是真实足迹（RSS 受换页干扰剧烈）。
- Node：SIGUSR1 动态开 inspector（无副作用）；CDP `Runtime.queryObjects` 可枚举原型实例；heap snapshot 解析需要流式（>512MB）。
- Memory Tag 255 = V8 堆；MALLOC_TINY 增长 ≈ ArrayBuffer backing store（V8 的 ArrayBuffer backing 走 malloc，~370B 落入 tiny zone）。

## 关键代码/命令

```
kill -USR1 27192 && curl http://127.0.0.1:9229/json/version
vmmap -summary 27192 | grep -E "MALLOC_TINY|Memory Tag 255"
node /tmp/dsh-mem-long.mjs  # CDP 采样 process.memoryUsage()
# 泄露链：Chrome 停读 → TCP Send-Q 384KB → bridge res.write()=false 等 drain
#        → sseResponse start() 中 for-await+enqueue 无背压 → queue 无限增长
# 修复方向：sseResponse 改 pull 模式 / desiredSize 检查；drain 加停滞超时
```

## 结论
dsh web host 的 2 条 SSE 流（mux/host）因客户端（Chrome 标签页）停止读取，`sseResponse` 的 `controller.enqueue()` 无背压导致 ReadableStream queue 无限堆积（143.8 万帧 ≈ 742MB，~5MB/min 增长，最终 OOM）。根因在服务端：Web Streams 的 start() 中 enqueue 不背压，且无连接停滞检测。
