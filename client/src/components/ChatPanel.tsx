import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { streamChat } from "../lib/chat";
import { useAuth } from "../lib/store";
import { useChat } from "../lib/chatStore";
import { useSettings } from "../lib/settingsStore";

interface Attach {
  id: string;
  name: string;
  size: number;
  text?: string;       // 文本/代码文件内容（内联用）
  isBinary: boolean;   // 图片等模型不能读的
}

// 代码块：语言标签 + 复制 + 下载（覆盖 pre）
function CodeBlock({ children }: any) {
  // children 是 <code> 元素，从中取 className 和原始文本
  const codeEl: any = Array.isArray(children) ? children[0] : children;
  const codeProps = codeEl?.props || {};
  const className: string = codeProps.className || "";
  const lang = /language-(\w+)/.exec(className)?.[1] || "";
  const raw = extractText(codeProps.children).replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(raw); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  function download() {
    const blob = new Blob([raw], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `code-${Date.now()}.${lang || "txt"}`; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="code-wrap">
      <div className="code-bar">
        <span className="code-lang">{lang || "code"}</span>
        <span className="code-ops">
          <button onClick={copy}>{copied ? "✓ 已复制" : "复制"}</button>
          <button onClick={download}>下载</button>
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function extractText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node?.props?.children) return extractText(node.props.children);
  return "";
}

export function ChatPanel({ model }: { model: string | null }) {
  const { messages, setMessages, activeId, newConversation, persistRound, loadingMsgs } = useChat();
  const { settings } = useSettings();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attaches, setAttaches] = useState<Attach[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { loadMe } = useAuth();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 文件上传
  function pickFile() {
    const el = document.createElement("input");
    el.type = "file";
    el.multiple = true;
    el.accept = ".txt,.md,.py,.js,.ts,.jsx,.tsx,.json,.xml,.yaml,.yml,.toml,.ini,.cfg,.env,.css,.scss,.html,.sh,.bat,.ps1,.sql,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt,.vue,.svelte,.csv,.log,.diff,.patch,.gitignore,.dockerfile,.conf,.properties,.lock,.gradle,.mjs,.cjs,.mts,.cts,.proto,.graphql,.svg,.png,.jpg,.jpeg,.gif,.webp,.bmp,.ico";
    el.onchange = async () => {
      const files = Array.from(el.files || []);
      for (const f of files) {
        const isBin = f.type.startsWith("image/");
        if (isBin) {
          setAttaches((a) => [...a, { id: `f${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name: f.name, size: f.size, isBinary: true }]);
        } else if (f.size < 64_000) { // 64KB 限制
          try {
            const text = await f.text();
            setAttaches((a) => [...a, { id: `f${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name: f.name, size: f.size, text, isBinary: false }]);
          } catch {}
        }
      }
    };
    el.click();
  }

  function removeAttach(id: string) {
    setAttaches((a) => a.filter((x) => x.id !== id));
  }

  // 语音输入（Web Speech API）
  const [recording, setRecording] = useState(false);
  const recogRef = useRef<any>(null);

  function toggleVoice() {
    if (recording) {
      recogRef.current?.abort();
      setRecording(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("当前浏览器不支持语音输入"); return; }
    const r = new SR();
    r.lang = "zh-CN";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e: any) => {
      const t = e.results[0][0].transcript;
      setInput((prev) => (prev ? prev + t : t));
      setRecording(false);
    };
    r.onerror = () => setRecording(false);
    r.onend = () => setRecording(false);
    recogRef.current = r;
    setRecording(true);
    r.start();
  }

  // 构建完整 prompt（含附件内容）
  function buildHistory(userText: string, existingMessages: any[]) {
    let attachBlock = "";
    for (const a of attaches) {
      if (a.isBinary) {
        attachBlock += `\n[附件：${a.name}（图片，模型暂不能读取图片内容）]`;
      } else if (a.text) {
        attachBlock += `\n=== 文件：${a.name} ===\n${a.text}\n=== 文件结束 ===`;
      }
    }
    const fullUserContent = attachBlock ? `${userText}\n${attachBlock}` : userText;
    return [...existingMessages, { role: "user" as const, content: fullUserContent }].map(
      (m: any) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })
    );
  }

  const runStream = useCallback(
    async (history: { role: "user" | "assistant" | "system"; content: string }[], asstId: string, onFinal?: (text: string) => void) => {
      setBusy(true);
      const ac = new AbortController();
      abortRef.current = ac;
      let finalText = "";
      await streamChat(
        model!,
        history,
        {
          onDelta: (delta) => {
            finalText += delta;
            setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: m.content + delta } : m)));
          },
          onDone: () => {
            setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, streaming: false } : m)));
            setBusy(false);
            loadMe();
            if (finalText) onFinal?.(finalText);
          },
          onError: (msg) => {
            setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: `⚠️ ${msg}`, streaming: false, error: true } : m)));
            setBusy(false);
          },
        },
        ac.signal,
        { temperature: settings.temperature, system_prompt: settings.system_prompt }
      );
    },
    [model, setMessages, loadMe, settings]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attaches.length === 0) || busy || !model) return;
    let convId = activeId;
    if (!convId) {
      convId = await newConversation(model);
      if (!convId) return;
    }
    const userText = text || "请解释上传的文件";
    const history = buildHistory(userText, messages);
    const userMsg = { id: `u${Date.now()}`, role: "user" as const, content: userText, attaches: attaches.map((a) => ({ name: a.name, size: a.size, text: a.text, isBinary: a.isBinary })) };
    const asstId = `a${Date.now()}`;
    const asstMsg = { id: asstId, role: "assistant" as const, content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setInput("");
    setAttaches([]);

    await runStream(history, asstId, (finalText) => persistRound(userText, finalText));
  }, [input, attaches, busy, model, messages, activeId, newConversation, setMessages, persistRound, runStream]);

  const regenerate = useCallback(
    async (asstIndex: number) => {
      if (busy || !model) return;
      const priorMsgs = messages.slice(0, asstIndex);
      const history = priorMsgs.map((m) => ({ role: m.role, content: m.content }));
      const asstId = `a${Date.now()}`;
      const asstMsg = { id: asstId, role: "assistant" as const, content: "", streaming: true };
      setMessages(() => [...priorMsgs, asstMsg]);
      await runStream(history, asstId);
    },
    [busy, model, messages, setMessages, runStream]
  );

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const enterSends = settings.send_on_enter;
    if (e.key === "Enter") {
      if (enterSends && !e.shiftKey) { e.preventDefault(); send(); }
      else if (!enterSends && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    }
  }

  // auto-resize textarea (desktop)
  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  // 手机端：固定高度的 input，不支持拖拽
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {loadingMsgs ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">✨</div>
            <p>开始对话吧</p>
            <span>当前模型：{model || "未选择"}</span>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={m.id} className={`msg msg-${m.role}`}>
              <div className="msg-avatar">{m.role === "user" ? "你" : "AI"}</div>
              <div className="msg-body">
                {m.role === "assistant" ? (
                  <>
                    <div className={`msg-bubble msg-md${m.error ? " msg-err" : ""}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: CodeBlock }}>
                        {m.content || "…"}
                      </ReactMarkdown>
                      {m.streaming && <span className="cursor-blink">▋</span>}
                    </div>
                    {!m.streaming && m.content && (
                      <div className="msg-actions">
                        <CopyBtn text={m.content} />
                        <button className="msg-act-btn" disabled={busy} onClick={() => regenerate(i)} title="重新生成">↻ 重新生成</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="msg-userwrap">
                    <div className="msg-bubble msg-text">{m.content.split(/\n/).map((line, j) => <div key={j}>{line}</div>)}</div>
                    {m.attaches && m.attaches.length > 0 && (
                      <div className="msg-attaches">
                        {m.attaches.map((a, k) => (
                          a.isBinary ? (
                            <div key={k} className="msg-file-chip warn"><span>🖼</span> {a.name} <span className="dim">(图片，模型暂不能读图)</span></div>
                          ) : (
                            <details key={k} className="msg-file">
                              <summary><span>📄</span> {a.name} <span className="dim">{(a.size/1024).toFixed(1)}KB</span></summary>
                              <pre className="msg-file-body">{a.text}</pre>
                            </details>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="chat-input-bar">
        <div className="chat-input-inner">
          {attaches.length > 0 && (
            <div className="chat-attach-list">
              {attaches.map((a) => (
                <div key={a.id} className={`chat-attach-chip${a.isBinary ? " warn" : ""}`}>
                  <span className="chip-icon">{a.isBinary ? "🖼" : "📄"}</span>
                  <span className="chip-name">{a.name}</span>
                  <span className="chip-meta">{(a.size / 1024).toFixed(1)}KB</span>
                  <button className="chip-x" onClick={() => removeAttach(a.id)}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <button className="chat-tool-btn" onClick={pickFile} title="上传文件" disabled={busy}>📎</button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={onInput}
              onKeyDown={onKeyDown}
              placeholder={model ? (settings.send_on_enter ? "输入消息，Enter 发送" : "输入消息，Ctrl+Enter 发送") : "请等待模型授权"}
              rows={isMobile ? 1 : undefined}
              disabled={!model || busy}
            />
            {isMobile && (
              <button className={`chat-tool-btn${recording ? " recording" : ""}`} onClick={toggleVoice} title="语音输入" disabled={busy}>🎤</button>
            )}
            {busy ? (
              <button className="chat-stop" onClick={stop}>停止</button>
            ) : (
              <button className="chat-send" onClick={send} disabled={(!input.trim() && attaches.length === 0) || !model}>发送</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return <button className="msg-act-btn" onClick={copy} title="复制">{copied ? "✓ 已复制" : "📋 复制"}</button>;
}

function MessagesSkeleton() {
  return (
    <div className="msg-skeleton">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`sk-row ${i % 2 ? "sk-right" : ""}`}>
          <div className="sk-avatar" />
          <div className="sk-lines">
            <div className="sk-line" style={{ width: "70%" }} />
            <div className="sk-line" style={{ width: "45%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}