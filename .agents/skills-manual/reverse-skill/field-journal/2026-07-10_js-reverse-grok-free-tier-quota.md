# 2026-07-10 Grok 免费账号额度机制逆向

## 场景分类
JS 逆向 / Web API 限流 / Freemium 配额

## 目标概述
逆向 `{target_domain}` 消费端产品：为什么未付费（Free）账号也有可用额度，以及额度如何下发/扣减。

## 完整执行链路

1. reverse-skill 路由：前端 JS + API 限流 → `js-reverse` + `api-security`
2. 抓首页 HTML：Next.js RSC + `server-client-data-experimentation` feature flags
3. 发现 `authless_grok_models`、`enable_rate_limit_logged_out_copy_update`、`show_remaining_queries_toast` 等
4. 扫描 CDN `_next/static/chunks/*.js`，命中 `POST /rest/rate-limits` 与 `useRateLimits`
5. 还原 OpenAPI-like 客户端：`rateLimitsGetRateLimits({body:{requestKind?, modelName}})`
6. 还原订阅档位：`getSubscriptionLevel` 无 active sub → `"Free"`
7. 探测未登录 API：`POST /rest/rate-limits` → 401 `WKE=unauthenticated:no-credentials`（端点存在，需 session）
8. 对比 xAI 开发者 API 文档：与消费端 freemium 配额是两套体系

## 踩坑记录

| 问题 | 原因 | 解决方案 | 耗时 |
|------|------|---------|------|
| GET `/rest/rate-limits` 返回 501 | 仅允许 POST | 改用 POST + JSON body | 5m |
| 无凭据拿不到 remainingQueries | 服务端强制 session/cookie | 分析前端 schema 而非盲打 | 10m |
| GitHub API 限流 | 匿名 API rate limit | 改扫 CDN bundle + 公开 README | 5m |

## 工具链发现
- `curl` + 并发扫 CDN chunk 对 Next 混淆包有效
- 前端 OpenAPI 生成客户端（path/method/body transformer）是配额字段的权威来源
- 官方 xAI rate-limits 文档描述的是 **API 团队 spend tier**，不是 grok.com Free 聊天额度

## 关键代码/命令

```
# 端点探测
POST {target_domain}/rest/rate-limits
Content-Type: application/json
Body: {"modelName":"<mode-or-model-id>"}
# 未登录: 401 No credentials presented

# 客户端响应映射（前端）
windowSizeSeconds, remainingQueries, waitTimeSeconds,
totalQueries, remainingTokens, totalTokens,
lowEffortRateLimits{cost,waitTimeSeconds,remainingQueries},
highEffortRateLimits{...}, preGenerationDelayMs

# 订阅档位（无 active → Free）
SUBSCRIPTION_TIER_INVALID → Free
X_BASIC / X_PREMIUM / X_PREMIUM_PLUS
SUPER_GROK_LITE / GROK_PRO(SuperGrok) / SUPER_GROK_PRO(Heavy)

# 匿名身份
POST /rest/auth/create-anon-user
POST /rest/auth/create-anon-user-challenge
```

## 结论（Why Free 有额度）

1. Free 是一等公民档位，不是“没额度”；`getSubscriptionLevel([]) === "Free"`
2. 服务端按 **身份 + 订阅档 + model/mode** 下发正整数 `remainingQueries` / 时间窗
3. 前端只展示与 upsell；真正扣减在聊天/网关流（`rate_limits.updated`、`usage_limit_reached`）
4. 产品动机：Freemium 获客 → Free 用尽后引导 SuperGrok / 注册
5. 与 api.x.ai 的 prepaid/spend tier 无关

## 对本包的改进建议
- routing 可补充：LLM 消费端产品配额 → js-reverse + api-security 交叉路径
- 无需新 skill

## 可复用的模式/脚本片段
- Next.js chunk 批量 `rg rate-limits|remainingQueries` 定位 OpenAPI client
- Freemium 分析清单：subscription enum → rate-limits schema → stream error codes → paywall copy

## 进化动作
- [x] 新增 field-journal
- [x] 更新 `_index.md`
- [ ] 无需更新路由矩阵

## 环境信息
- OS: macOS
- 工具: curl, python3, agent-browser 0.27.0
- 目标: grok.com Next.js 前端 + /rest/* gRPC-gateway 风格错误码

## 脱敏要求
目标以 `{target_domain}` 记录；无 token/cookie 落盘。
