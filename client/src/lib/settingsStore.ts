import { create } from "zustand";
import { api, type UserSettings } from "./api";

interface SettingsState {
  settings: UserSettings;
  loaded: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<UserSettings>) => Promise<void>;
}

const DEFAULTS: UserSettings = {
  default_model: null,
  temperature: 0.7,
  system_prompt: "",
  send_on_enter: true,
  theme: "dark",
};

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,
  async load() {
    try {
      const s = await api.getSettings();
      set({ settings: { ...DEFAULTS, ...s }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async save(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      await api.saveSettings(patch);
    } catch {
      /* ignore */
    }
  },
}));
