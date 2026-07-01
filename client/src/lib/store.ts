import { create } from "zustand";
import { api, type MeResponse } from "./api";

interface AuthState {
  user: MeResponse | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  loadMe: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,

  async login(username, password) {
    set({ loading: true, error: null });
    try {
      await api.login(username, password);
      const me = await api.me();
      set({ user: me, loading: false });
      return true;
    } catch (e: any) {
      const msg = mapError(e?.code || e?.message);
      set({ loading: false, error: msg });
      return false;
    }
  },

  async loadMe() {
    if (!api.isLoggedIn()) return;
    set({ loading: true });
    try {
      const me = await api.me();
      set({ user: me, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  async logout() {
    await api.logout();
    set({ user: null });
  },
}));

function mapError(code: string): string {
  const map: Record<string, string> = {
    invalid_credentials: "用户名或密码错误",
    account_suspended: "账号已被停用，请联系管理员",
    account_expired: "账号已过期，请联系管理员",
    missing_token: "请先登录",
    invalid_token: "登录已失效，请重新登录",
  };
  return map[code] || "登录失败，请稍后重试";
}
