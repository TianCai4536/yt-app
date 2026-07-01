# DECISIONS.md — 架构决策记录（ADR）

> 每个决策记录三件事：选了什么、为什么、放弃了什么。

## ADR-001 客户端壳：Tauri 2.x

**决策**：用 Tauri 2.x + Rust + React + TypeScript。

**原因**：
- 安装包 6-10MB（Electron 通常 100MB+）
- 内存占用 ≈ 系统 WebView + Rust 进程，比 Electron 省 50%+
- Rust 后端写本地工具又快又安全，自带类型系统防漏洞
- 跨平台扩展容易（虽然先做 Win）

**放弃**：
- Electron（包大、内存大）
- WPF / WinForms（生态不如 Web 技术栈）
- Flutter Desktop（桌面端生态相对弱）

**代价**：
- 团队要懂 Rust（虽然只用到 `tauri::command` 这层）
- shadcn/ui 等组件库一致性需要小心维护

---

## ADR-002 服务端：FastAPI + Python

**决策**：FastAPI + SQLAlchemy + Alembic + Uvicorn。

**原因**：
- blog 已经在跑 Python（OCR 服务也是）
- FastAPI 自带 OpenAPI 文档，前端可自动生成 SDK
- 异步性能足够支撑 100+ 用户
- 文档好，生态成熟

**放弃**：
- Go（性能更好但 ORM 生态差）
- Node.js（统一语言但运行时不如 Python 稳）
- Rust（开发效率低）

---

## ADR-003 数据库：SQLite → PostgreSQL

**决策**：开发期 SQLite，用户数 > 100 或并发写多时迁 PostgreSQL。

**原因**：
- SQLite 零运维，blog 直接拷贝文件就是备份
- SQLAlchemy 切换数据库只改一行连接串
- 100 用户内 SQLite 性能完全够（WAL 模式）

**放弃**：
- 一开始直接上 PostgreSQL（运维成本高）
- MySQL（PG 更现代、JSON 字段更强）

---

## ADR-004 鉴权：JWT + Refresh Token

**决策**：HS256 JWT，access 1h + refresh 30 天，密钥在 blog 环境变量里。

**原因**：
- 无状态，方便横向扩展（虽然现在不需要）
- 客户端存储简单
- 行业标准

**放弃**：
- Session Cookie（不适合桌面客户端）
- OAuth2 完整流程（自建场景不需要）

**注意**：
- access token 用过期 / 撤销列表实现登出（写一个 `revoked_tokens` 表）
- refresh token 绑设备指纹防盗用

---

## ADR-005 模型协议：OpenAI 兼容

**决策**：客户端只对接 OpenAI 兼容协议 `/v1/chat/completions`，服务端做协议转换。

**原因**：
- 客户端一份代码，能用所有模型
- OpenAI SDK 现成（`openai` npm 包 + Python sdk）
- 上游切换不影响客户端

**放弃**：
- 客户端直接对接各家原始 API（耦合死、不安全）

**实现要点**：
- 服务端用 LiteLLM 或自写 adapter（推荐自写，简单且无依赖）

---

## ADR-006 计费：积分 = Token / 1000 × 倍率

**决策**：每模型配 `credit_rate` 倍率，扣分公式 `ceil((prompt + completion) / 1000 × rate)`。

**原因**：
- Token 是 LLM 通用计量单位，公平
- 积分让用户感知更直观（1 积分对应"一千字"的量感）
- 倍率灵活反映上游真实成本（GPT-4o 比 doubao 贵 3 倍 → rate=3）

**放弃**：
- 按时长（无法反映 token 消耗差异）
- 按请求次数（不公平：长回复和短回复一样收费）

**注意**：
- 客户端 UI 显示积分，不直接显示 token（避免用户困惑）
- 后台可见原始 token 数

---

## ADR-007 管理后台：Refine + AntD

**决策**：用 Refine 框架（自动 CRUD）+ AntD（中文友好）。

**原因**：
- 写 schema 就出后台，省 80% 代码
- AntD 表格 / 表单组件成熟，中文场景多
- 数据 Provider 抽象好，REST API 直接对接

**放弃**：
- 自己撸 React + AntD（重复劳动多）
- React Admin（英文优先，中文体验差点）
- Vue + Element Plus（团队栈不一致）

---

## ADR-008 上游 API Key 加密

**决策**：用 Fernet 对称加密，主密钥放 blog 环境变量 `YT_MASTER_KEY`。

**原因**：
- 即使数据库泄漏，没主密钥也解不开 Key
- Fernet 自带 HMAC 防篡改
- Python `cryptography` 库官方实现

**放弃**：
- 明文存（不安全）
- 用户提供自己的 Key（违背设计初衷：用户不需要管 Key）
- 用 KMS / Vault（运维成本高）

---

## ADR-009 LLM 流式响应：SSE

**决策**：服务端 SSE 透传上游响应。

**原因**：
- OpenAI 标准就是 SSE
- HTTP 简单，nginx 反代容易（关掉 buffer 即可）
- 客户端 `fetch` 或 `EventSource` 都能消费

**放弃**：
- WebSocket（双向通信，但聊天是单向流，没必要）
- 长轮询（实时性差）

**nginx 注意**：
```nginx
location /yt-api/v1/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_buffering off;       # 关键，否则不流式
    proxy_cache off;
    proxy_read_timeout 600s;
    proxy_set_header X-Accel-Buffering no;
}
```

---

## ADR-010 本地工具：Tauri Command + 审批门

**决策**：所有本地操作走 Tauri Rust 端实现的 `tauri::command`，高危操作弹窗确认。

**原因**：
- Rust 端运行，前端无法直接接触系统 API
- 安全：任何系统调用都经 Rust 校验
- 性能：Rust 比 Node 快

**审批门规则**：
| 操作 | 默认 |
|------|------|
| 读文件 | 自动允许（限制在用户目录） |
| 写新文件 | 自动允许（限制在用户目录） |
| 覆盖文件 | 弹窗确认 |
| 删除文件 | 弹窗确认 |
| 执行 shell 命令 | 弹窗确认（白名单可免确认） |
| 写注册表 | 总是弹窗 |
| 操作系统目录（C:\Windows） | 拒绝 |

**配置**：用户可以在设置里把信任的目录加白名单，免确认。

---

## ADR-011 项目名 / 包名

**决策**：
- 产品名：**异想天开**
- 英文：**YiXiang TianKai**
- 包名/标识符：`yixiangtiankai` （npm/cargo/pip 都用这个）
- 缩写：`YT`（在代码里用，例如 `YT_MASTER_KEY`）

**Logo 风格**：简约 + 创意
- 主元素备选：☁️ 云 / ⚡ 闪电 / 💡 灯泡 / 🪄 魔杖
- 主色：暖色（橙#F97316 / 紫#A855F7）+ 中性灰 #6B7280
- 字体：思源黑体 / Inter

---

## 未决议（待沟通）

- [ ] 是否要做"主题市场"（皮肤）→ V1 不做
- [ ] 是否要做"工具市场"（插件）→ V1 不做
- [ ] 安装包是否要签名 → 个人开发者签名贵，先不签，让用户接受 SmartScreen 提示
- [ ] 数据备份策略 → blog 每天 sqlite 文件快照到另一台
