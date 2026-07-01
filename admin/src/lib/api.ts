/** 管理后台 API 客户端 */
const API_BASE = "/yt-api";
const TOKEN_KEY = "yt_admin_" + "token";

export const adminToken = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const t = adminToken.get();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    adminToken.clear();
    if (!location.pathname.endsWith("/login")) location.href = "/ai-app_admin/login";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error?.code || `HTTP ${res.status}`);
  return data as T;
}

export interface AdminUser {
  id: number; username: string; display_name: string | null;
  email: string | null; phone: string | null; credits: number;
  status: string; expires_at: string | null; notes: string | null;
  last_login_at: string | null; created_at: string; model_keys: string[];
}

export interface AdminModel {
  id: number; model_key: string; display_name: string; provider: string;
  upstream_url: string; upstream_model: string; credit_rate: number;
  context_window: number | null; supports_tools: boolean; supports_stream: boolean;
  enabled: boolean; sort_order: number; api_key_set: boolean;
}

export const adminApi = {
  async login(username: string, password: string) {
    const res = await fetch(`${API_BASE}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error("invalid_credentials");
    const data = await res.json();
    adminToken.set(data.access_token);
    return data.admin;
  },
  logout: () => adminToken.clear(),
  isLoggedIn: () => !!adminToken.get(),

  overview: () => req<{ total_users: number; total_models: number; credits_consumed_24h: number; credits_consumed_7d: number }>("/admin/stats/overview"),

  trend: (days = 7) => req<{ items: { date: string; calls: number; credits: number }[] }>(`/admin/stats/trend?days=${days}`),
  topUsers: (limit = 5) => req<{ items: { username: string; credits: number }[] }>(`/admin/stats/top-users?limit=${limit}`),

  adminMe: () => req<{ id: number; username: string; display_name: string | null; email: string | null; role: string; last_login_at: string | null; created_at: string }>("/admin/me"),
  updateAdminProfile: (body: { display_name?: string; email?: string }) => req("/admin/me", { method: "PATCH", body: JSON.stringify(body) }),
  adminChangePassword: (old_password: string, new_password: string) => req("/admin/me/change-password", { method: "POST", body: JSON.stringify({ old_password, new_password }) }),
  userUsage: (uid: number, page = 1, size = 20) => req<{ items: any[]; total: number }>(`/admin/users/${uid}/usage?page=${page}&size=${size}`),

  listUsers: (page = 1, size = 50, search = "") =>
    req<{ items: AdminUser[]; total: number }>(`/admin/users?page=${page}&size=${size}${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  createUser: (body: any) => req<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(body) }),
  patchUser: (id: number, body: any) => req<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  recharge: (id: number, delta: number, note?: string) => req<{ credits_after: number }>(`/admin/users/${id}/recharge`, { method: "POST", body: JSON.stringify({ delta, note }) }),
  deleteUser: (id: number) => req(`/admin/users/${id}`, { method: "DELETE" }),

  listModels: () => req<{ items: AdminModel[] }>("/admin/models"),
  createModel: (body: any) => req("/admin/models", { method: "POST", body: JSON.stringify(body) }),
  patchModel: (id: number, body: any) => req(`/admin/models/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteModel: (id: number) => req(`/admin/models/${id}`, { method: "DELETE" }),
};
