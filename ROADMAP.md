# ROADMAP.md — 开发节奏 + 里程碑

> 目标：在不烧 token 的前提下，每个 Sprint 都跑出可演示的版本。

## 总览

| Sprint | 目标 | 工期 | 谁主导 |
|--------|------|------|--------|
| S0 | 文档完成 + 环境就绪 | 半天 | 我 + 你 |
| S1 | MVP（登录 + 聊天）能跑通 | 2-3 天 | 本地代理 + 我兜底 |
| S2 | 后台 + 计费 + 本地工具 | 3-5 天 | 本地代理 + 我兜底 |
| S3 | 浏览器 + 多会话 + 看板 | 3-4 天 | 本地代理 |
| S4 | 打包 + 文档 + 发布 | 1-2 天 | 我 + 你 |

---

## S0 — 文档 & 环境（半天）

### 我做（在这里完成，本轮已完成大部分）
- [x] 项目目录骨架
- [x] README.md
- [x] SPEC.md
- [x] DB-SCHEMA.md
- [x] API.md
- [x] ROADMAP.md
- [x] DECISIONS.md（待写）
- [x] PROJECT.md（占位状态文件）

### 你做（在你 Windows 机器上）
- [ ] 装 [Node.js 20+](https://nodejs.org/)
- [ ] 装 [Rust](https://rustup.rs/)（Tauri 需要）
- [ ] 装 [Python 3.11+](https://python.org/)
- [ ] 装 [pnpm](https://pnpm.io/)：`npm i -g pnpm`
- [ ] 装 [Cursor](https://cursor.com/) 或 VS Code + Continue / Aider（用于本地代理 + 便宜模型生成重复代码）
- [ ] 拉本仓库 → 让本地代理读 SPEC/API/DB-SCHEMA → 生成 server 项目

### blog 端准备（我可以远程做）
- [ ] 装 Python 3.11+ venv + uv 或 poetry
- [ ] 装 SQLite（系统自带）
- [ ] 用 nginx 在 blog 加一个 location `/yt-api` 反代到 FastAPI（端口 8001 先占着）
- [ ] 用 nginx 加 `/ai-app_admin` 反代到 Refine（端口 8002）

---

## S1 — MVP（2-3 天）

### M1 服务端基础
- FastAPI 工程脚手架（`fastapi-cli` 或 `uv init`）
- SQLite + SQLAlchemy + Alembic
- 实现 `users`, `admins`, `models`, `user_models` 四张表
- `/health`, `/auth/login`, `/auth/refresh`, `/me`
- 单元测试：登录正确 / 错误密码 / 过期账号
- 部署到 blog 端，nginx 反代 OK
- **Done 标准**：`curl -X POST .../auth/login` 能拿到 JWT

### M2 客户端登录页
- `npm create tauri-app@latest` (选 React + TS + Tailwind)
- 引入 shadcn/ui 的 `Card / Input / Button`
- 登录表单 → 调 `/auth/login` → 存 token 到 Tauri 本地（用 `tauri-plugin-store`）
- 路由：未登录 → 登录页；已登录 → 工作台空壳
- **Done 标准**：跑 `cargo tauri dev` 能弹窗 + 登录成功跳转

### M3 模型代理
- 服务端实现 `/v1/models` + `/v1/chat/completions`
- 转发到上游（先只接方舟 doubao 一个）
- 流式 SSE 透传
- **暂不扣积分**（M6 才做）
- **Done 标准**：客户端用 OpenAI SDK 配 baseURL 能流式聊天

### M4 客户端聊天 UI
- 引入 `assistant-ui` 或自己撸（推荐前者）
- 流式 token 渲染 + Markdown + 代码高亮
- 顶栏显示用户名 + 积分（占位 `--`）
- **Done 标准**：能正常对话，体验流畅

### S1 里程碑：演示视频 30 秒：登录 → 聊天 → 退出

---

## S2 — 核心功能（3-5 天）

### M5 Admin 后台
- `npm create refine-app@latest` (Refine + AntD)
- 配 REST data provider 指向 `/admin/*`
- 用户列表/创建/编辑/充值/改密
- 模型列表/添加/启用/禁用
- 部署到 blog `/ai-app_admin`
- **Done 标准**：能在浏览器里建用户、改密码、充积分

### M6 积分扣减 + 用量记录
- 服务端：每次 `/v1/chat/completions` 完成后
  - 计算 `credits = ceil(tokens/1000 * rate)`
  - 写 `usage_logs` + `credit_logs`
  - 更新 `users.credits`
- 余额不足 → 402 直接拦
- 客户端：聊天前 `GET /me` 刷新余额；每次聊天完后再刷一次
- **Done 标准**：消费 1500 tokens 扣 2 积分（向上取整）

### M7 本地工具 + Agent Loop（核心难点）
- Tauri Rust 端实现：
  - `fs::read_file(path)`, `fs::write_file(path, content)`, `fs::list_dir(path)`
  - `shell::exec(cmd, cwd)` （带审批回调）
- 前端 Agent Loop:
  - 把工具 schema 塞进 `/v1/chat/completions` 的 `tools`
  - 收到 `tool_calls` → 调 Tauri command → 把结果塞回下一轮
  - 循环到没有 tool_calls 为止
- 审批弹窗：高危操作（删除、写注册表、执行任意命令）要点确认
- **Done 标准**：能完成一个真实任务（"列出桌面所有文件名"）

### S2 里程碑：演示视频 2 分钟：管理员充值 → 用户跑 Agent → 扣分

---

## S3 — 加分项（3-4 天）

### M8 浏览器控制 + OCR（复用 blog 经验）
- 客户端启动一个本地 Chromium（用 `tauri-plugin-shell` 跑 `chrome --remote-debugging-port=...`）
- 通过 CDP 控制（复刻 `cdp-browser-publisher` 技能）
- 可选：本地装 ddddocr Python 服务（沿用 blog 那套）

### M9 多会话 / 设置页 / 主题
- 左侧会话列表，新建/重命名/删除
- 会话存本地 SQLite（Tauri 端）
- 设置页：模型选择、温度、深色模式

### M10 用量看板
- Admin 后台加 Dashboard 页
- 用 `@nivo/line` 或 `recharts` 画消耗趋势 / Top 用户 / Top 模型

---

## S4 — 打包发布（1-2 天）

### M11 安装包
- `tauri build` 生成 MSI / NSIS 安装包
- 配自动更新（`tauri-plugin-updater`）
- 上传到 blog，提供下载页 `https://blog.tczeng.top/yt-app/download`

### M12 文档
- 用户手册（`docs/user-guide.md`）
- 管理员手册（`docs/admin-guide.md`）
- 部署文档（`docs/deploy.md`）

---

## 反向甘特图（依赖）

```
S0(文档) ──┬─→ M1(服务端) ──┬─→ M3(模型代理) ──┬─→ M6(计费)
           ├─→ M2(客户端壳)─┼─→ M4(聊天 UI) ───┴─→ M7(Agent Loop)
           │                ↓                       ↓
           └─→ M5(后台) ─→ 部署 ─────────────→ M8/M9/M10 ─→ M11/M12
```

## 风险注解
- **M3 流式 SSE** 是首个技术坑，先 nginx 反代别 buffer
- **M7 Agent Loop** 是产品核心，bug 多发，留足联调时间
- **M11 Tauri 打包** 可能踩 Windows 签名 / SmartScreen 问题，提前调研
