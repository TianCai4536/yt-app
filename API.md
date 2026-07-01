# API.md — 服务端 API 规范

> Base URL: `https://blog.tczeng.top/yt-api`（占位，部署时确定）
> 协议: HTTPS only, JSON, OpenAPI 3.1
> 鉴权: Bearer JWT (放在 `Authorization` 头里)

## 路由总览

| 分组 | 路径前缀 | 鉴权 |
|------|---------|------|
| 健康检查 | `/health` | 无 |
| 用户认证 | `/auth/*` | 部分 |
| 用户信息 | `/me/*` | 用户 JWT |
| LLM 代理 | `/v1/*` | 用户 JWT |
| 管理员 | `/admin/*` | 管理员 JWT |

---

## 一、健康检查
```
GET /health
→ 200 {"status":"ok","ts":"..."}
```

---

## 二、用户认证

### `POST /auth/login`
```json
请求体: {"username": "alice", "password": "xxx"}
响应:   {
  "access_token":  "<JWT>",
  "refresh_token": "<JWT>",
  "expires_in":    3600,
  "user": {
    "id": 1, "username": "alice", "display_name": "Alice",
    "credits": 488, "expires_at": "2026-12-31T23:59:59"
  }
}
错误: 401 invalid_credentials / 403 account_suspended / 403 account_expired
```

### `POST /auth/refresh`
```json
请求体: {"refresh_token": "..."}
响应:   {"access_token":"...","expires_in":3600}
```

### `POST /auth/logout`
（吊销 token，需要登录态）
```
204 No Content
```

---

## 三、用户信息

### `GET /me`
```json
响应: {
  "id":1, "username":"alice", "display_name":"Alice",
  "credits":488, "expires_at":"2026-12-31T23:59:59",
  "models": [
    {"model_key":"doubao-pro","display_name":"豆包 Pro","credit_rate":1.0},
    ...
  ]
}
```

### `GET /me/usage`
查询自己的用量记录（最近 30 天）
```
GET /me/usage?days=30&model=doubao-pro&page=1&size=20
→ 200 {"items":[...],"total":1234}
```

### `POST /me/change-password`
```json
请求体: {"old_password":"...","new_password":"..."}
响应:   204 / 400 invalid_old_password
```

---

## 四、LLM 代理（OpenAI 兼容）

### `GET /v1/models`
列出**当前用户**可用的模型（即 `user_models` 矩阵命中的）
```json
响应: {
  "object":"list",
  "data":[
    {"id":"doubao-pro","object":"model","owned_by":"yixiang-tiankai"},
    {"id":"gpt-4o","object":"model","owned_by":"yixiang-tiankai"}
  ]
}
```

### `POST /v1/chat/completions`
完全兼容 OpenAI 协议。客户端用 OpenAI SDK 直接打。
```json
请求体: {
  "model":"doubao-pro",
  "messages":[{"role":"user","content":"hello"}],
  "stream": true,
  "tools": [...],     // 可选，工具调用
  "tool_choice":"auto"
}

非流式响应: 标准 OpenAI 格式
流式响应:   SSE，每条 chunk 标准 OpenAI 格式
```

**鉴权失败 / 额度不足**：
```
402 {"error":{"code":"insufficient_credits","message":"剩余积分不足"}}
403 {"error":{"code":"model_not_authorized","message":"用户未授权该模型"}}
```

**计费时机**：流式响应结束（或非流式响应返回）时，把上游 token 数转积分扣减，并写 `usage_logs` + `credit_logs`。

---

## 五、管理员 API

> 所有 `/admin/*` 需要 admin JWT，请求体/响应是 JSON。

### 5.1 用户管理

#### `GET /admin/users`
```
GET /admin/users?page=1&size=20&search=alice&status=active
→ 200 {"items":[{...}],"total":42}
```

#### `POST /admin/users`
创建用户
```json
请求体: {
  "username":"bob","password":"xxx","display_name":"Bob",
  "initial_credits":1000, "expires_at":"2026-12-31",
  "model_keys":["doubao-pro","gpt-4o"]
}
```

#### `GET /admin/users/{id}`
查单个用户详情（含积分流水、用量统计简表）。

#### `PATCH /admin/users/{id}`
改资料、改密码、改有效期、改状态、改授权模型。
```json
请求体: { "display_name":"...","new_password":"...","expires_at":"...","status":"active","model_keys":["..."] }
```

#### `POST /admin/users/{id}/recharge`
充值积分
```json
请求体: {"delta": 500, "note":"管理员充值"}
响应: {"credits_after": 988}
```

#### `DELETE /admin/users/{id}`
软删除（status='deleted'，保留历史记录）

#### `GET /admin/users/{id}/usage`
该用户用量明细（分页）

#### `GET /admin/users/{id}/credits`
该用户积分流水（分页）

### 5.2 模型管理

#### `GET /admin/models`
列出全部上游模型。

#### `POST /admin/models`
新增模型。
```json
{
  "model_key":"qwen-max","display_name":"通义千问 Max",
  "provider":"dashscope",
  "upstream_url":"https://dashscope.aliyuncs.com/compatible-mode/v1",
  "upstream_model":"qwen-max",
  "api_key":"sk-xxx",         // 后端会加密存
  "credit_rate":2.0,
  "context_window":32768
}
```

#### `PATCH /admin/models/{id}`
改任意字段（含改 Key）

#### `POST /admin/models/{id}/test`
测试上游连通性（发一条 "hello" 看返回）

### 5.3 用量看板

#### `GET /admin/stats/overview`
```json
响应: {
  "total_users": 23,
  "active_users_7d": 12,
  "credits_consumed_today": 1245,
  "credits_consumed_7d": 8761,
  "top_users_7d": [{"user":"alice","credits":312},...],
  "top_models_7d": [{"model":"doubao-pro","credits":4521},...]
}
```

#### `GET /admin/stats/usage?from=...&to=...&group_by=day|user|model`
按维度聚合用量。

### 5.4 审计日志
#### `GET /admin/audit-logs?page=1&size=50&admin_id=1&action=user.recharge`

---

## 六、错误响应统一格式

```json
{
  "error": {
    "code":"insufficient_credits",
    "message":"剩余积分不足，请联系管理员",
    "request_id":"req_abc123"
  }
}
```

| HTTP | code | 含义 |
|------|------|------|
| 400 | bad_request | 参数错误 |
| 401 | invalid_credentials / token_expired | 鉴权失败 |
| 402 | insufficient_credits | 积分不足 |
| 403 | account_suspended / account_expired / model_not_authorized | 无权 |
| 404 | not_found | 资源不存在 |
| 429 | rate_limited | 限流 |
| 500 | internal_error | 服务端错误 |
| 502 | upstream_error | 上游 LLM 故障 |

---

## 七、速率限制

| 范围 | 限制 |
|------|------|
| 单用户 | 60 req/min（聊天） |
| 单用户 | 600 token/min（防刷） |
| Admin | 不限 |

超限返回 `429` + `Retry-After` 头。

---

## 八、可观测性

- 所有请求带 `X-Request-Id`（不传则生成）
- 服务端写访问日志 JSON 行（user_id, route, latency, status）
- Prometheus `/metrics` 端点（可选）
