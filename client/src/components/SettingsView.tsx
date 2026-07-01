import { useState } from "react";
import { useSettings } from "../lib/settingsStore";
import { useTheme } from "../lib/themeStore";

export function SettingsView({ models }: { models: { model_key: string; display_name: string }[] }) {
  const { settings, save } = useSettings();
  const { theme, setTheme } = useTheme();
  const [saved, setSaved] = useState(false);

  function update(patch: any) {
    save(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="settings-view">
      <div className="view-head">
        <h2>设置</h2>
        {saved && <span className="saved-hint">✓ 已保存</span>}
      </div>

      <div className="settings-section">
        <h3>对话</h3>
        <div className="setting-row">
          <label>默认模型</label>
          <select
            value={settings.default_model || ""}
            onChange={(e) => update({ default_model: e.target.value || null })}
          >
            <option value="">（使用第一个授权模型）</option>
            {models.map((m) => (
              <option key={m.model_key} value={m.model_key}>{m.display_name}</option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <label>温度 (Temperature)<span className="setting-desc">越高越发散，越低越严谨</span></label>
          <div className="slider-wrap">
            <input
              type="range" min="0" max="2" step="0.1"
              value={settings.temperature}
              onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
            />
            <span className="slider-value">{settings.temperature.toFixed(1)}</span>
          </div>
        </div>

        <div className="setting-row">
          <label>系统提示词 (System Prompt)<span className="setting-desc">每次对话自动加在最前面，定义 AI 的角色/风格</span></label>
          <textarea
            className="setting-textarea"
            rows={4}
            placeholder="例如：你是一位资深的中文技术顾问，回答简洁专业。"
            value={settings.system_prompt}
            onChange={(e) => update({ system_prompt: e.target.value })}
          />
        </div>

        <div className="setting-row setting-row-inline">
          <label>发送方式</label>
          <div className="radio-group">
            <label className="radio">
              <input type="radio" checked={settings.send_on_enter} onChange={() => update({ send_on_enter: true })} />
              Enter 发送
            </label>
            <label className="radio">
              <input type="radio" checked={!settings.send_on_enter} onChange={() => update({ send_on_enter: false })} />
              Ctrl+Enter 发送
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>外观</h3>
        <div className="setting-row setting-row-inline">
          <label>主题<span className="setting-desc">也可点右上角图标快速切换</span></label>
          <div className="radio-group">
            <label className="radio">
              <input type="radio" checked={theme === "dark"} onChange={() => setTheme("dark")} />
              🌙 深色
            </label>
            <label className="radio">
              <input type="radio" checked={theme === "light"} onChange={() => setTheme("light")} />
              ☀️ 浅色
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
