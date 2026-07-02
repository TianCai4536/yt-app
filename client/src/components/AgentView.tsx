import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { runAgent, type ToolCallEvent } from "../lib/agent";
import { buildToolRegistry, loadCloudSchemas, loadPluginManifests, getPluginDir, pluginCount, isTauri } from "../lib/tools";
import { useAuth } from "../lib/store";
import { useSettings } from "../lib/settingsStore";
import { useDialog } from "../lib/dialog";

interface AgentMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ToolCallEvent[]; // 该轮 assistant 触发的工具调用
  running?: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  calculate: "🧮", web_search: "🔍", web_fetch: "🌐",
  read_file: "📄", write_file: "✍️", list_dir: "📁", run_shell: "⌨️",
  edit_file: "✏️", glob: "🔎", grep: "🔍",
};
const TOOL_NAMES: Record<string, string> = {
  calculate: "计算", web_search: "联网搜索", web_fetch: "网页抓取",
  read_file: "读文件", write_file: "写文件", list_dir: "列目录", run_shell: "执行命令",
  edit_file: "编辑文件", glob: "查找文件", grep: "搜索内容",
};

export function AgentView({ model }: { model: string | null }) {
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [enableLocal, setEnableLocal] = useState(isTauri());
  const [plugins, setPlugins] = useState(0);
  const [pluginPath, setPluginPath] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const { loadMe } = useAuth();
  const dialog = useDialog();

  useEffect(() => { loadCloudSchemas(); }, []);
  // 加载本地插件清单（仅桌面版）
  const reloadPlugins = useCallback(async () => {
    if (!isTauri()) return;
    await loadPluginManifests();
    setPlugins(pluginCount());
    setPluginPath(await getPluginDir());
  }, []);
  useEffect(() => { reloadPlugins(); }, [reloadPlugins]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !model) return;

    const userMsg: AgentMsg = { id: `u${Date.now()}`, role: "user", content: text };
    const asstId = `a${Date.now()}`;
    const asstMsg: AgentMsg = { id: asstId, role: "assistant", content: "", tools: [], running: true };
    const history = [...msgs, userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMsgs((prev) => [...prev, userMsg, asstMsg]);
    setInput("");
    setBusy(true);

    const registry = buildToolRegistry(enableLocal);
    const ac = new AbortController();
    abortRef.current = ac;

    function patchAsst(fn: (m: AgentMsg) => AgentMsg) {
      setMsgs((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)));
    }

    await runAgent(
      model,
      history as any,
      registry,
      {
        onText: (full) => patchAsst((m) => ({ ...m, content: full })),
        onToolCall: (ev) => patchAsst((m) => ({ ...m, tools: [...(m.tools || []), ev] })),
        onToolUpdate: (ev) =>
          patchAsst((m) => ({ ...m, tools: (m.tools || []).map((t) => (t.id === ev.id ? ev : t)) })),
        onDone: () => { patchAsst((m) => ({ ...m, running: false })); setBusy(false); loadMe(); },
        onError: (msg) => { patchAsst((m) => ({ ...m, content: m.content || `⚠️ ${msg}`, running: false })); setBusy(false); },
        requireApproval: async (ev) => {
          const argStr = JSON.stringify(ev.args, null, 2);
          return dialog.confirm({
            title: `⚠️ 高危操作需确认：${TOOL_NAMES[ev.name] || ev.name}`,
            message: `AI 请求执行：\n${argStr}\n\n是否允许？`,
            confirmText: "允许执行",
            danger: true,
          });
        },
      },
      ac.signal,
      { temperature: settings.temperature, system_prompt: settings.system_prompt },
    );
  }, [input, busy, model, msgs, enableLocal, settings, loadMe, dialog]);

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {msgs.length === 0 ? (
          <div className="chat-empty agent-empty">
            <div className="chat-empty-icon">🤖</div>
            <p>Agent 模式</p>
            <span>AI 可自主调用工具完成任务</span>
            <div className="agent-examples">
              <div className="agent-tools-avail">
                🧮 计算　🔍 联网搜索　🌐 网页抓取
                {isTauri() && "　📄 文件　🔎 搜索　✏️ 编辑　⌨️ 命令"}
                {isTauri() && plugins > 0 && `　🧩 ${plugins} 个插件`}
              </div>
              <div className="agent-eg" onClick={() => setInput("搜索一下今天有什么科技新闻，总结3条")}>
                💡 搜索今天的科技新闻并总结
              </div>
              <div className="agent-eg" onClick={() => setInput("帮我算 (1234 * 567 + 89) / 3 等于多少")}>
                💡 精确计算一个复杂表达式
              </div>
            </div>
          </div>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`msg msg-${m.role}`}>
              <div className="msg-avatar">{m.role === "user" ? "你" : "AI"}</div>
              <div className="msg-body">
                {m.role === "user" ? (
                  <div className="msg-bubble msg-text">{m.content}</div>
                ) : (
                  <>
                    {m.tools && m.tools.length > 0 && (
                      <div className="agent-tools">
                        {m.tools.map((t) => <ToolCard key={t.id} ev={t} />)}
                      </div>
                    )}
                    {(m.content || !m.running) && (
                      <div className="msg-bubble msg-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                          {m.content || "（无输出）"}
                        </ReactMarkdown>
                      </div>
                    )}
                    {m.running && !m.content && (m.tools?.length ? null : <div className="agent-thinking">思考中…</div>)}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="chat-input-bar">
        <div className="chat-input-inner">
          {isTauri() && (
            <label className="agent-local-toggle">
              <input type="checkbox" checked={enableLocal} onChange={(e) => setEnableLocal(e.target.checked)} />
              启用本地工具（文件/命令/插件）
              <span className="agent-plugin-info" title={pluginPath ? `插件目录：${pluginPath}` : ""}>
                {plugins > 0 ? `　🧩 ${plugins} 个插件` : ""}
              </span>
              <button type="button" className="agent-plugin-reload" onClick={(e) => { e.preventDefault(); reloadPlugins(); }} title="重新扫描插件目录（新增插件后点这里，无需重启）">
                ↻ 重载插件
              </button>
            </label>
          )}
          <div className="chat-input-row">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={model ? "描述一个任务，AI 会自主调用工具完成…" : "请等待模型授权"}
              disabled={!model || busy}
              rows={1}
            />
            {busy ? (
              <button className="chat-stop" onClick={stop}>停止</button>
            ) : (
              <button className="chat-send" onClick={send} disabled={!input.trim() || !model}>执行</button>
            )}
          </div>
          <div className="chat-input-hint">Agent 会多轮调用工具，每轮消耗积分</div>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ ev }: { ev: ToolCallEvent }) {
  const [open, setOpen] = useState(false);
  const icon = TOOL_ICONS[ev.name] || "🔧";
  const name = TOOL_NAMES[ev.name] || ev.name;
  const statusText: Record<string, string> = {
    pending: "等待中", approved: "已批准", rejected: "已拒绝",
    running: "执行中…", done: "完成", error: "出错",
  };
  const argPreview = Object.values(ev.args || {}).join(" ").slice(0, 60);
  return (
    <div className={`tool-card tool-${ev.status}`}>
      <div className="tool-card-head" onClick={() => setOpen(!open)}>
        <span className="tool-card-icon">{icon}</span>
        <span className="tool-card-name">{name}</span>
        <span className="tool-card-arg">{argPreview}</span>
        <span className={`tool-card-status st-${ev.status}`}>
          {ev.status === "running" && <span className="tool-spin" />}
          {statusText[ev.status] || ev.status}
        </span>
      </div>
      {open && (ev.result || ev.args) && (
        <div className="tool-card-body">
          <div className="tool-card-section">参数：<code>{JSON.stringify(ev.args)}</code></div>
          {ev.result && <div className="tool-card-section">结果：<pre>{ev.result}</pre></div>}
        </div>
      )}
    </div>
  );
}
