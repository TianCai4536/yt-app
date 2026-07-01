# 异想天开（YiXiang TianKai）

> 一个把 OpenClaw 工作流"装进 Windows"的 AI 工作台客户端

## 项目结构
```
yixiang-tiankai/
├── SPEC.md            ← 产品愿景 + 模块清单
├── API.md             ← 服务端 API 规范
├── DB-SCHEMA.md       ← 数据库表设计
├── ROADMAP.md         ← 开发节奏 + 里程碑
├── DECISIONS.md       ← 架构决策记录（ADR）
├── PROJECT.md         ← 项目当前状态 + 已踩坑
│
├── server/            ← FastAPI 后端（部署到 blog）
├── client/            ← Tauri Windows 客户端
├── admin/             ← Refine 管理后台（部署到 blog 子路径）
└── docs/              ← 截图 / 架构图 / 用户手册
```

## 核心决策（已敲定）

| 项 | 选择 |
|----|------|
| 客户端 | Tauri 2.x (Rust + React + shadcn/ui) |
| 服务端 | FastAPI (Python) on blog |
| 数据库 | SQLite → PostgreSQL（用户超 100 再迁） |
| 后台 | Refine 部署在 `https://blog.tczeng.top/ai-app_admin` |
| 计费 | Token → 积分，1 积分 = 1000 tokens |
| 模型 | OpenAI 兼容协议；后端按用户配置路由到方舟/OpenAI/Claude/通义/DeepSeek |
| 本地能力 | 文件 + 终端 + 浏览器（CDP）|
| 应用名 | 异想天开 |
| 目标用户 | 短期 10+，长期 100+ |
| 离线模式 | 不做 |

## 快速链接
- 设计文档：[SPEC.md](./SPEC.md)
- API 规范：[API.md](./API.md)
- 数据库设计：[DB-SCHEMA.md](./DB-SCHEMA.md)
- 开发节奏：[ROADMAP.md](./ROADMAP.md)
- 架构决策：[DECISIONS.md](./DECISIONS.md)
- 项目状态：[PROJECT.md](./PROJECT.md)

## 项目里 token 节流策略
1. 架构/关键代码 → 我（OpenClaw 主 session）
2. 脚手架 → 本机直接跑 CLI
3. 重复 CRUD / UI 组件 → 本地代理 Cursor/Continue/Aider + 便宜模型
4. 调试报错 → 你先看，看不懂再问我
5. 设计文档驱动：本地代理只贴对应章节，不贴完整 transcript
