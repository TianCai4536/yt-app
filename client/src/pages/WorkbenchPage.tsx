import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/store";
import { useChat } from "../lib/chatStore";
import { useSettings } from "../lib/settingsStore";
import { useTheme } from "../lib/themeStore";
import { ChatPanel } from "../components/ChatPanel";
import { ConversationList } from "../components/ConversationList";
import { SettingsView } from "../components/SettingsView";
import { AccountView } from "../components/AccountView";

type View = "chat" | "settings" | "account";

export function WorkbenchPage() {
  const { user, loadMe, logout } = useAuth();
  const { settings, load: loadSettings } = useSettings();
  const { reset } = useChat();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("chat");
  const [curModel, setCurModel] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false); // 移动端侧栏

  useEffect(() => { loadMe(); loadSettings(); }, [loadMe, loadSettings]);

  useEffect(() => {
    if (!user?.models?.length) { setCurModel(null); return; }
    const keys = user.models.map((m) => m.model_key);
    if (settings.default_model && keys.includes(settings.default_model)) {
      setCurModel(settings.default_model);
    } else if (!curModel || !keys.includes(curModel)) {
      setCurModel(keys[0]);
    }
  }, [user, settings.default_model]);

  async function onLogout() {
    reset();
    await logout();
    navigate("/login", { replace: true });
  }

  function go(v: View) {
    setView(v);
    setSideOpen(false);
  }

  const title = view === "chat" ? "对话" : view === "settings" ? "系统设置" : "个人中心";

  return (
    <div className="wb">
      {sideOpen && <div className="wb-scrim" onClick={() => setSideOpen(false)} />}
      <aside className={`wb-side ${sideOpen ? "open" : ""}`}>
        <div className="wb-brand">
          <span className="wb-logo">💡</span>
          <span className="wb-title">异想天开</span>
        </div>

        {/* 对话 + 历史记录 一组 */}
        <div className="wb-section-label">对话</div>
        <ConversationList model={curModel} onEnterChat={() => go("chat")} />

        {/* M7 预留功能按钮（开发完成后同步启用） */}
        <div className="wb-section-label">工具（即将开放）</div>
        <div className="wb-tools">
          <button className="wb-tool" disabled title="M7 本地工具 / Agent，开发中">
            <span className="tool-icon">🛠</span>
            <span className="tool-label">本地工具</span>
            <span className="tool-soon">M7</span>
          </button>
          <button className="wb-tool" disabled title="M7 Agent 自动执行，开发中">
            <span className="tool-icon">🤖</span>
            <span className="tool-label">Agent 模式</span>
            <span className="tool-soon">M7</span>
          </button>
          <button className="wb-tool" disabled title="M8 浏览器 + OCR，开发中">
            <span className="tool-icon">🌐</span>
            <span className="tool-label">浏览器 / OCR</span>
            <span className="tool-soon">M8</span>
          </button>
        </div>

        {/* 头像区 */}
        <div className="wb-side-foot">
          <div className="wb-user">
            <div className="wb-avatar">{(user?.display_name || user?.username || "?")[0]}</div>
            <div className="wb-user-info">
              <div className="wb-user-name">{user?.display_name || user?.username || "…"}</div>
              <div className="wb-user-credits">⚡ {user?.credits ?? "--"} 积分</div>
            </div>
          </div>
          {/* 头像区下面：个人中心 + 系统设置 */}
          <nav className="wb-foot-nav">
            <a className={view === "account" ? "active" : ""} onClick={() => go("account")}>👤 个人中心</a>
            <a className={view === "settings" ? "active" : ""} onClick={() => go("settings")}>⚙️ 系统设置</a>
          </nav>
          <button className="wb-logout" onClick={onLogout}>退出登录</button>
        </div>
      </aside>

      <main className="wb-main">
        <header className="wb-header">
          <div className="wb-header-left">
            <button className="wb-hamburger" onClick={() => setSideOpen(true)} title="菜单">☰</button>
            {view === "chat" ? (
              <ModelSelector
                models={user?.models || []}
                value={curModel}
                onChange={setCurModel}
              />
            ) : (
              <span className="wb-page-title">{title}</span>
            )}
          </div>
          <ThemeToggle />
        </header>

        <section className="wb-body">
          {view === "chat" && <ChatPanel model={curModel} />}
          {view === "settings" && <SettingsView models={user?.models || []} />}
          {view === "account" && <AccountView onBack={() => go("chat")} />}
        </section>
      </main>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="theme-toggle" onClick={toggle} title={theme === "dark" ? "切换到浅色" : "切换到深色"}>
      {theme === "dark" ? "🌙" : "☀️"}
    </button>
  );
}

function ModelSelector({ models, value, onChange }: {
  models: { model_key: string; display_name: string }[];
  value: string | null;
  onChange: (k: string) => void;
}) {
  const [hint, setHint] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!value) return;
    setHint(true);
    const t = setTimeout(() => setHint(false), 3000);
    return () => clearTimeout(t);
  }, [value]);

  if (!models.length) {
    return <span className="wb-model-empty">暂无授权模型（联系管理员开通）</span>;
  }
  return (
    <div className="model-selector">
      <span className="model-selector-label">模型</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        {models.map((m) => (
          <option key={m.model_key} value={m.model_key}>{m.display_name}</option>
        ))}
      </select>
      {hint && <span className="model-hint">已切换 · 仅对新消息生效</span>}
    </div>
  );
}
