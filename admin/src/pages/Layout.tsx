import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { adminApi } from "../lib/api";
import { useTheme } from "../lib/themeStore";

export function Layout() {
  const nav = useNavigate();
  const [admin, setAdmin] = useState<any>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    adminApi.adminMe().then(setAdmin).catch(() => {});
  }, []);

  function logout() {
    adminApi.logout();
    nav("/login", { replace: true });
  }

  const roleText = admin?.role === "superadmin" ? "超级管理员" : "管理员";
  const close = () => setSideOpen(false);

  return (
    <div className="admin">
      {sideOpen && <div className="admin-scrim" onClick={close} />}
      <aside className={`admin-side ${sideOpen ? "open" : ""}`}>
        <div className="admin-brand"><span className="admin-logo">⚙️</span> 异想天开后台</div>

        {/* 功能导航 */}
        <nav onClick={close}>
          <NavLink to="/" end>📊 概览</NavLink>
          <NavLink to="/users">👥 用户管理</NavLink>
          <NavLink to="/models">🤖 模型管理</NavLink>
        </nav>

        {/* 头像区 + 其下：管理员信息 / 系统设置 */}
        <div className="admin-side-foot">
          <div className="admin-card">
            <div className="admin-card-avatar">{(admin?.display_name || admin?.username || "?")[0]?.toUpperCase()}</div>
            <div className="admin-card-info">
              <div className="admin-card-name">{admin?.display_name || admin?.username || "…"}</div>
              <div className="admin-card-role">{roleText}</div>
            </div>
          </div>
          <nav className="admin-foot-nav" onClick={close}>
            <NavLink to="/account">🔑 管理员信息</NavLink>
            <NavLink to="/settings">⚙️ 系统设置</NavLink>
          </nav>
          <button className="admin-logout" onClick={logout}>退出登录</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <button className="admin-hamburger" onClick={() => setSideOpen(true)} title="菜单">☰</button>
          <div className="admin-topbar-spacer" />
          <button className="theme-toggle" onClick={toggle} title={theme === "dark" ? "切换到浅色" : "切换到深色"}>
            {theme === "dark" ? "🌙" : "☀️"}
          </button>
        </header>
        <div className="admin-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
