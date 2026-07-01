import { create } from "zustand";

export type Theme = "dark" | "light";

const KEY = "yt_theme";

function initial(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === "light" ? "light" : "dark";
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial(),
  setTheme(t) {
    localStorage.setItem(KEY, t);
    apply(t);
    set({ theme: t });
  },
  toggle() {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
}));

// 首次加载即应用
apply(initial());
