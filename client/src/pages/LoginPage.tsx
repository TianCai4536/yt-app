import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/store";
import { api } from "../lib/api";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (api.isLoggedIn()) navigate("/", { replace: true });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await login(username.trim(), password);
    if (ok) navigate("/", { replace: true });
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <div className="brand-logo">💡</div>
          <h1>异想天开</h1>
          <p className="brand-sub">想到就能做到</p>
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <label>
            <span>账号</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入账号"
              autoFocus
              autoComplete="username"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={loading || !username || !password}>
            {loading ? "登录中…" : "登 录"}
          </button>
        </form>

        <p className="login-foot">账号由管理员分配 · 如有问题请联系管理员</p>
      </div>
    </div>
  );
}
