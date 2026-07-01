import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";

export function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [trend, setTrend] = useState<{ date: string; calls: number; credits: number }[]>([]);
  const [topUsers, setTopUsers] = useState<{ username: string; credits: number }[]>([]);

  useEffect(() => {
    adminApi.overview().then(setData).catch(() => {});
    adminApi.trend(7).then((r) => setTrend(r.items)).catch(() => {});
    adminApi.topUsers(5).then((r) => setTopUsers(r.items)).catch(() => {});
  }, []);

  const cards = [
    { label: "用户总数", value: data?.total_users, sub: `${data?.active_users ?? 0} 个活跃`, icon: "👥" },
    { label: "模型数量", value: data?.total_models, sub: `${data?.enabled_models ?? 0} 个启用`, icon: "🤖" },
    { label: "24h 消耗", value: data?.credits_consumed_24h, sub: "积分", icon: "⚡" },
    { label: "7天消耗", value: data?.credits_consumed_7d, sub: "积分", icon: "📈" },
    { label: "总调用次数", value: data?.total_calls, sub: `今日 ${data?.calls_24h ?? 0} 次`, icon: "🔄" },
    { label: "总 Token", value: fmtNum(data?.total_tokens), sub: "累计消耗", icon: "🎫" },
    { label: "对话总数", value: data?.total_conversations, sub: "会话", icon: "💬" },
    { label: "积分余额池", value: fmtNum(data?.total_credits_balance), sub: `失败 ${data?.error_calls ?? 0} 次`, icon: "💰" },
  ];

  const maxCalls = Math.max(1, ...trend.map((t) => t.calls));

  return (
    <div>
      <h2 className="page-title">概览</h2>
      <div className="stat-grid">
        {cards.map((c) => (
          <div key={c.label} className="stat-card">
            <div className="stat-icon">{c.icon}</div>
            <div className="stat-value">{c.value ?? "--"}</div>
            <div className="stat-label">{c.label}</div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="dash-row">
        <div className="dash-panel">
          <h3>近 7 天调用趋势</h3>
          <div className="bar-chart">
            {trend.map((t) => (
              <div key={t.date} className="bar-col" title={`${t.date}: ${t.calls} 次调用 / ${t.credits} 积分`}>
                <div className="bar-fill" style={{ height: `${(t.calls / maxCalls) * 100}%` }}>
                  <span className="bar-num">{t.calls || ""}</span>
                </div>
                <div className="bar-label">{t.date}</div>
              </div>
            ))}
            {trend.length === 0 && <div className="empty">暂无数据</div>}
          </div>
        </div>

        <div className="dash-panel">
          <h3>本周积分消耗 TOP 5</h3>
          <div className="rank-list">
            {topUsers.map((u, i) => (
              <div key={u.username} className="rank-item">
                <span className={`rank-no rank-${i + 1}`}>{i + 1}</span>
                <span className="rank-name">{u.username}</span>
                <span className="rank-val">⚡ {u.credits}</span>
              </div>
            ))}
            {topUsers.length === 0 && <div className="empty">暂无数据</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtNum(n: number | undefined) {
  if (n == null) return "--";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}
