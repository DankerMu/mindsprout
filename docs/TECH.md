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

| 层     | 选型                                                                                         | 理由                                                       |
| ------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 框架   | Next.js 16 (App Router) + TypeScript                                                         | 全栈一体，Vercel 零配置部署，SSE 流式支持好                |
| 画布   | React Flow (@xyflow/react) + d3-hierarchy                                                    | 节点是 React 组件，交互全自定义；d3 做树形布局             |
| 状态   | Zustand；undo/redo 用 reducer 返回的逆操作栈（决策 0004 的 change `m1-canvas` design D3）    | 一条 TreeOp 一步撤销，AI 会话可分组，不存整树快照          |
| 样式   | Tailwind CSS + shadcn/ui                                                                     | 快速出 UI，组件可控                                        |
| 数据库 | Postgres 16 + `postgres`（postgres.js）+ 编号 SQL 迁移                                       | 任意 Postgres 可用，RLS 做行级隔离；表少，不引入 ORM       |
| 认证   | 自建：用户名 + 密码（scrypt，`node:crypto`）+ 服务端会话（HttpOnly cookie）+ Session binding | 零新依赖；延迟写按账号绑定并 fail-closed（决策 0023/0028） |
| AI     | Vercel AI SDK (`ai`) 做提供方抽象；Claude 走 `@anthropic-ai/sdk` 直连以用全特性              | 一套接口接 Claude、OpenAI、任意 OpenAI 兼容端点和 Ollama   |
| 导出   | html-to-image (PNG/SVG)，自写 Markdown/OPML 序列化                                           | 树到文本是纯函数，容易测                                   |
| 部署   | Vercel + 托管 Postgres（M2 只做本地验收，不含部署）                                          | 零运维                                                     |
| 测试   | Vitest (单元) + Playwright (端到端)                                                          | 树操作和序列化用单元测试覆盖                               |

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

- `users`（M2）：`id uuid` 主键（默认 `gen_random_uuid()`），`username text` 唯一，`password_hash text`（scrypt），`is_admin boolean` 默认 false，`created_at timestamptz` 默认 now()；均非空。`users_single_admin` 部分唯一索引：`((true)) where is_admin`。
- `sessions`（M2）：`token_hash text` 主键，`user_id uuid` 外键引用 users（级联删除，有索引），`expires_at timestamptz`，`created_at timestamptz` 默认 now()；均非空。
- `maps`（M2）：`id text`、`owner_id uuid`（引用 users，级联删除）、`schema_version integer`、`map jsonb`（完整 MindMap）均非空；主键 `(owner_id, id)`。`title text`、`updated_at text` 分别由 `map->>'title'`、`map->>'updatedAt'` 存储生成；检查 `map->>'id' = id`；索引 `(owner_id, updated_at desc, id collate "C")`。
- `map_versions`（M6）：id, map_id, roots (jsonb), created_at，保留最近 20 版
- `ai_usage`（M4）：user_id, date, provider, model, tokens_in, tokens_out, calls，做每日配额
- `user_providers`（M3.5）：user_id, provider, base_url, encrypted_key, default_model，用户自定义提供方

`maps` 启用并强制 RLS：`maps_owner` 的 USING 和 WITH CHECK 均为 `owner_id = nullif(current_setting('app.user_id', true), '')::uuid`；缺失或空身份看不到行、不能插入。每个请求在事务内 `set_config('app.user_id', …, true)`。应用以不拥有表、无 SUPERUSER/BYPASSRLS 的 `mindsprout_app` 连接，迁移用单独的 owner 角色。应用角色仅有 public 的 USAGE、maps 的 CRUD、users 的 SELECT/INSERT/UPDATE(password_hash)、sessions 的 SELECT/INSERT/DELETE；users/sessions 无 RLS，只由 account/infrastructure 访问。

迁移 0001 拒绝已有 SUPERUSER 或 BYPASSRLS 的 `mindsprout_app`，不修改共享角色的权限。`db:setup` 与测试库重置在 production 模式下均于创建数据库客户端前拒绝执行。

### 3.1 Account core

`src/contexts/account/domain/account.ts` defines the account entities, errors and ports; `application/auth.ts` exports `register`, `signIn`, `resolveSession` and `signOut`. Callers inject persistence, hashing, token generation and a clock. User timestamps are UTC ISO strings; credentials are separate from public users.

Registration and sign-in accept exact strings: username 1–64 and password 1–256 UTF-16 code units, without trimming, case folding or Unicode normalisation. Invalid bounds yield `invalid-input`; unknown users and wrong passwords yield the same `invalid-credentials`. Registration persistence owns duplicate detection (`username-taken`), identity and first-admin assignment.

`SessionRepository.createIfPasswordHashMatches` atomically checks the registered or verified password hash and inserts the session, serialized with password replacement and session deletion. A changed hash or absent user returns `false` without insertion; credentials remain separate from `Session`. Reset either invalidates an issued session or prevents stale issuance. Refused sign-in issuance yields `invalid-credentials`; refused initial registration issuance throws an internal, non-`AccountError` failure without an authenticated result. The account retains its replacement credential, with no cross-port rollback.

Sessions expire exactly 30 days after the injected clock instant. Resolution requires expiry strictly after the supplied instant, does not extend it and does not purge expired rows. Sign-out deletes only the supplied session and accepts missing or unknown tokens. Unexpected port failures propagate; a failed session write does not roll back an account already registered.

Login and registration set the HttpOnly `mindsprout_session` credential and the non-HttpOnly `mindsprout_session_binding`, an opaque base64url UTF-8 encoding of the exact username, with matching 30-day Path=/, SameSite=Lax and production-Secure scope. Successful logout clears both; failed authentication sets neither. The provider caches by binding and checks it on navigation, resetting to opening before children can use another account's adapter. First-party adapters always send `x-mindsprout-session-binding` on all map requests: the default provider captures the cookie value, substituting an empty but present header when the cookie is absent or empty. Credential-only legacy sessions therefore fail closed before map access; same-account reauthentication establishes a valid binding and resumes normal editing. After resolving the session, `requireUser` rejects a present mismatching header with 401 `unauthenticated` before map or admin access; an absent header preserves direct-API behavior. Same-account re-login keeps an established binding and pending-save recovery; cross-account queued writes fail closed. The binding is not a session token or secret and is never logged ([decision 0028](../decisions/implemented/bug-fix/0028-bind-queued-map-writes-to-account.md)).

`application/admin.ts` exports `listUsers(actor, { users })` and `resetPassword(actor, userId, { users, hasher, tokens })`. Both reject non-admin actors with `forbidden` before any port operation. Listing returns public users in repository-owned oldest-first order. Reset hashes one 16-character base64url temporary password from `TokenSource` and calls `replacePasswordAndEndSessions` once, without a preliminary lookup. Its `false` result yields `not-found` without credential or session changes. Success returns only the temporary password, never stores or logs it in readable form, and revokes only the target's sessions. Self-reset is allowed and signs the admin out; peer sessions and credentials remain valid.

`infrastructure/crypto.ts` provides Node-only `ScryptPasswordHasher` and `CryptoTokenSource` adapters. Passwords use UTF-8 without normalisation; asynchronous scrypt uses N=32768, r=8, p=1, a fixed 64 MiB memory ceiling, a fresh 16-byte salt and a 32-byte key. Stored credentials are `scrypt$32768$8$1$<saltB64>$<keyB64>` with canonical padded standard base64. Verification rejects malformed or non-matching profiles before derivation, compares decoded keys with `timingSafeEqual`, and resolves `false` on derivation failure; hashing failures propagate. Session tokens encode 32 random bytes as base64url, and temporary passwords encode 12 random bytes as exactly 16 base64url characters.

`infrastructure/postgres.ts` provides `PostgresUserRepository` and `PostgresSessionRepository` over an injected `postgres.Sql`; the caller owns the pool. Registration awaits transaction advisory lock `608259634` before a separate insert determines first-admin status. Only `23505` on `users_username_key` becomes `username-taken`. Public users contain ISO timestamps and no credentials; listing orders by creation time, then UUID.

Password replacement and conditional issuance hold the same user-row `FOR UPDATE` lock until commit. Replacement changes the hash and deletes only that user's sessions atomically. The session adapter stores SHA-256 hex digests of UTF-8 tokens, binds the supplied clock instant for strict expiry, and leaves expired rows untouched. Database failures propagate without a success result.

`infrastructure/map-store.ts` exposes `PostgresMapStore.forUser(userId)` through the map port re-exported by `account/acl/map.ts`. The caller owns the injected app-role pool; every repository call sets transaction-local identity before accessing maps. `put` stores JSON verbatim under `(owner_id, id)` without stamping or validating. `get` alone rejects newer schema versions; `list` includes their readable summaries, skips null title/updatedAt, and sorts the final plain array with the canonical `byRecency` comparator: updatedAt descending, then id ascending in JavaScript code-unit order. SQL `"C"` collation alone does not provide that Unicode tie order. Missing or other-owner reads return absence, and deletes are no-ops.

#### Known Limitations

Map payload validation belongs to the route boundary, not the store. Password migration/rehashing, expired-session purging and whole-operation timing equalisation are not provided. Login throttling is deferred until the first public deployment; see [decision 0023](../decisions/implemented/architecture/0023-self-hosted-accounts-on-postgres-rls.md).

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

AI 层对上只暴露一个端口：给定主题和主根 id，流式返回已校验的 `TreeOp`。M3 交付两个真实提供方和一个 mock，服务端配置其中一个：

| 提供方                  | 接入方式                                         | 典型模型                                      | 说明                                                              |
| ----------------------- | ------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------- |
| Claude                  | `@anthropic-ai/sdk` 直连                         | `claude-opus-5-5`（默认）、`claude-haiku-5-5` | 用工具调用 + `strict: true`，`eager_input_streaming` 边生成边到达 |
| OpenAI 兼容接口         | Vercel AI SDK `ai` + `@ai-sdk/openai-compatible` | DeepSeek、Qwen、Moonshot、GPT 系列等          | 只要是 `/chat/completions` 协议都能接，base URL 必填              |
| 本地开源模型（M3.5 后） | Ollama / vLLM / LM Studio 的 OpenAI 兼容端点     | Llama、Qwen、Gemma 等                         | 计划走同一个 openai-compatible 适配器，base URL 指向本地或自托管  |

```ts
// src/contexts/ai/application/provider.ts（决策 0002）
interface GenerateRequest {
  topic: string;
  rootId: NodeId; // 导图主根：模型的 `root` 映射到它
  signal: AbortSignal;
}
interface Provider {
  streamOps(request: GenerateRequest): AsyncIterable<TreeOp>; // 一次尝试，op 按产出顺序
}
```

关键设计：

- **输出协议统一**：所有提供方都必须产出 `TreeOp`，画布不关心背后是谁
- **扁平的按父调用**：模型只看到一个工具 `add_children`，每次调用给一个父节点挂一组扁平的子节点，不嵌套；先为 `root` 调用，再在同一轮里为每个一级节点各调用一次
- **临时 id 重映射**：模型给每个子节点起临时 id，`root` 指主根。装配器按 Zod 严格校验每个输入（失败为 `ProviderOutputError`，从不修复），把父节点解析为主根或已产出节点的服务端 id，再给子节点换上服务端新生成的 id；未知父节点、重复临时 id 同样拒绝。超出层数 2、每父 7 个或总数 60 的子节点截断丢弃，挂在被丢弃节点下的调用静默丢弃
- **确认循环**：轮次以工具调用结束时，适配器回放本轮 assistant 消息，并对每次调用回一个内容为 `ok` 的工具结果，再请求下一轮。每次尝试最多 4 轮；模型自然结束，或装配器在轮末报告 `complete`（每个一级节点都已有子节点）时停止。轮次计数和停止判断只在共享的 `runTurnLoop` 里实现，适配器只提供每轮的 `runTurn`
- **配置来源**：平台提供方由服务端配置，Key 和 base URL 只在服务端使用；用户自带 Key（加密存库）留到 M3.5
- **M3.5 前不做**：`listModels`、能力标记（`supportsToolCalling` 等）、不支持工具调用时的 JSON 模式通道，以及按能力选通道的路由
- **按任务选模型（留到 M3.5）**：M3 只配置一个 `AI_MODEL`，所有任务共用；骨架生成、节点展开、文本提炼各自指定不同模型，以及默认配置给出推荐组合，都留到 M3.5

### 5.2 Claude 直连要点

- 每轮一次 `client.beta.messages.stream()`（`fallbacks: "default"` 只在 beta 端点可用，请求带 `anthropic-beta: server-side-fallback-2026-07-01` 头），通过 SSE 把 op 推给前端
- 工具结果循环：轮次以 `tool_use` 结束时，下一轮先回放本轮的 assistant 内容，其中每个工具输入换成严格 `JSON.parse` 的结果，并按回退回放规则处理（`fallback` 块留在原位，最后一个 `fallback` 块之前的 `thinking`、`redacted_thinking`、`connector_text` 块丢弃）；再对每次调用回一个内容为 `ok` 的 `tool_result`。每次尝试最多 4 轮；模型自然结束，或装配器在轮末报告 `complete` 时停止
- 自适应思考（省略 `thinking` 参数即可），`output_config.effort` 按模式调：生成骨架 `medium`，节点展开 `low`，对话式 `medium`
- `add_children` 等 op 定义为工具，`strict: true` 保证参数结构合法
- 当前模型不支持强制 `tool_choice`，用 `auto` 加系统提示明确要求"只通过工具修改导图"
- 开启服务端 `fallbacks: "default"`，避免偶发拒答导致整次失败；工具调用块尚未关闭时的拒答不会回退，直接作为拒答返回
- 系统提示打 `cache_control` 断点，稳定前缀吃缓存
- 失败映射，按以下顺序判定：`stop_reason: refusal` 为 `ProviderRefusedError`（即使本轮有未完成的工具输入，或已产出 op）；否则本轮有未完成的工具输入（严格解析失败，或块到消息结束都未关闭）为 `ProviderOutputError`；`tool_use` 进入下一轮；`end_turn`、`stop_sequence`，以及输入全部完整的 `max_tokens` 为自然结束；其他值或缺失（`pause_turn`、`model_context_window_exceeded` 等）为 `ProviderTransportError`。SDK 报告的工具输入 JSON 解析错误为 `ProviderOutputError`，其余 SDK 错误（HTTP 状态、连接等）为 `ProviderTransportError`，客户端中止由轮次循环归一为 `signal.reason`；错误消息固定，不带 `cause`，从不包含模型 JSON、响应体、Key 或请求 id
- 客户端 `maxRetries: 0`：适配器从不重试，HTTP 错误只请求一次，唯一一次重试由 `generate()` 负责

### 5.3 OpenAI 兼容与开源模型要点

- 统一用 `@ai-sdk/openai-compatible`，差异只在 base URL、Key 和模型名。适配器用 `createOpenAICompatible({ name, baseURL, apiKey, fetch })` 建一个提供方，再用 `.chatModel(model)` 建模型对象；从不传字符串模型 id，因为字符串会经 AI Gateway 解析
- 每轮一次单步 `streamText`（不设 `stopWhen`，默认只走一步）：`instructions` 为统一系统提示，`messages` 从只含主题的 user 消息开始；工具 `add_children` 用 `jsonSchema(...)` 包装共享定义，不带 `execute`、`validate` 和 `strict`，校验只在装配器里做
- 请求设置：每轮 `maxOutputTokens: 8000`；`maxRetries: 0`，HTTP 错误只请求一次，唯一一次重试由 `generate()` 负责；`abortSignal` 为请求的 signal；`onError` 为空函数，替换 SDK 默认的 `console.error`（它会打印带主题和响应体的错误对象），错误一律从流里读；`telemetry: { isEnabled: false }`
- 整轮缓冲：SDK 只在流结束时发出工具调用（紧挨 `finish` 之前），所以适配器读完整轮再判定，不增加延迟。失败的一轮不产出 op，`generate()` 仍可在首个 op 前重试。代价是同一轮内节点不逐个出现，首个节点要等第 1 轮的流结束
- 轮末判定，按以下顺序：`error` 或 `abort` 片段、迭代时抛错（如响应体中途读取失败）、缺少 `finish` 片段，以及 `finishReason` 为 `error`、`interrupted`、`other`（未知的 `finish_reason`；缺少 `finish_reason` 时 SDK 报 `error`）为 `ProviderTransportError`；`content-filter`（SDK 把带 refusal 的 `stop` 也映射为它）为 `ProviderRefusedError`，即使本轮有无效调用；任一 `invalid` 工具调用（参数截断或不是合法 JSON、工具名未知）为 `ProviderOutputError`；否则按序交出缓冲的工具输入，`tool-calls` 进入下一轮，`stop` 和 `length` 为自然结束。错误消息固定，不带 `cause`，从不包含响应体、Key、请求 id 或主题
- 确认循环的历史：`tool-calls` 一轮之后，先追加 SDK 返回的 assistant 消息（保留 reasoning 部分，DeepSeek 思考模式的 `reasoning_content` 因此能回传），再追加一条 `role: 'tool'` 消息，按顺序给每次调用一个内容为 `ok` 的结果
- 开源小模型容易多生成或格式漂移，服务端做三道防线：Zod 校验、超出层数或节点数截断、失败重试一次后向用户报错。不支持工具调用的模型要等 M3.5 的 JSON 模式通道
- Ollama 是后续选项。默认地址 `http://localhost:11434/v1`，本地开发时服务端直连；线上部署若要用本地模型，需用户在浏览器侧配置并经由服务端代理，或者走"自托管模式"整套部署在用户机器上

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
  app/                          Next.js 路由与服务端组合根
    page.tsx                    导图库首页
    login/  register/           登录与注册页面
    admin/                      管理员用户列表与密码重置页面
    maps/[id]/                  编辑器路由、导图加载与状态展示
    providers/                  会话级 MapRepository 绑定
    server/                     账号、会话、Postgres 与 AI 服务组合
    api/auth/                   register、login、logout、session
    api/ai/generate/            主题生成（SSE 流式 TreeOp）
    api/maps/                   导图列表、读取、保存与删除
    api/admin/users/            用户列表与密码重置
    api/healthz/                健康检查
  components/
    account/                    凭证表单、会话菜单与管理员用户列表
    canvas/                     React Flow 画布、节点、菜单与备注面板
    editor/                     编辑器视图、编辑会话与卸载保存监听
    library/                    导图库列表与新建、重命名、删除交互
  contexts/
    map/
      domain/                   导图模型、TreeOp、MapRepository 端口与错误
      application/              编辑、历史、布局、菜单与自动保存用例
      infrastructure/
        persistence/            HTTP MapRepository 适配器
    account/
      domain/                   账号、会话、错误与持久化端口
      application/              注册、登录、会话与管理员用例
      infrastructure/           PostgresMapStore、RLS、凭证哈希与令牌实现
      acl/                      MapRepository 端口与类型的跨上下文再导出
    ai/                         提供方、提示词、路由与配额边界
    export/                     导图快照的纯序列化边界
  shared/                       环境配置、日志与数据库健康探测
db/
  migrations/                   顺序执行的 SQL 迁移
  dev/                          仅限开发环境的应用角色 bootstrap
docs/                           PRD、技术与工程文档
```

数据库角色、RLS、迁移与部署见[数据库与部署](engineering/database.md)。

## 8. 安全与限流

- Key 只在服务端环境变量里，`.env.example` 已给占位
- 主题生成（`POST /api/ai/generate`）要求登录会话，携带的会话绑定须与会话用户一致；请求体用 Zod 严格校验（topic ≤ 200 个 UTF-16 码元且非空白，rootId 非空）；客户端断开即中止提供方调用；SSE 帧只携带固定的错误信息，不含提供方原文、Key 或主题
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
