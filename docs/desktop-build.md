# 桌面版构建指南（Tauri + GitHub Actions 云端编译）

异想天开客户端同时支持 **Web 版**（部署在 blog）和 **Windows 桌面版**（Tauri）。
桌面版比 Web 版多了「本地工具」能力：读写本地文件、执行命令（Agent 模式可调用）。

## 方式一：云端编译（推荐，零本地环境）

代码已配好 GitHub Actions。触发方式：

### A. 打 tag 自动出 Release
```bash
git tag v0.1.0
git push origin v0.1.0
```
Actions 会自动在 Windows runner 上编译，产物（`.exe` / `.msi`）发布到仓库 Releases 页。

### B. 手动触发
GitHub 仓库 → Actions → 「构建 Windows 桌面版」→ Run workflow。
编译完成后在该次运行的 Artifacts 里下载 `yixiang-tiankai-windows`。

编译耗时约 3-6 分钟（含 Rust 依赖缓存）。

## 方式二：本地编译（需自备环境）

前置：Node.js 20+、Rust（rustup）、Microsoft C++ Build Tools、WebView2 Runtime。

```bash
cd client
npm install
npm run tauri build     # 出安装包
# 或开发调试：
npm run tauri dev
```
产物在 `client/src-tauri/target/release/bundle/`。

## 架构说明

- **Web / 桌面共用一套前端代码**（`client/src`）
- Agent Loop（`lib/agent.ts`）+ 工具注册表（`lib/tools.ts`）环境无关
- 云端工具（计算/搜索/抓取）走服务端 `/v1/tools/exec`，两端都能用
- 本地工具（文件/命令）由 Tauri Rust 端（`src-tauri/src/lib.rs`）实现，
  仅桌面版注入；Web 版自动隐藏
- 桌面版 API 指向 `https://blog.tczeng.top/yt-api`，Web 版走同源 `/yt-api`

## 高危操作审批

`write_file` / `run_shell` 属高危工具，Agent 调用前前端会弹窗要求用户确认，
拒绝则跳过该工具并告知模型。
