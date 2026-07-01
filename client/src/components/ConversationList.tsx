import { useEffect, useState } from "react";
import { useChat } from "../lib/chatStore";
import { useDialog } from "../lib/dialog";

export function ConversationList({ model, onEnterChat }: { model: string | null; onEnterChat?: () => void }) {
  const {
    conversations, activeId, loadingConvs, loadConversations, newConversation,
    selectConversation, deleteConversation, renameConversation, togglePin,
  } = useChat();
  const dialog = useDialog();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => { loadConversations(); }, [loadConversations]);

  function startEdit(id: number, title: string) {
    setEditingId(id);
    setEditTitle(title);
  }
  async function commitEdit() {
    if (editingId && editTitle.trim()) {
      await renameConversation(editingId, editTitle.trim());
    }
    setEditingId(null);
  }

  async function onNew() {
    await newConversation(model);
    onEnterChat?.();
  }

  async function onSelect(id: number) {
    await selectConversation(id);
    onEnterChat?.();
  }

  async function onDelete(id: number, title: string) {
    const ok = await dialog.confirm({
      title: "删除对话",
      message: `确定删除对话「${title}」？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (ok) deleteConversation(id);
  }

  return (
    <div className="conv-list">
      <button className="conv-new" onClick={onNew}>
        + 新对话
      </button>
      <div className="conv-items">
        {loadingConvs && conversations.length === 0 ? (
          <div className="conv-skeleton">
            {[0, 1, 2, 3].map((i) => <div key={i} className="conv-sk-item" />)}
          </div>
        ) : conversations.length === 0 ? (
          <div className="conv-empty">暂无对话</div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => c.id !== activeId && onSelect(c.id)}
            >
              {c.pinned && <span className="conv-pin">📌</span>}
              {editingId === c.id ? (
                <input
                  className="conv-edit"
                  value={editTitle}
                  autoFocus
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="conv-title" title={c.title}>{c.title}</span>
              )}
              <span className="conv-ops" onClick={(e) => e.stopPropagation()}>
                <button title="置顶" onClick={() => togglePin(c.id)}>{c.pinned ? "↓" : "↑"}</button>
                <button title="重命名" onClick={() => startEdit(c.id, c.title)}>✎</button>
                <button title="删除" className="danger" onClick={() => onDelete(c.id, c.title)}>🗑</button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
