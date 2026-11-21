# 数据库与部署

本文说明本地开发、迁移和首次部署所需的 Postgres 角色与操作顺序。账号、RLS 与数据模型的设计契约见 `CONTEXT.md`、`docs/TECH.md` 和决策 0023；本文不替代这些定义。

## 角色与连接 URL

| 环境变量                 | 角色与用途                                                          | 权限边界                                                                                                               |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Next.js 运行时使用 `mindsprout_app`，访问账号、会话与当前用户的导图 | 不是表 owner，不得为 `SUPERUSER` 或 `BYPASSRLS`；只能执行 migration 授予的表权限，导图访问由 `app.user_id` 和 RLS 隔离 |
| `MIGRATION_DATABASE_URL` | 迁移与本地测试生命周期使用的 owner；本地示例角色为 `app`            | 可执行 migration SQL；集成/E2E 生命周期还需要创建测试数据库的权限，不应作为应用运行时角色                              |

两个 URL 都必须使用 `postgres://` 或 `postgresql://`。密码只通过部署平台的 secret 设置或本地未提交的 `.env` 提供，不写入仓库、命令记录或日志。导出的环境变量优先于 `.env`。

Migration 会为不存在的 `mindsprout_app` 创建 `NOLOGIN` 角色，并拒绝已有角色带有 `SUPERUSER` 或 `BYPASSRLS`。部署时必须为该角色单独设置强密码和 `LOGIN`，不能使用 owner URL 启动应用。

## 本地开发

1. 按 `AGENTS.md` 完成安装，启动本地 Postgres 16，并从 `.env.example` 创建 `.env`。
2. 确认 `.env` 中两个 URL 指向本地开发数据库，运行：

   ```bash
   pnpm db:setup && pnpm dev
   ```

`pnpm db:setup` 先执行全部未应用的 migration，再运行 `db/dev/app-role.sql` 设置开发角色的登录密码。它只在非 production 环境运行；不得对共享或生产数据库使用。Migration 已提交后，开发角色 bootstrap 失败不会回滚这些 migration；修正角色或权限问题后重新运行即可。

只需执行 migration 时使用：

```bash
pnpm db:migrate
```

Migration 按文件名顺序执行并记录在 `schema_migrations`，已应用的文件不会重复执行。每个文件与其记录在同一事务中提交；如果后续文件失败，先前已提交的文件保持已应用状态。

## 部署

### 1. 备份

在每次迁移前，使用部署平台的备份能力或 `pg_dump` 创建目标数据库备份，并确认备份可用于恢复。不要把备份或其中的凭据提交到仓库。Migration 不提供自动备份或回滚。

### 2. 创建应用登录角色

由数据库管理员在目标集群创建 `mindsprout_app` 登录角色并设置独立强密码；若 migration 已创建 `NOLOGIN` 角色，则改为设置 `LOGIN` 和密码。使用部署平台提供的安全密码输入方式，不把真实密码写入 SQL 文件或 shell 历史。角色不得拥有 `SUPERUSER`、`BYPASSRLS` 或表 owner 权限。

将运行时 `DATABASE_URL` 指向该角色和目标数据库，将 `MIGRATION_DATABASE_URL` 指向迁移 owner。两个 URL 分别保存为独立 secret；应用启动时只使用 `DATABASE_URL`。

### 3. 迁移并启动

在部署环境运行：

```bash
pnpm db:migrate && pnpm build && pnpm start
```

任一命令失败都必须停止，不得继续启动或开放注册；修复失败原因后再从相应步骤继续。生产环境禁止使用 `pnpm db:setup`：它会拒绝运行，且其开发 bootstrap 不应成为生产密码管理路径。

### 4. 首先注册 owner

服务启动后立即在受信任的访问路径打开 `/register`，注册 owner 账号。空数据库中的第一位注册用户成为唯一管理员；在 owner 注册前，不要把公开注册入口暴露给不受信任的网络。后续用户不会成为管理员。

管理员可以在 `/admin` 查看用户并为其他用户重置密码。临时密码只在重置结果中显示一次；不要把它写入日志、截图或工单。

## Smoke 顺序

`pnpm smoke` 会注册两个随机用户，并用第二个用户验证普通用户无权执行管理员操作。它不会在成功重置后记录临时密码。

在全新的开发数据库上，必须先通过 `/register` 注册开发者自己的 owner 账号，再运行 `pnpm smoke`。否则第一个随机 smoke 用户会成为管理员，后续真实 owner 无法取得管理员身份。E2E 使用独立的 `app_e2e` 和 seeded admin，不能替代开发数据库的 owner 注册。

## Known Limitations

- Migration 只负责前向 schema 变更，不提供自动备份、回滚或停产迁移编排。
- `pnpm db:setup` 是本地开发辅助命令，不是生产部署命令。
- 首位注册用户即唯一管理员的流程要求部署者控制首次访问顺序；系统不提供后续管理员恢复或自助密码找回。
