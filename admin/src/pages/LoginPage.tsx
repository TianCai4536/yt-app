import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../lib/api";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await adminApi.login(username.trim(), password);
      nav("/", { replace: true });
    } catch {
      setErr("用户名或密码错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="login-logo">⚙️</span>
          <h1>异想天开 · 后台</h1>
        </div>
        <input placeholder="管理员账号" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div className="login-err">{err}</div>}
        <button disabled={loading || !username || !password}>{loading ? "登录中…" : "登 录"}</button>
      </form>
    </div>
  );
}
