import { useTheme } from "../lib/themeStore";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <h2 className="page-title">系统设置</h2>
      <div className="form-columns">
        <div className="form-block">
          <h4>外观</h4>
          <label style={{ gap: 12 }}>
            主题
            <div className="radio-group">
              <label className="radio">
                <input type="radio" checked={theme === "dark"} onChange={() => setTheme("dark")} /> 🌙 深色
              </label>
              <label className="radio">
                <input type="radio" checked={theme === "light"} onChange={() => setTheme("light")} /> ☀️ 浅色
              </label>
            </div>
          </label>
          <p className="dim" style={{ fontSize: 13 }}>也可点右上角图标快速切换。设置仅保存在本浏览器。</p>
        </div>
      </div>
    </div>
  );
}
