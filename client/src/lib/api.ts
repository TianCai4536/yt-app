/** API 客户端：封装 fetch + token 管理 */

const API_BASE = "/yt-api";

export interface UserPublic {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  credits: number;
  status: string;
  expires_at: string | null;
}

export interface ModelPublic {
  model_key: string;
  display_name: string;
  credit_rate: number;
  supports_tools: boolean;
  supports_stream: boolean;
}

export interface MeResponse extends UserPublic {
  models: ModelPublic[];
}

export interface Conversation {
  id: number;
  title: string;
  model_key: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface UserSettings {
  default_model: string | null;
  temperature: number;
  system_prompt: string;
  send_on_enter: boolean;
  theme: string;
}

const TOKEN_KEY = "yt_access_token";
const REFRESH_KEY = "yt_refresh_token";

export const tokenStore = {
  get access() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (auth && tokenStore.access) {
    headers.set("Authorization", `Bearer ${tokenStore.access}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // token 过期，尝试刷新一次
    if (res.status === 401 && auth && tokenStore.refresh) {
      const refreshed = await tryRefresh();
      if (refreshed) return request<T>(path, options, auth);
    }
    const detail = data?.detail || data?.error?.code || "request_failed";
    throw new ApiError(res.status, detail, data?.error?.message || detail);
  }
  return data as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokenStore.refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    tokenStore.set(data.access_token);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  async login(username: string, password: string) {
    const data = await request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: UserPublic;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }, false);
    tokenStore.set(data.access_token, data.refresh_token);
    return data;
  },

  async me() {
    return request<MeResponse>("/me");
  },

  async logout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } finally {
      tokenStore.clear();
    }
  },

  isLoggedIn() {
    return !!tokenStore.access;
  },

  // ---------- 设置 ----------
  getSettings() {
    return request<UserSettings>("/me/settings");
  },
  saveSettings(s: Partial<UserSettings>) {
    return request<UserSettings>("/me/settings", { method: "PUT", body: JSON.stringify(s) });
  },
  updateProfile(body: { display_name?: string; email?: string }) {
    return request<UserPublic>("/me/profile", { method: "PATCH", body: JSON.stringify(body) });
  },
  changePassword(old_password: string, new_password: string) {
    return request<void>("/me/change-password", { method: "POST", body: JSON.stringify({ old_password, new_password }) });
  },
  myUsage(page = 1, size = 20) {
    return request<{ total: number; items: any[] }>(`/me/usage?page=${page}&size=${size}`);
  },
  myCreditLogs(page = 1, size = 20) {
    return request<{ total: number; items: any[] }>(`/me/credit-logs?page=${page}&size=${size}`);
  },

  // ---------- 会话 ----------
  listConversations() {
    return request<{ items: Conversation[] }>("/me/conversations");
  },
  createConversation(body: { title?: string; model_key?: string }) {
    return request<Conversation>("/me/conversations", { method: "POST", body: JSON.stringify(body) });
  },
  getConversation(id: number) {
    return request<Conversation & { messages: StoredMessage[] }>(`/me/conversations/${id}`);
  },
  patchConversation(id: number, body: { title?: string; model_key?: string; pinned?: boolean }) {
    return request<Conversation>(`/me/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  },
  deleteConversation(id: number) {
    return request<void>(`/me/conversations/${id}`, { method: "DELETE" });
  },
  appendMessages(id: number, messages: { role: string; content: string }[]) {
    return request<{ ok: boolean; added: number }>(`/me/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ messages }) });
  },
};

export { ApiError };
