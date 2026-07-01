import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

export function AccountPage() {
  const [admin, setAdmin] = useState<any>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => {
    adminApi.adminMe().then((a) => {
      setAdmin(a);
      setDisplayName(a.display_name || "");
      setEmail(a.email || "");
    }).catch(() => {});
  }, []);

  async function saveProfile() {
    setMsg("");
    try {
      await adminApi.updateAdminProfile({ display_name: displayName, email });
      setMsg("✓ 已保存");
      setAdmin((a: any) => ({ ...a, display_name: displayName, email }));
    } catch { setMsg("保存失败"); }
  }

  async function changePw() {
    setPwMsg("");
    if (newPw.length < 6) { setPwMsg("新密码至少 6 位"); return; }
    try {
      await adminApi.adminChangePassword(oldPw, newPw);
      setPwMsg("✓ 密码已修改");
      setOldPw(""); setNewPw("");
    } catch (e: any) {
      setPwMsg(e.message === "invalid_old_password" ? "原密码错误" : "修改失败");
    }
  }

  const roleText = admin?.role === "superadmin" ? "超级管理员" : "管理员";

  return (
    <div>
      <h2 className="page-title">管理员信息</h2>

      <div className="admin-profile-card">
        <div className="admin-profile-avatar">{(admin?.display_name || admin?.username || "?")[0]?.toUpperCase()}</div>
        <div>
          <div className="admin-profile-name">{admin?.display_name || admin?.username}</div>
          <div className="admin-profile-meta">@{admin?.username} · <span className="role-badge">{roleText}</span></div>
          {admin?.last_login_at && <div className="admin-profile-meta dim">上次登录：{fmt(admin.last_login_at)}</div>}
          {admin?.created_at && <div className="admin-profile-meta dim">创建于：{fmt(admin.created_at)}</div>}
        </div>
      </div>

      <div className="form-columns">
        <div className="form-block">
          <h4>修改资料</h4>
          <label>显示名<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          <label>邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可选" /></label>
          <div className="form-action">
            <button className="btn-primary" onClick={saveProfile}>保存</button>
            {msg && <span className="form-msg">{msg}</span>}
          </div>
        </div>

        <div className="form-block">
          <h4>修改密码</h4>
          <label>原密码<input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} /></label>
          <label>新密码<input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></label>
          <div className="form-action">
            <button className="btn-primary" onClick={changePw} disabled={!oldPw || !newPw}>修改密码</button>
            {pwMsg && <span className="form-msg">{pwMsg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(s: string) {
  const d = new Date(s.endsWith("Z") || s.includes("+") ? s : s + "Z");
  return d.toLocaleString("zh-CN");
}
