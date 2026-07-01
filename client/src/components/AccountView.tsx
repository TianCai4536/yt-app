import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/store";

type Tab = "profile" | "usage" | "credits" | "recharge";

export function AccountView({ onBack }: { onBack: () => void }) {
  const { user, loadMe } = useAuth();
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="account-view">
      <div className="view-head">
        <h2>账号信息</h2>
        <button className="link-btn" onClick={onBack}>← 返回对话</button>
      </div>

      <div className="account-card">
        <div className="account-avatar">{(user?.display_name || user?.username || "?")[0]}</div>
        <div className="account-meta">
          <div className="account-name">{user?.display_name || user?.username}</div>
          <div className="account-sub">@{user?.username} · ⚡ {user?.credits} 积分</div>
          {user?.expires_at && <div className="account-sub dim">有效期至 {user.expires_at.slice(0, 10)}</div>}
        </div>
      </div>

      <div className="account-tabs">
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>资料 / 密码</button>
        <button className={tab === "usage" ? "active" : ""} onClick={() => setTab("usage")}>用量明细</button>
        <button className={tab === "credits" ? "active" : ""} onClick={() => setTab("credits")}>积分记录</button>
        <button className={tab === "recharge" ? "active" : ""} onClick={() => setTab("recharge")}>充值</button>
      </div>

      <div className="account-body">
        {tab === "profile" && <ProfileTab onSaved={loadMe} />}
        {tab === "usage" && <UsageTab />}
        {tab === "credits" && <CreditsTab />}
        {tab === "recharge" && <RechargeTab />}
      </div>
    </div>
  );
}

function ProfileTab({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [msg, setMsg] = useState("");

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  async function saveProfile() {
    setMsg("");
    try {
      await api.updateProfile({ display_name: displayName, email });
      setMsg("✓ 资料已更新");
      onSaved();
    } catch { setMsg("保存失败"); }
  }

  async function changePw() {
    setPwMsg("");
    if (newPw.length < 6) { setPwMsg("新密码至少 6 位"); return; }
    try {
      await api.changePassword(oldPw, newPw);
      setPwMsg("✓ 密码已修改");
      setOldPw(""); setNewPw("");
    } catch (e: any) {
      setPwMsg(e?.code === "invalid_old_password" ? "原密码错误" : "修改失败");
    }
  }

  return (
    <div className="tab-pane">
      <div className="form-block">
        <h4>修改资料</h4>
        <label>昵称<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label>邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可选" /></label>
        <div className="form-action">
          <button className="btn-primary" onClick={saveProfile}>保存资料</button>
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
  );
}

function UsageTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => { api.myUsage(1, 30).then((r) => { setRows(r.items); setTotal(r.total); }).catch(() => {}); }, []);
  return (
    <div className="tab-pane">
      <p className="tab-hint">共 {total} 条调用记录</p>
      <table className="mini-table">
        <thead><tr><th>时间</th><th>模型</th><th>Tokens</th><th>扣分</th><th>状态</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmt(r.created_at)}</td><td>{r.model}</td>
              <td>{r.total_tokens}</td><td>⚡{r.credits_charged}</td>
              <td><span className={r.status === "success" ? "ok" : "err"}>{r.status === "success" ? "成功" : "失败"}</span></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="empty">暂无记录</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CreditsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => { api.myCreditLogs(1, 30).then((r) => { setRows(r.items); setTotal(r.total); }).catch(() => {}); }, []);
  return (
    <div className="tab-pane">
      <p className="tab-hint">共 {total} 条积分变动</p>
      <table className="mini-table">
        <thead><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>备注</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmt(r.created_at)}</td><td>{r.reason}</td>
              <td className={r.delta >= 0 ? "ok" : "err"}>{r.delta >= 0 ? "+" : ""}{r.delta}</td>
              <td>{r.balance_after}</td><td className="dim">{r.note || "-"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="empty">暂无记录</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RechargeTab() {
  return (
    <div className="tab-pane">
      <div className="recharge-placeholder">
        <div className="recharge-icon">💳</div>
        <h3>充值缴费</h3>
        <p>在线充值功能正在开发中，敬请期待。</p>
        <p className="dim">当前如需充值积分，请联系管理员。</p>
        <div className="recharge-packages">
          {[
            { credits: 1000, price: "¥10" },
            { credits: 5000, price: "¥45" },
            { credits: 10000, price: "¥80" },
          ].map((p) => (
            <div key={p.credits} className="package-card disabled">
              <div className="package-credits">⚡ {p.credits}</div>
              <div className="package-price">{p.price}</div>
              <button disabled>即将开放</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmt(s: string) {
  if (!s) return "-";
  const d = new Date(s.endsWith("Z") || s.includes("+") ? s : s + "Z");
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
