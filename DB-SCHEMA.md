# DB-SCHEMA.md — 数据库表设计

> SQLite 起步，用户数 > 100 或并发写多时迁 PostgreSQL（schema 兼容）。

## 表清单

| 表名 | 用途 |
|------|------|
| `users` | 普通用户 |
| `admins` | 管理员（独立鉴权） |
| `models` | 上游 LLM 模型 + Key |
| `user_models` | 用户-模型授权矩阵 |
| `credit_logs` | 积分变动流水（充值 / 扣减 / 退款） |
| `usage_logs` | LLM 调用记录 |
| `audit_logs` | 管理员操作审计 |
| `sessions` | 客户端会话（可选，用于多会话同步） |

---

## 表结构

### `users` — 普通用户
```sql
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        VARCHAR(64) UNIQUE NOT NULL,
  password_hash   VARCHAR(256) NOT NULL,             -- bcrypt
  display_name    VARCHAR(64),
  email           VARCHAR(128),
  phone           VARCHAR(32),
  credits         INTEGER NOT NULL DEFAULT 0,         -- 当前积分余额
  status          VARCHAR(16) NOT NULL DEFAULT 'active',  -- active/suspended/expired
  expires_at      DATETIME,                          -- 账号有效期（NULL=永久）
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at   DATETIME,
  notes           TEXT                               -- 管理员备注
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
```

### `admins` — 管理员
```sql
CREATE TABLE admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        VARCHAR(64) UNIQUE NOT NULL,
  password_hash   VARCHAR(256) NOT NULL,
  display_name    VARCHAR(64),
  role            VARCHAR(16) NOT NULL DEFAULT 'admin',  -- admin/superadmin
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at   DATETIME
);
```

### `models` — 上游模型注册表
```sql
CREATE TABLE models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  model_key       VARCHAR(64) UNIQUE NOT NULL,       -- 对外暴露的模型 ID，如 "doubao-pro"
  display_name    VARCHAR(128) NOT NULL,
  provider        VARCHAR(32) NOT NULL,              -- ark/openai/anthropic/dashscope/deepseek
  upstream_url    VARCHAR(256) NOT NULL,             -- 上游 baseURL
  upstream_model  VARCHAR(128) NOT NULL,             -- 上游真实模型 ID
  api_key_enc     TEXT NOT NULL,                     -- 上游 Key（加密存储）
  credit_rate     REAL NOT NULL DEFAULT 1.0,         -- 倍率：实扣积分 = ceil(tokens/1000 * rate)
  context_window  INTEGER,                           -- 最大上下文（tokens）
  supports_tools  BOOLEAN DEFAULT 1,
  supports_stream BOOLEAN DEFAULT 1,
  enabled         BOOLEAN DEFAULT 1,
  sort_order      INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_models_enabled ON models(enabled);
```

### `user_models` — 用户-模型授权矩阵
```sql
CREATE TABLE user_models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id        INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  granted_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  granted_by      INTEGER REFERENCES admins(id),
  UNIQUE(user_id, model_id)
);

CREATE INDEX idx_user_models_user ON user_models(user_id);
```

### `credit_logs` — 积分流水
```sql
CREATE TABLE credit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  delta           INTEGER NOT NULL,                  -- +充值，-扣减
  balance_after   INTEGER NOT NULL,
  reason          VARCHAR(32) NOT NULL,              -- recharge/usage/refund/admin_adjust
  related_id      INTEGER,                           -- 关联 usage_logs.id（扣减时）
  operator_admin  INTEGER REFERENCES admins(id),     -- 管理员操作时记录
  note            TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_credit_logs_user ON credit_logs(user_id, created_at DESC);
```

### `usage_logs` — LLM 调用记录
```sql
CREATE TABLE usage_logs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  model_id            INTEGER NOT NULL REFERENCES models(id),
  request_id          VARCHAR(64),                   -- 上游返回的 id
  prompt_tokens       INTEGER DEFAULT 0,
  completion_tokens   INTEGER DEFAULT 0,
  total_tokens        INTEGER DEFAULT 0,
  credits_charged     INTEGER NOT NULL,
  status              VARCHAR(16) NOT NULL,          -- success/error/timeout/blocked
  error_message       TEXT,
  latency_ms          INTEGER,
  client_ip           VARCHAR(64),
  client_version      VARCHAR(32),
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_user_time ON usage_logs(user_id, created_at DESC);
CREATE INDEX idx_usage_model_time ON usage_logs(model_id, created_at DESC);
```

### `audit_logs` — 管理员操作审计
```sql
CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER REFERENCES admins(id),
  action      VARCHAR(64) NOT NULL,                  -- user.create / user.recharge / model.update ...
  target_type VARCHAR(32),                           -- user/model/system
  target_id   INTEGER,
  detail      TEXT,                                  -- JSON
  ip          VARCHAR(64),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `sessions` — 客户端会话（可选，先不做）
```sql
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       VARCHAR(256),
  messages    TEXT,                                  -- JSON 数组
  pinned      BOOLEAN DEFAULT 0,
  archived    BOOLEAN DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 初始化数据示例

### 默认超管
```sql
INSERT INTO admins (username, password_hash, role) VALUES
  ('root', '<bcrypt hash of initial password>', 'superadmin');
```

### 默认模型
```sql
-- 这些信息在 admin 后台维护，初始可以先插几条
INSERT INTO models (model_key, display_name, provider, upstream_url, upstream_model, api_key_enc, credit_rate) VALUES
  ('doubao-pro',       '豆包 Pro',         'ark',       'https://ark.cn-beijing.volces.com/api/v3', 'doubao-pro-32k', '<enc>', 1.0),
  ('gpt-4o',           'GPT-4o',           'openai',    'https://api.openai.com/v1', 'gpt-4o', '<enc>', 3.0),
  ('claude-3.5-sonnet','Claude 3.5 Sonnet','anthropic', 'https://api.anthropic.com/v1', 'claude-3-5-sonnet-20241022', '<enc>', 3.0),
  ('deepseek-chat',    'DeepSeek Chat',    'deepseek',  'https://api.deepseek.com/v1', 'deepseek-chat', '<enc>', 0.5);
```

---

## 加密策略

- `api_key_enc`: 用 Fernet 对称加密，主密钥放 blog 的环境变量 `YT_MASTER_KEY`
- 启动时初始化 `cryptography.fernet.Fernet(MASTER_KEY)`，存取时 encode/decode
- 不在 admin 后台明文展示，仅"已配置"/"未配置"标记 + 重新设置入口

---

## 数据迁移

- 用 **Alembic** 做 schema 迁移
- 每次表结构变动写 migration 脚本
- 从 SQLite 迁 PG 时，先用 `pgloader` 或自写脚本导数据
