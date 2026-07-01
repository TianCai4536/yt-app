import { useEffect, useState, useCallback } from "react";
import { adminApi, type AdminModel } from "../lib/api";
import { useDialog } from "../lib/dialog";

const PROVIDERS = ["ark", "openai", "anthropic", "dashscope", "deepseek", "other"];

export function ModelsPage() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [editing, setEditing] = useState<AdminModel | null>(null);
  const [creating, setCreating] = useState(false);
  const dialog = useDialog();

  const load = useCallback(() => {
    adminApi.listModels().then((r) => setModels(r.items)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(m: AdminModel) {
    await adminApi.patchModel(m.id, { enabled: !m.enabled });
    load();
  }
  async function del(m: AdminModel) {
    const ok = await dialog.confirm({
      title: "删除模型",
      message: `确认删除模型「${m.display_name}」(${m.model_key})？已授权用户将无法再使用。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await adminApi.deleteModel(m.id);
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">模型管理</h2>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ 添加模型</button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th><th>model_key</th><th>显示名</th><th>渠道</th>
            <th>倍率</th><th>Key</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td>{m.id}</td>
              <td><code>{m.model_key}</code></td>
              <td>{m.display_name}</td>
              <td>{m.provider}</td>
              <td>×{m.credit_rate}</td>
              <td>{m.api_key_set ? "✅" : "❌"}</td>
              <td><span className={`badge badge-${m.enabled ? "active" : "suspended"}`}>{m.enabled ? "启用" : "禁用"}</span></td>
              <td className="ops">
                <button onClick={() => setEditing(m)}>编辑</button>
                <button onClick={() => toggle(m)}>{m.enabled ? "禁用" : "启用"}</button>
                <button className="danger" onClick={() => del(m)}>删除</button>
              </td>
            </tr>
          ))}
          {models.length === 0 && <tr><td colSpan={8} className="empty">暂无模型</td></tr>}
        </tbody>
      </table>

      {(editing || creating) && (
        <ModelModal
          model={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function ModelModal({ model, onClose, onSaved }: {
  model: AdminModel | null; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !model;
  const [f, setF] = useState({
    model_key: model?.model_key || "",
    display_name: model?.display_name || "",
    provider: model?.provider || "ark",
    upstream_url: model?.upstream_url || "",
    upstream_model: model?.upstream_model || "",
    api_key: "",
    credit_rate: model?.credit_rate ?? 1.0,
    context_window: model?.context_window ?? 0,
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(""); setSaving(true);
    try {
      if (isNew) {
        if (!f.model_key || !f.upstream_url || !f.upstream_model || !f.api_key) {
          setErr("model_key / 上游URL / 上游模型 / API Key 必填"); setSaving(false); return;
        }
        await adminApi.createModel(f);
      } else {
        const body: any = { ...f };
        if (!body.api_key) delete body.api_key;
        delete body.model_key;
        await adminApi.patchModel(model!.id, body);
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message === "model_key_exists" ? "model_key 已存在" : "保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? "添加模型" : `编辑模型：${model!.model_key}`}</h3>
        <div className="form-grid">
          <label>model_key（对外）<input value={f.model_key} disabled={!isNew} onChange={(e) => set("model_key", e.target.value)} placeholder="doubao-pro" /></label>
          <label>显示名<input value={f.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="豆包 Pro" /></label>
          <label>渠道
            <select value={f.provider} onChange={(e) => set("provider", e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>倍率（1积分=1000token×倍率）<input type="number" step="0.1" value={f.credit_rate} onChange={(e) => set("credit_rate", parseFloat(e.target.value) || 1)} /></label>
          <label className="full">上游 baseURL<input value={f.upstream_url} onChange={(e) => set("upstream_url", e.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" /></label>
          <label>上游真实模型ID<input value={f.upstream_model} onChange={(e) => set("upstream_model", e.target.value)} placeholder="doubao-pro-32k" /></label>
          <label>上下文窗口<input type="number" value={f.context_window} onChange={(e) => set("context_window", parseInt(e.target.value) || 0)} /></label>
          <label className="full">API Key{!isNew && "（留空不改）"}<input type="password" value={f.api_key} onChange={(e) => set("api_key", e.target.value)} placeholder={model?.api_key_set ? "已配置，留空保持不变" : "sk-..."} /></label>
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
