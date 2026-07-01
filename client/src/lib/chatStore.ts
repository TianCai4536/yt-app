import { create } from "zustand";
import { api, type Conversation, type StoredMessage } from "./api";

export interface ChatMsg {
  id: number | string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  error?: boolean;
  attaches?: { name: string; size: number; text?: string; isBinary: boolean }[];
}

interface ChatState {
  conversations: Conversation[];
  activeId: number | null;
  messages: ChatMsg[];
  loadingConvs: boolean;
  loadingMsgs: boolean;

  loadConversations: () => Promise<void>;
  newConversation: (modelKey?: string | null) => Promise<number | null>;
  selectConversation: (id: number) => Promise<void>;
  deleteConversation: (id: number) => Promise<void>;
  renameConversation: (id: number, title: string) => Promise<void>;
  togglePin: (id: number) => Promise<void>;
  setMessages: (m: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => void;
  persistRound: (userText: string, assistantText: string) => Promise<void>;
  reset: () => void;
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  loadingConvs: false,
  loadingMsgs: false,

  async loadConversations() {
    set({ loadingConvs: true });
    try {
      const { items } = await api.listConversations();
      set({ conversations: items, loadingConvs: false });
    } catch {
      set({ loadingConvs: false });
    }
  },

  async newConversation(modelKey) {
    try {
      const c = await api.createConversation({ model_key: modelKey ?? undefined });
      set((s) => ({ conversations: [c, ...s.conversations], activeId: c.id, messages: [] }));
      return c.id;
    } catch {
      return null;
    }
  },

  async selectConversation(id) {
    set({ activeId: id, loadingMsgs: true, messages: [] });
    try {
      const detail = await api.getConversation(id);
      const msgs: ChatMsg[] = detail.messages.map((m: StoredMessage) => ({
        id: m.id, role: m.role, content: m.content,
      }));
      set({ messages: msgs, loadingMsgs: false });
    } catch {
      set({ loadingMsgs: false });
    }
  },

  async deleteConversation(id) {
    await api.deleteConversation(id);
    set((s) => {
      const rest = s.conversations.filter((c) => c.id !== id);
      const isActive = s.activeId === id;
      return {
        conversations: rest,
        activeId: isActive ? null : s.activeId,
        messages: isActive ? [] : s.messages,
      };
    });
  },

  async renameConversation(id, title) {
    await api.patchConversation(id, { title });
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) }));
  },

  async togglePin(id) {
    const c = get().conversations.find((x) => x.id === id);
    if (!c) return;
    await api.patchConversation(id, { pinned: !c.pinned });
    get().loadConversations();
  },

  setMessages(m) {
    set((s) => ({ messages: typeof m === "function" ? (m as any)(s.messages) : m }));
  },

  async persistRound(userText, assistantText) {
    const id = get().activeId;
    if (!id) return;
    try {
      await api.appendMessages(id, [
        { role: "user", content: userText },
        { role: "assistant", content: assistantText },
      ]);
      // 刷新标题/排序
      get().loadConversations();
    } catch {
      /* ignore */
    }
  },

  reset() {
    set({ conversations: [], activeId: null, messages: [], loadingConvs: false, loadingMsgs: false });
  },
}));
