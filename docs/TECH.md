# MindSprout 技术路线

> 版本 0.2 · 2026-11-13 · 与 PRD 0.2 对应（0.2：自建账号 + Postgres RLS 取代 Supabase，决策 0023）

## 1. 总体架构

```
浏览器 (Next.js 前端, React Flow 画布)
   │  HTTPS / SSE
   ▼
Next.js Route Handlers (同一个部署)
   ├─ /api/ai/*      → 提供方抽象层 → Claude / OpenAI 兼容 / 本地开源模型
   ├─ /api/maps/*    → Postgres（导图 CRUD，RLS）
   ├─ /api/auth/*    → 自建账号与会话（用户名 + 密码）
   └─ /api/admin/*   → 管理后台（用户列表、重置密码）
   │
   ▼
Postgres 16（RLS：app.user_id）
```

选 Next.js 全栈而不是前后端分离，原因是 v1 只有一个人开发，一个仓库一个部署最省心。AI 路由和数据路由都在 Route Handlers 里，未来流量大了再拆。账号自建、不依赖 Supabase：本地、CI 与线上都是普通 Postgres（决策 0023）。

## 2. 技术选型

| 层     | 选型                                                                                      | 理由                                                     |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 框架   | Next.js 16 (App Router) + TypeScript                                                      | 全栈一体，Vercel 零配置部署，SSE 流式支持好              |
| 画布   | React Flow (@xyflow/react) + d3-hierarchy                                                 | 节点是 React 组件，交互全自定义；d3 做树形布局           |
| 状态   | Zustand；undo/redo 用 reducer 返回的逆操作栈（决策 0004 的 change `m1-canvas` design D3） | 一条 TreeOp 一步撤销，AI 会话可分组，不存整树快照        |
| 样式   | Tailwind CSS + shadcn/ui                                                                  | 快速出 UI，组件可控                                      |
| 数据库 | Postgres 16 + `postgres`（postgres.js）+ 编号 SQL 迁移                                    | 任意 Postgres 可用，RLS 做行级隔离；表少，不引入 ORM     |
| 认证   | 自建：用户名 + 密码（scrypt，`node:crypto`）+ 服务端会话（httpOnly cookie）               | 零新依赖，本地/CI 原生 Postgres 即可跑通（决策 0023）    |
| AI     | Vercel AI SDK (`ai`) 做提供方抽象；Claude 走 `@anthropic-ai/sdk` 直连以用全特性           | 一套接口接 Claude、OpenAI、任意 OpenAI 兼容端点和 Ollama |
| 导出   | html-to-image (PNG/SVG)，自写 Markdown/OPML 序列化                                        | 树到文本是纯函数，容易测                                 |
| 部署   | Vercel + 托管 Postgres（M2 只做本地验收，不含部署）                                       | 零运维                                                   |
| 测试   | Vitest (单元) + Playwright (端到端)                                                       | 树操作和序列化用单元测试覆盖                             |

## 3. 数据模型

导图的真相是一棵 JSON 树，画布只是它的视图。

```ts
type NodeId = string; // nanoid
type ColorToken = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

interface MindNode {
  id: NodeId;
  text: string; // 单行，长度不限（≤ 40 字是 AI prompt 约束，见 §5.5）
  note?: string; // 多行纯文本；M1 不渲染 Markdown
  color?: ColorToken; // 六个语义色 token 之一，按名存储
  collapsed?: boolean;
  position?: { x: number; y: number }; // 仅浮动根有
  children: MindNode[];
}

// 森林：roots[0] 是主根（不可删除/移动），其余为浮动根（决策 0004）
// 客户端模型没有 ownerId：所有者是 M2 由 account 上下文在服务端附加的列（owner_id，RLS）；
// 载荷形状不变，schemaVersion 保持 1（决策 0023）。
interface MindMap {
  id: string;
  title: string; // 元数据：由应用层在保存/重命名时写，reducer 不碰
  roots: MindNode[]; // 树状态：只经 TreeOp reducer 修改
  createdAt: string;
  updatedAt: string; // 元数据：应用层每次保存前盖时间戳
}
```

数据库表（编号 SQL 迁移；M2 建前三张，其余随所属里程碑）：

- `users`（M2）：id, username（唯一）, password_hash（scrypt）, is_admin（全库至多一个：首个注册用户）, created_at
- `sessions`（M2）：令牌哈希, user_id, expires_at（30 天）, created_at
- `maps`（M2）：id, owner_id, title, roots (jsonb), schema_version, created_at, updated_at
- `map_versions`（M6）：id, map_id, roots (jsonb), created_at，保留最近 20 版
- `ai_usage`（M4）：user_id, date, provider, model, tokens_in, tokens_out, calls，做每日配额
- `user_providers`（M3.5）：user_id, provider, base_url, encrypted_key, default_model，用户自定义提供方

RLS 策略：按用户拥有的表统一为 `owner_id = current_setting('app.user_id')`（`ai_usage`/`user_providers` 以 `user_id` 为所有者列）；每个请求在事务内 `set_config('app.user_id', …, true)`，应用以非表 owner、无 `BYPASSRLS` 的角色连接，迁移用单独的 owner 角色。`users`/`sessions` 是认证自身的表，只由 account 上下文在服务端访问。

## 4. 树操作协议（AI 与画布的唯一接口）

三种 AI 模式都通过同一组操作改树，前端 reducer 只认这几种：

```ts
// 创建载荷：递归整棵子树，永远不带 position（schema 为 strict，未知字段拒绝）
type NewNode = {
  id: NodeId;
  text: string;
  note?: string;
  color?: ColorToken;
  collapsed?: boolean;
  children?: NewNode[];
};
type Position = { x: number; y: number };
type TreeOp =
  | { op: 'add_children'; parentId: NodeId; children: NewNode[]; index?: number }
  | { op: 'add_root'; node: NewNode; position: Position; index?: number } // 浮动根；index 为 roots 下标（≥ 1）
  | {
      op: 'update_node';
      id: NodeId;
      text?: string;
      note?: string | null; // 缺省不动，null 清除
      color?: ColorToken | null; // 缺省不动，null 清除
      collapsed?: boolean;
    }
  | { op: 'delete_node'; id: NodeId } // 主根拒绝；树节点或浮动根均可
  | { op: 'move_node'; id: NodeId; newParentId: NodeId; index?: number } // 改挂（浮动根挂回树时丢弃 position）
  | { op: 'move_node'; id: NodeId; newParentId: null; position: Position; index?: number } // 脱离为浮动根
  | { op: 'set_root_position'; id: NodeId; position: Position } // 仅浮动根
  | { op: 'replace_children'; parentId: NodeId; children: NewNode[] }; // 精简/重排用；可复用被替换子树内的 id
```

好处：

- 每个 op 由 reducer 返回精确逆操作（`applyOp(map, op): { map, inverse: TreeOp[] }`），AI 的每一步都可撤销，用户随时回退
- reducer 拒绝成环、删除/移动主根、未知节点、重复 id、非浮动根定位、schema 不合法，抛带 `code` 的 `TreeOpError`（`invalid-op` / `unknown-node` / `primary-root-protected` / `cycle` / `invalid-target`，见 change `m1-canvas` design D2）而非静默忽略
- 流式时 op 逐个到达，节点逐个出现
- 手动编辑和 AI 编辑走同一条路，不会有两套状态

## 5. AI 层设计

### 5.1 多提供方架构

AI 层对上只暴露一个接口：给定上下文和意图，流式返回 `TreeOp`。对下接三类提供方：

| 提供方            | 接入方式                                                     | 典型模型                                      | 说明                                                              |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------- |
| Claude            | `@anthropic-ai/sdk` 直连                                     | `claude-opus-5-5`（默认）、`claude-haiku-5-5` | 用工具调用 + `strict: true`，`eager_input_streaming` 边生成边到达 |
| OpenAI 及兼容接口 | Vercel AI SDK `@ai-sdk/openai` / `@ai-sdk/openai-compatible` | GPT 系列、DeepSeek、Qwen、Moonshot 等         | 只要是 `/v1/chat/completions` 协议都能接，base URL 可配           |
| 本地开源模型      | Ollama / vLLM / LM Studio 的 OpenAI 兼容端点                 | Llama、Qwen、Gemma 等                         | 走同一个 openai-compatible 适配器，base URL 指向本地或自托管      |

```ts
interface AIProvider {
  id: string; // 'anthropic' | 'openai' | 'openai-compatible' | 'ollama'
  listModels(): Promise<string[]>;
  streamOps(req: AIRequest): AsyncIterable<TreeOp>;
}
```

关键设计：

- **输出协议统一**：所有提供方都必须产出 `TreeOp`，画布不关心背后是谁
- **两条输出通道**：支持工具调用的模型走工具调用（结构最稳）；不支持或工具调用不可靠的开源模型走"JSON 模式"，要求模型按固定 schema 输出，服务端用 Zod 校验，失败自动重试一次
- **能力探测**：每个提供方声明 `supportsToolCalling`、`supportsStreaming`、`supportsJsonMode`，路由层据此选通道
- **配置来源**：服务端默认配置一组内置提供方（平台 Key）；用户可在设置里添加自己的提供方（Key 和 base URL），用户 Key 加密存库，只在服务端解密使用
- **按任务选模型**：骨架生成、节点展开、文本提炼各自可以指定不同模型，默认配置给出推荐组合

### 5.2 Claude 直连要点

- `client.messages.stream()`，通过 SSE 把 op 推给前端
- 自适应思考（省略 `thinking` 参数即可），`output_config.effort` 按模式调：生成骨架 `medium`，节点展开 `low`，对话式 `medium`
- `add_children` 等 op 定义为工具，`strict: true` 保证参数结构合法
- 当前模型不支持强制 `tool_choice`，用 `auto` 加系统提示明确要求"只通过工具修改导图"
- 开启服务端 `fallbacks: "default"`，避免偶发拒答导致整次失败
- 系统提示打 `cache_control` 断点，稳定前缀吃缓存

### 5.3 OpenAI 兼容与开源模型要点

- 统一用 `@ai-sdk/openai-compatible`，差异只在 base URL、Key 和模型名
- 优先尝试 `tools` 字段的函数调用；对不支持的模型退回 `response_format: json_object` 或纯提示词约束
- 开源小模型容易多生成或格式漂移，服务端做三道防线：Zod 校验、超出层数或节点数截断、失败重试一次后向用户报错
- Ollama 默认地址 `http://localhost:11434/v1`，本地开发时服务端直连；线上部署若要用本地模型，需用户在浏览器侧配置并经由服务端代理，或者走"自托管模式"整套部署在用户机器上

### 5.4 上下文策略

每次请求只带：

1. 导图标题
2. 从根到当前节点的路径（文本）
3. 当前节点的兄弟节点和已有子节点（避免重复）
4. 用户意图（展开 / 换角度 / 精简 / 举例 / 自由指令）

不传整棵树，省 token 也更聚焦。对话式模式额外带最近 10 轮对话。开源小模型上下文窗口可能较小，路径和兄弟节点按字数上限裁剪。

### 5.5 Prompt 约束

- 每层节点数 3–7 个，节点文字 ≤ 40 字，不写段落
- 同级节点互斥、覆盖完整（MECE 倾向）
- 语言跟随用户输入
- Prompt 模板按提供方分文件维护，核心约束共用，格式说明各自适配

### 5.6 前端消费

```
SSE 事件流 → 解析 op → dispatch 到 Zustand → React Flow 重算布局 → 节点带入场动画
```

每个 AI 会话作为一个 undo 组，一次撤销回到 AI 动手之前。

## 6. 画布实现要点

- 布局：d3-hierarchy 的 `tree()` 算坐标，根在左、子树向右展开；方向是布局参数，M1 不提供切换 UI
- 浮动根：按自身 position 放置，子树内部同样自动布局；拖到节点上即挂接，拖到空白处即脱离
- 性能：500 节点内，React Flow 的虚拟化足够；节点组件用 `memo`，布局计算放 `useMemo`
- 交互：Tab 加子节点、Enter 加兄弟、Delete 删除、Cmd/Ctrl+Z 撤销、Cmd/Ctrl+Shift+Z 重做、F2/双击编辑、方向键移动选中、Cmd/Ctrl+A 全选、Space/中键拖拽平移、滚轮缩放、拖到其他节点上重新挂载；多选支持删除、整组改挂、改颜色
- 折叠：折叠节点不渲染子树，布局时跳过

## 7. 目录结构

```
src/
  app/                          路由与组合根
    page.tsx                    导图库首页
    maps/[id]/                  编辑器路由、导图加载与状态展示
    providers/                  会话级仓储选择、共享与内存回退
    api/healthz/                健康检查
  components/
    canvas/                     React Flow 画布、节点、菜单与备注面板
    editor/                     编辑器视图与会话组合、页面卸载保存监听
    library/                    导图库列表与新建、重命名、删除交互
  contexts/map/
    domain/                     导图模型、TreeOp schema/reducer、仓储端口
    application/                导图重命名、删除与拖放用例
      editor-store/             编辑状态、选择与自动保存
      history/                  撤销/重做与操作分组
      layout/                   森林布局与内容边界计算
      menu/                     节点菜单动作注册
    infrastructure/
      persistence/              IndexedDB 与内存仓储适配器
  shared/                       环境配置、日志与数据库健康探测
docs/                           PRD、技术文档
```

## 8. 安全与限流

- Key 只在服务端环境变量里，`.env.example` 已给占位
- 每用户每日配额写在 `ai_usage` 表，超过返回 429 并在前端提示
- 请求体校验用 Zod，防止超长输入
- 导图读写全部走 RLS，服务端也不绕过
- 密码只存 scrypt 哈希；会话为服务端记录，cookie 为 httpOnly；登录限流推迟到首次公网部署前（决策 0023）

## 9. 里程碑与技术任务

| 阶段 | 主要技术任务                                                                                |
| ---- | ------------------------------------------------------------------------------------------- |
| M1   | Next.js 脚手架、React Flow 画布、树 reducer、d3 布局、快捷键、IndexedDB 临时存储、undo/redo |
| M2   | 自建账号与会话、SQL 迁移与 RLS、maps CRUD、云端自动保存、管理后台、移除 IndexedDB 本地存储  |
| M3   | 提供方抽象层、Claude 与 OpenAI 兼容适配器、SSE、主题生成 Prompt、入场动画                   |
| M3.5 | Ollama 本地模型适配、JSON 模式通道、用户自定义提供方设置页                                  |
| M4   | 四种节点动作、上下文裁剪、每日配额                                                          |
| M5   | 文本导入（分块提炼）、对话面板、对话历史                                                    |
| M6   | 四种导出、版本历史、空状态引导、Playwright 回归                                             |

## 10. 待决策

- 对话式模式的 AI 是否能"看到"整棵树的摘要
- 用户自带 Key 是否计入平台每日配额
- 线上版本如何安全地让用户连自己电脑上的 Ollama
