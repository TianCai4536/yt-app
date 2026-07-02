/** 本地记忆系统（对标 OpenClaw Memory）
 *
 * ~/.yt/memory/MEMORY.md：长期记忆（Agent 主动记录的偏好/事实/历史）
 * 每次对话前自动召回相关片段注入 system prompt；Agent 可用 memory_write 主动记事、memory_search 检索。
 *
 * 纯前端 + Tauri 文件工具，免重新编译。关键词检索（后续可加向量）。
 */
function invokeTauri(cmd: string, args: any): Promise<any> {
  const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI_INTERNALS__?.invoke;
  return invoke(cmd, args);
}
function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== "undefined" || typeof (window as any).__TAURI__ !== "undefined";
}

async function memoryFile(): Promise<string> {
  const pdir = String(await invokeTauri("tool_plugin_dir", {}));
  const sep = pdir.includes("\\") ? "\\" : "/";
  const root = pdir.replace(/plugins[\\/]?$/, "memory");
  return [root.replace(/[\\/]+$/, ""), "MEMORY.md"].join(sep);
}

// 读取全部记忆条目（按行/段）
async function readMemory(): Promise<string> {
  if (!isTauri()) return "";
  try {
    return String(await invokeTauri("tool_read_file", { path: await memoryFile() }));
  } catch {
    return ""; // 文件不存在
  }
}

// 把记忆按"条目"切分（以 - 或 ## 或空行分隔的块）
function splitEntries(md: string): string[] {
  return md
    .split(/\n(?=[-*#]|\d+\.)/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("<!--") && !s.startsWith("#"));
}

// 关键词相关性打分（简单 BM25 近似：命中词数 + 覆盖度）
function score(entry: string, terms: string[]): number {
  const low = entry.toLowerCase();
  let hits = 0;
  for (const t of terms) if (t && low.includes(t)) hits++;
  return hits;
}

// 分词：中文按 2-gram + 英文按空格
function tokenize(q: string): string[] {
  const low = q.toLowerCase();
  const terms = new Set<string>();
  // 英文/数字词
  for (const w of low.match(/[a-z0-9]+/g) || []) if (w.length >= 2) terms.add(w);
  // 中文 2-gram
  const cjk = low.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of cjk) {
    if (seg.length === 1) terms.add(seg);
    for (let i = 0; i < seg.length - 1; i++) terms.add(seg.slice(i, i + 2));
  }
  return [...terms];
}

// 检索：返回最相关的 N 条记忆
export async function searchMemory(query: string, topN = 5): Promise<string[]> {
  const md = await readMemory();
  if (!md.trim()) return [];
  const entries = splitEntries(md);
  const terms = tokenize(query);
  if (!terms.length) return [];
  const ranked = entries
    .map((e) => ({ e, s: score(e, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topN)
    .map((x) => x.e);
  return ranked;
}

// 生成注入 system prompt 的记忆召回段落
export async function buildMemoryRecall(query: string): Promise<string> {
  const hits = await searchMemory(query, 5);
  if (!hits.length) return "";
  return [
    "【相关记忆】以下是你之前记录的、可能与本次对话相关的信息（来自本地长期记忆）：",
    ...hits.map((h) => h.replace(/^[-*]\s*/, "• ")),
    "（如与当前对话无关可忽略。）",
  ].join("\n");
}

// 追加一条记忆
export async function appendMemory(text: string): Promise<string> {
  if (!isTauri()) return "[记忆仅在桌面版可用]";
  const file = await memoryFile();
  const cur = await readMemory();
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `- (${stamp}) ${text.trim()}`;
  const next = cur.trim()
    ? `${cur.trim()}\n${line}\n`
    : `# MEMORY — 本地长期记忆\n\n${line}\n`;
  try {
    await invokeTauri("tool_write_file", { path: file, content: next });
    return "已记住。";
  } catch (e: any) {
    return `记忆写入失败：${e?.message || e}`;
  }
}

// ---------------- 工具 schema ----------------
export const MEMORY_WRITE_SCHEMA = {
  type: "function",
  function: {
    name: "memory_write",
    description: "把值得长期记住的信息（用户偏好、重要事实、约定、决定）写入本地长期记忆。当用户说'记住…'或出现重要信息时使用。",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "要记住的一条信息，简洁清晰" } },
      required: ["text"],
    },
  },
};

export const MEMORY_SEARCH_SCHEMA = {
  type: "function",
  function: {
    name: "memory_search",
    description: "检索本地长期记忆，回忆之前记录的信息。当需要回忆用户偏好、历史、约定时使用。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "检索关键词或问题" } },
      required: ["query"],
    },
  },
};

export async function execMemoryWrite(args: any): Promise<string> {
  return appendMemory(String(args?.text || ""));
}
export async function execMemorySearch(args: any): Promise<string> {
  const hits = await searchMemory(String(args?.query || ""), 8);
  return hits.length ? hits.join("\n") : "（没有找到相关记忆）";
}

// 记忆条数（展示用）
export async function memoryCount(): Promise<number> {
  const md = await readMemory();
  return md.trim() ? splitEntries(md).length : 0;
}
