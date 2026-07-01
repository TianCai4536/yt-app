import { useEffect, useState, useCallback } from "react";
import { adminApi, type AdminUser, type AdminModel } from "../lib/api";
import { useDialog } from "../lib/dialog";

export function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const dialog = useDialog();

  const load = useCallback(() => {
    adminApi.listUsers(1, 100, search).then((r) => setUsers(r.items)).catch(() => {});
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { adminApi.listModels().then((r) => setModels(r.items)).catch(() => {}); }, []);

  async function recharge(u: AdminUser) {
    const v = await dialog.prompt({
      title: `为 ${u.username} 调整积分`,
      message: "正数充值，负数扣减（当前余额 ⚡ " + u.credits + "）",
      defaultValue: "100",
      inputType: "number",
    });
    if (v === null) return;
    const delta = parseInt(v, 10);
    if (isNaN(delta)) return;
    await adminApi.recharge(u.id, delta, "后台手动调整");
    load();
  }

  async function toggleStatus(u: AdminUser) {
    const next = u.status === "active" ? "suspended" : "active";
    await adminApi.patchUser(u.id, { status: next });
    load();
  }

  async function del(u: AdminUser) {
    const ok = await dialog.confirm({
      title: "删除用户",
      message: `确认删除用户「${u.username}」？该操作为软删除，会保留历史记录。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await adminApi.deleteUser(u.id);
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">用户管理</h2>
        <div className="page-actions">
          <input className="search" placeholder="搜索用户名…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-primary" onClick={() => setCreating(true)}>+ 新建用户</button>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th><th>账号</th><th>昵称</th><th>积分</th><th>状态</th>
            <th>授权模型</th><th>有效期</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.username}</td>
              <td>{u.display_name || "-"}</td>
              <td className="credits-cell">⚡ {u.credits}</td>
              <td><span className={`badge badge-${u.status}`}>{statusText(u.status)}</span></td>
              <td>{u.model_keys.length ? u.model_keys.join(", ") : <span className="dim">无</span>}</td>
              <td>{u.expires_at ? u.expires_at.slice(0, 10) : "永久"}</td>
              <td className="ops">
                <button onClick={() => recharge(u)}>充值</button>
                <button onClick={() => setEditing(u)}>编辑</button>
                <button onClick={() => toggleStatus(u)}>{u.status === "active" ? "停用" : "启用"}</button>
                <button className="danger" onClick={() => del(u)}>删除</button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={8} className="empty">暂无用户</td></tr>}
        </tbody>
      </table>

      {(editing || creating) && (
        <UserModal
          user={editing}
          models={models}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function statusText(s: string) {
  return { active: "正常", suspended: "停用", expired: "过期", deleted: "已删除" }[s] || s;
}

function UserModal({ user, models, onClose, onSaved }: {
  user: AdminUser | null; models: AdminModel[]; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !user;
  const [username, setUsername] = useState(user?.username || "");
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [password, setPassword] = useState("");
  const [credits, setCredits] = useState(user?.credits ?? 0);
  const [expires, setExpires] = useState(user?.expires_at?.slice(0, 10) || "");
  const [selModels, setSelModels] = useState<string[]>(user?.model_keys || []);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleModel(key: string) {
    setSelModels((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  }

  async function save() {
    setErr(""); setSaving(true);
    try {
      if (isNew) {
        if (!username || !password) { setErr("账号和密码必填"); setSaving(false); return; }
        await adminApi.createUser({
          username, password, display_name: displayName || null,
          initial_credits: credits, expires_at: expires ? `${expires}T23:59:59` : null,
          model_keys: selModels,
        });
      } else {
        const body: any = {
          display_name: displayName || null,
          expires_at: expires ? `${expires}T23:59:59` : null,
          model_keys: selModels,
        };
        if (password) body.new_password = password;
        await adminApi.patchUser(user!.id, body);
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message === "username_exists" ? "账号已存在" : "保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? "新建用户" : `编辑用户：${user!.username}`}</h3>
        <div className="form-grid">
          <label>账号<input value={username} disabled={!isNew} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>昵称<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          <label>{isNew ? "密码" : "重置密码（留空不改）"}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {isNew && <label>初始积分<input type="number" value={credits} onChange={(e) => setCredits(parseInt(e.target.value) || 0)} /></label>}
          <label>有效期（留空=永久）<input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        </div>
        <div className="model-select">
          <span>授权模型：</span>
          {models.map((m) => (
            <label key={m.id} className="model-checkbox">
              <input type="checkbox" checked={selModels.includes(m.model_key)} onChange={() => toggleModel(m.model_key)} />
              {m.display_name}
            </label>
          ))}
          {models.length === 0 && <span className="dim">请先在「模型管理」添加模型</span>}
        </div>
        {err && <div className="modal-err">{err}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}
