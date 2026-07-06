// Agent 会话历史(v0.5.0)
// 桌面版：~/.yt/sessions/agent/<id>.json,Rust 端读写
// 网页版：localStorage 兜底(简化,不做多设备同步)
import { create } from "zustand";
import { isTauri } from "./tools";
import type { ToolCallEvent } from "./agent";

export interface AgentMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ToolCallEvent[];
  running?: boolean;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

export interface AgentSessionData {
  id: string;
  title: string;
  updated_at: string;
  messages: AgentMsg[];
}

const LS_KEY = "yt-agent-sessions"; // Web 版兜底

function invokeTauri(cmd: string, args: any): Promise<any> {
  const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI_INTERNALS__?.invoke;
  return invoke(cmd, args);
}

function genId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `agent-${stamp}-${rand}`;
}

// ---- 存储适配层 ----
async function storeList(): Promise<AgentSessionSummary[]> {
  if (isTauri()) {
    try {
      const raw = await invokeTauri("agent_session_list", {});
      return JSON.parse(String(raw));
    } catch { return []; }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const map: Record<string, AgentSessionData> = JSON.parse(raw);
    return Object.values(map)
      .map((s) => ({ id: s.id, title: s.title, updated_at: s.updated_at, message_count: s.messages.length }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch { return []; }
}

async function storeLoad(id: string): Promise<AgentSessionData | null> {
  if (isTauri()) {
    try {
      const raw = await invokeTauri("agent_session_load", { id });
      return JSON.parse(String(raw));
    } catch { return null; }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const map: Record<string, AgentSessionData> = JSON.parse(raw);
    return map[id] || null;
  } catch { return null; }
}

async function storeSave(data: AgentSessionData): Promise<void> {
  if (isTauri()) {
    try { await invokeTauri("agent_session_save", { id: data.id, data: JSON.stringify(data) }); } catch {}
    return;
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    const map: Record<string, AgentSessionData> = raw ? JSON.parse(raw) : {};
    map[data.id] = data;
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {}
}

async function storeDelete(id: string): Promise<void> {
  if (isTauri()) {
    try { await invokeTauri("agent_session_delete", { id }); } catch {}
    return;
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const map: Record<string, AgentSessionData> = JSON.parse(raw);
    delete map[id];
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {}
}

// ---- Zustand store ----
interface State {
  sessions: AgentSessionSummary[];
  activeId: string | null;
  messages: AgentMsg[];
  loading: boolean;

  loadList(): Promise<void>;
  newSession(): Promise<string>;
  selectSession(id: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  setMessages(m: AgentMsg[] | ((prev: AgentMsg[]) => AgentMsg[])): void;
  // 每轮结束后调用：把当前消息持久化到活动会话
  persist(): Promise<void>;
}

// 用消息首字取标题（20 字内）
function autoTitle(msgs: AgentMsg[]): string {
  const first = msgs.find((m) => m.role === "user" && m.content.trim());
  if (!first) return "新会话";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 20 ? t.slice(0, 20) + "…" : t;
}

export const useAgentSessions = create<State>((set, get) => ({
  sessions: [],
  activeId: null,
  messages: [],
  loading: false,

  async loadList() {
    set({ loading: true });
    const items = await storeList();
    set({ sessions: items, loading: false });
  },

  async newSession() {
    const id = genId();
    const data: AgentSessionData = {
      id, title: "新会话",
      updated_at: new Date().toISOString(),
      messages: [],
    };
    await storeSave(data);
    set((s) => ({
      sessions: [{ id, title: data.title, updated_at: data.updated_at, message_count: 0 }, ...s.sessions],
      activeId: id,
      messages: [],
    }));
    return id;
  },

  async selectSession(id) {
    const data = await storeLoad(id);
    if (!data) return;
    set({ activeId: id, messages: data.messages });
  },

  async deleteSession(id) {
    await storeDelete(id);
    set((s) => {
      const rest = s.sessions.filter((x) => x.id !== id);
      const isActive = s.activeId === id;
      return {
        sessions: rest,
        activeId: isActive ? null : s.activeId,
        messages: isActive ? [] : s.messages,
      };
    });
  },

  async renameSession(id, title) {
    const data = await storeLoad(id);
    if (!data) return;
    data.title = title;
    data.updated_at = new Date().toISOString();
    await storeSave(data);
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title, updated_at: data.updated_at } : x)) }));
  },

  setMessages(m) {
    set((s) => ({ messages: typeof m === "function" ? (m as any)(s.messages) : m }));
  },

  async persist() {
    const { activeId, messages } = get();
    if (!activeId) return;
    const title = autoTitle(messages);
    const data: AgentSessionData = {
      id: activeId,
      title,
      updated_at: new Date().toISOString(),
      messages,
    };
    await storeSave(data);
    set((s) => ({
      sessions: [
        { id: activeId, title, updated_at: data.updated_at, message_count: messages.length },
        ...s.sessions.filter((x) => x.id !== activeId),
      ],
    }));
  },
}));
