import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { runAgent, type ToolCallEvent } from "../lib/agent";
import { buildToolRegistry, loadCloudSchemas, loadPluginManifests, getPluginDir, pluginCount, isTauri } from "../lib/tools";
import { loadSkills, skillCount, buildSkillsPrompt, READ_SKILL_SCHEMA, execReadSkill } from "../lib/skills";
import { buildMemoryRecall, MEMORY_WRITE_SCHEMA, MEMORY_SEARCH_SCHEMA, execMemoryWrite, execMemorySearch, memoryCount } from "../lib/memory";
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
  edit_file: "✏️", glob: "🔎", grep: "🔍", read_skill: "📘", memory_write: "📝", memory_search: "🧠",
};
const TOOL_NAMES: Record<string, string> = {
  calculate: "计算", web_search: "联网搜索", web_fetch: "网页抓取",
  read_file: "读文件", write_file: "写文件", list_dir: "列目录", run_shell: "执行命令",
  edit_file: "编辑文件", glob: "查找文件", grep: "搜索内容", read_skill: "读取技能", memory_write: "记忆", memory_search: "回忆",
};

export function AgentView({ model }: { model: string | null }) {
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [enableLocal, setEnableLocal] = useState(isTauri());
  const [plugins, setPlugins] = useState(0);
  const [pluginPath, setPluginPath] = useState("");
  const [skills, setSkills] = useState(0);
  const [memCount, setMemCount] = useState(0);
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
    await loadSkills();
    setSkills(skillCount());
    setMemCount(await memoryCount());
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
    // 技能系统：注册 read_skill 工具（仅桌面版且有技能时）
    if (enableLocal && isTauri() && skillCount() > 0) {
      registry.set("read_skill", { schema: READ_SKILL_SCHEMA, source: "local", execute: (a) => execReadSkill(a) });
    }
    // 记忆系统：注册 memory_write/search（仅桌面版）
    if (enableLocal && isTauri()) {
      registry.set("memory_write", { schema: MEMORY_WRITE_SCHEMA, source: "local", execute: (a) => execMemoryWrite(a) });
      registry.set("memory_search", { schema: MEMORY_SEARCH_SCHEMA, source: "local", execute: (a) => execMemorySearch(a) });
    }
    const ac = new AbortController();
    abortRef.current = ac;

    function patchAsst(fn: (m: AgentMsg) => AgentMsg) {
      setMsgs((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)));
    }

    // 记忆召回：基于本次输入检索相关记忆（仅桌面版）
    let memRecall = "";
    if (enableLocal && isTauri()) {
      try { memRecall = await buildMemoryRecall(text); } catch { /* ignore */ }
    }

    await runAgent(
      model,
      history as any,
      registry,
      {
        onText: (full) => patchAsst((m) => ({ ...m, content: m.content ? m.content : full })),
        onTextDelta: (delta) => patchAsst((m) => ({ ...m, content: (m.content || "") + delta })),
        onToolCall: (ev) => patchAsst((m) => ({ ...m, tools: [...(m.tools || []), ev] })),
        onToolUpdate: (ev) =>
          patchAsst((m) => ({ ...m, tools: (m.tools || []).map((t) => (t.id === ev.id ? ev : t)) })),
        onDone: () => { patchAsst((m) => ({ ...m, running: false })); setBusy(false); loadMe(); memoryCount().then(setMemCount); },
        onError: (msg) => { patchAsst((m) => ({ ...m, content: m.content || `⚠️ ${msg}`, running: false })); setBusy(false); },
        requireApproval: async (ev) => {
          // 只展示主要内容：每个参数值过长截断，避免弹窗被擑爆
          const brief = summarizeArgs(ev.args);
          return dialog.confirm({
            title: `⚠️ 高危操作需确认：${TOOL_NAMES[ev.name] || ev.name}`,
            message: `AI 请求执行：\n${brief}\n\n是否允许？`,
            confirmText: "允许执行",
            danger: true,
          });
        },
      },
      ac.signal,
      { temperature: settings.temperature, system_prompt: [settings.system_prompt, buildSkillsPrompt(), memRecall].filter(Boolean).join("\n\n") },
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
                {isTauri() && skills > 0 && `　📘 ${skills} 个技能`}
                {isTauri() && memCount > 0 && `　🧠 ${memCount} 条记忆`}
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
                {plugins > 0 ? `　🧩 ${plugins}` : ""}{skills > 0 ? `　📘 ${skills}` : ""}
              </span>
              <button type="button" className="agent-plugin-reload" onClick={(e) => { e.preventDefault(); reloadPlugins(); }} title="重新扫描插件/技能目录（新增后点这里，无需重启）">
                ↻ 重载
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

// 审批弹窗参数摘要：每个值过长截断，总长限制，保证弹窗不被擑爆
function summarizeArgs(args: any): string {
  if (!args || typeof args !== "object") return String(args ?? "");
  const PER_VALUE_MAX = 300; // 单个参数值最多显示字符
  const TOTAL_MAX = 800;     // 总摘要最多字符
  const lines: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    let val = typeof v === "string" ? v : JSON.stringify(v);
    val = val ?? "";
    const total = val.length;
    if (total > PER_VALUE_MAX) {
      val = val.slice(0, PER_VALUE_MAX) + `…（共 ${total} 字，已折叠）`;
    }
    lines.push(`• ${k}：${val}`);
  }
  let out = lines.join("\n");
  if (out.length > TOTAL_MAX) out = out.slice(0, TOTAL_MAX) + "\n…（内容较多，仅显示主要部分）";
  return out || "（无参数）";
}

function ToolCard({ ev }: { ev: ToolCallEvent }) {  const [open, setOpen] = useState(false);
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
