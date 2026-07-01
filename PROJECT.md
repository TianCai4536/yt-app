# PROJECT.md — 项目状态 + 已踩坑（活文档）

> 每次开发完一段就回来更新这个文件。下次新 session 接手只看这一份就够了。

## 当前状态

- **阶段**：Sprint 1 MVP **已完成** + M6 计费提前完成
- **更新日期**：2026-06-30 21:45
- **下一步**：M5 管理后台（Refine）
- **协作模式**：Web 优先——我在 blog 部署，用户开浏览器验证，**用户无需装任何环境**。本地工具(M7)阶段才用云端编译 Windows 客户端。

## 线上访问

- **前端**：https://blog.tczeng.top/yt-app/ （部署在 `/xp/www/blog/yt-app/`）
- **API**：https://blog.tczeng.top/yt-api/ （反代 → 127.0.0.1:8001）
- **测试账号**：alice / Alice@123（1000 积分起，已授权 ark-code 模型）
- **管理员**：root / Root@123

## 已完成

### S0 文档
- [x] 七份地基文档

### S1 MVP（全部完成）
- [x] M1 服务端：登录/JWT/me/change-password
- [x] M2 客户端登录页 + 工作台（Vite+React+TS，部署到 blog 静态）
- [x] M3 模型代理：`/v1/models` + `/v1/chat/completions`（OpenAI 兼容，非流式+SSE流式）
- [x] M4 聊天 UI：流式逐字、Markdown 渲染、自动滚动、停止按钮
- [x] M6 计费（提前做）：Token→积分 ceil(tokens/1000×rate)，写 usage_logs+credit_logs，余额实时刷新

### 技术栈落地确认
- 前端：Vite + React 18 + TS + zustand + react-markdown（**不是 Tauri 脚手架**，先做纯 Web，省 token 且用户免装环境）
- 构建：本机 NAS `npm run build` → tar → scp 到 blog `/xp/www/blog/yt-app/`
- 后端：FastAPI + SQLAlchemy + SQLite + bcrypt + jose JWT + Fernet 加密上游 Key
- 部署：systemd `yt-api.service` + 小皮 nginx rewrite include 反代

### 方舟模型对接
- model_key=`ark-code`，上游 `ark-code-latest`
- baseUrl=`https://ark.cn-beijing.volces.com/api/coding/v3`
- credit_rate=1.0
- API Key 用 Fernet 加密存 DB（YT_MASTER_KEY 在 .env）

## 进行中

无（等待用户准备环境）

## 阻塞

无

---

## 关键技术决策摘要（看 DECISIONS.md 全文）

| ADR | 决策 |
|-----|------|
| 001 | 客户端 = Tauri 2.x + Rust + React + TS |
| 002 | 服务端 = FastAPI + SQLAlchemy + Alembic |
| 003 | 数据库 = SQLite 起步，>100 用户迁 PostgreSQL |
| 004 | 鉴权 = JWT (HS256) + Refresh Token |
| 005 | 协议 = OpenAI 兼容 `/v1/chat/completions` |
| 006 | 计费 = 积分，1 积分 = 1000 tokens × 模型倍率 |
| 007 | 后台 = Refine + AntD |
| 008 | API Key 加密 = Fernet + 环境变量主密钥 |
| 009 | 流式 = SSE，nginx 关 buffer |
| 010 | 本地工具 = Tauri command + 高危审批 |
| 011 | 项目名 = 异想天开 / YT / yixiangtiankai |

---

## 重要路径

| 内容 | 路径 |
|------|------|
| 项目根 | `/vol1/@apphome/trim.openclaw/data/workspace/projects/yixiang-tiankai/` |
| 服务端代码 | `./server/` |
| 客户端代码 | `./client/` |
| 后台代码 | `./admin/` |
| 部署目标（服务端 + 后台） | blog 192.168.1.35 |
| 客户端开发机 | 用户 Windows 机器（待装环境） |
| 公网入口（API） | `https://blog.tczeng.top/yt-api`（占位） |
| 公网入口（后台） | `https://blog.tczeng.top/ai-app_admin` |

---

## 待用户决策的事

- [ ] 客户端开发机的本机环境装好（Node / Rust / Python / pnpm）
- [ ] 选定本地代理（Cursor / Continue / Aider）+ 便宜模型（DeepSeek / 通义 / Qwen-coder）
- [ ] Logo 设计（简约 + 创意，主元素和色彩偏好）
- [ ] 是否需要我先在 blog 端准备好 nginx 反代和 Python 环境

---

## 已踩坑（持续更新）

（暂无）

---

## 后续要关注的点

1. **Windows SmartScreen**：不签名的话首次安装会被警告"未知发布者"，需要用户手动允许；或者花钱买代码签名证书（约 $300/年）
2. **流式响应跨 nginx**：需要 `proxy_buffering off` + `proxy_read_timeout` 加大
3. **Agent Loop 安全**：恶意 prompt 可能诱导执行 `rmdir C:\` 类命令，必须有黑名单 + 审批门
4. **多用户并发**：FastAPI 默认 4 worker 应该够 100 用户，监控好 SQLite WAL
5. **客户端自动更新**：用 tauri-plugin-updater，blog 提供 update.json 端点

---

## 开发节奏（精简）

```
S0(本轮) → S1(MVP) → S2(后台+计费+本地工具) → S3(加分项) → S4(打包发布)
   ▲           ↑               ↑                   ↑              ↑
 已完成    2-3天          3-5天               3-4天          1-2天
```

---

## 跨 session 接手指南

如果你（未来的我）从零开始接手这个项目：

1. **先读这份 PROJECT.md** —— 知道现在在哪
2. **再读 SPEC.md** —— 知道在做什么
3. **要写代码前读 DB-SCHEMA.md + API.md** —— 知道接口长什么样
4. **不确定为什么这样设计时读 DECISIONS.md**
5. **看 ROADMAP.md** 确认当前 Sprint 任务

不要直接读代码！代码可能改了但文档没更新；以本文件 + 用户最新沟通为准。
