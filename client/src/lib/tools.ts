import { api } from "./api";

// 统一工具抽象：schema 给模型，executor 负责执行
export interface ToolDef {
  schema: any; // OpenAI function tool schema
  source: "cloud" | "local"; // cloud=服务端执行；local=Tauri端执行
  // 执行器：cloud 工具调服务端；local 工具调 Tauri（Web 环境下不可用）
  execute: (args: any) => Promise<string>;
}

// 是否运行在 Tauri 桌面环境
export function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== "undefined" || typeof (window as any).__TAURI__ !== "undefined";
}

// ---------------- 云端工具 ----------------
// schema 从服务端拉，execute 统一走 /v1/tools/exec
async function execCloudTool(tool: string, args: any): Promise<string> {
  try {
    const r = await api.post("/v1/tools/exec", { tool, arguments: args });
    return r.ok ? r.result : `工具失败：${r.result}`;
  } catch (e: any) {
    return `工具调用异常：${e?.message || e}`;
  }
}

// ---------------- 本地工具（Tauri）----------------
// Web 环境下 execute 返回提示；Tauri 环境下 invoke Rust command
const LOCAL_TOOL_SCHEMAS: any[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取本地文件内容（仅桌面版可用）。",
      parameters: { type: "object", properties: { path: { type: "string", description: "文件绝对路径" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入本地文件（仅桌面版可用，覆盖需审批）。",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "列出本地目录下的文件和子目录（仅桌面版可用）。",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "精确编辑本地文件：把 old_text 唯一匹配的一处替换为 new_text（仅桌面版可用，需审批）。适合改文件局部，不必整文件覆盖。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          old_text: { type: "string", description: "要被替换的原文（需在文件中唯一）" },
          new_text: { type: "string", description: "替换后的新文本" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "按通配符查找文件路径（仅桌面版可用）。如 **/*.ts 找所有 ts 文件。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式，如 **/*.py" },
          base: { type: "string", description: "搜索起始目录，默认当前目录" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "在文件或目录中用正则搜索内容，返回 文件:行号:内容（仅桌面版可用）。自动跳过 node_modules/.git/target。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式" },
          path: { type: "string", description: "搜索的文件或目录，默认当前目录" },
          max_results: { type: "number", description: "最大结果数，默认 200" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "执行 shell 命令（仅桌面版可用，需审批）。",
      parameters: {
        type: "object",
        properties: { command: { type: "string" }, cwd: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

async function execLocalTool(tool: string, args: any): Promise<string> {
  if (!isTauri()) {
    return `[本地工具「${tool}」仅在桌面版可用，当前为网页版]`;
  }
  try {
    const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI_INTERNALS__?.invoke;
    // Tauri command 命名：tool_read_file 等（与 Rust 端对应）
    const result = await invoke(`tool_${tool}`, args);
    return String(result);
  } catch (e: any) {
    return `本地工具执行失败：${e?.message || e}`;
  }
}

// ---------------- 插件系统（热插拔）----------------
// 插件存于 ~/.yt/plugins/<名>/plugin.json，声明 name/description/parameters/command/dangerous
// 启动时拉清单 → 动态注册为工具 → Agent 立即拥有新能力（零编译）
interface PluginManifest {
  name: string;
  description?: string;
  parameters?: any;
  dangerous?: boolean;
}

let pluginManifests: PluginManifest[] = [];

function invokeTauri(cmd: string, args: any): Promise<any> {
  const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI_INTERNALS__?.invoke;
  return invoke(cmd, args);
}

// 拉取本地插件清单（仅桌面版）
export async function loadPluginManifests(): Promise<void> {
  if (!isTauri()) { pluginManifests = []; return; }
  try {
    const raw = await invokeTauri("tool_plugin_list", {});
    const arr = JSON.parse(String(raw));
    pluginManifests = Array.isArray(arr)
      ? arr.filter((p: any) => p && typeof p.name === "string")
      : [];
  } catch {
    pluginManifests = [];
  }
}

// 获取插件目录路径（提示用）
export async function getPluginDir(): Promise<string> {
  if (!isTauri()) return "";
  try { return String(await invokeTauri("tool_plugin_dir", {})); } catch { return ""; }
}

// 当前插件数
export function pluginCount(): number { return pluginManifests.length; }

// 插件执行器：统一走 tool_plugin_exec
async function execPlugin(name: string, args: any): Promise<string> {
  if (!isTauri()) {
    return `[插件「${name}」仅在桌面版可用]`;
  }
  try {
    const result = await invokeTauri("tool_plugin_exec", { name, args });
    return String(result);
  } catch (e: any) {
    return `插件执行失败：${e?.message || e}`;
  }
}

// ---------------- 工具注册表 ----------------
let cloudSchemas: any[] = [];

export async function loadCloudSchemas(): Promise<void> {
  try {
    const r = await api.get("/v1/tools/schemas");
    cloudSchemas = r.tools || [];
  } catch {
    cloudSchemas = [];
  }
}

// 插件高危集合（动态，根据 manifest.dangerous）
const dangerousPlugins = new Set<string>();

// 构建当前环境可用的工具表
export function buildToolRegistry(enableLocal: boolean): Map<string, ToolDef> {
  const reg = new Map<string, ToolDef>();
  for (const s of cloudSchemas) {
    const name = s.function.name;
    reg.set(name, { schema: s, source: "cloud", execute: (args) => execCloudTool(name, args) });
  }
  // 本地工具 + 插件：仅在桌面版或显式开启时注入
  if (enableLocal && isTauri()) {
    for (const s of LOCAL_TOOL_SCHEMAS) {
      const name = s.function.name;
      reg.set(name, { schema: s, source: "local", execute: (args) => execLocalTool(name, args) });
    }
    // 动态注册插件为工具
    dangerousPlugins.clear();
    for (const m of pluginManifests) {
      const name = m.name;
      if (reg.has(name)) continue; // 不覆盖内置/云端同名工具
      if (m.dangerous) dangerousPlugins.add(name);
      const schema = {
        type: "function",
        function: {
          name,
          description: (m.description || `插件 ${name}`) + "（本地插件）",
          parameters: m.parameters || { type: "object", properties: {} },
        },
      };
      reg.set(name, { schema, source: "local", execute: (args) => execPlugin(name, args) });
    }
  }
  return reg;
}

// 审批分级（v0.5.0）：
//   - 只读/查询：不审批（read_file/list_dir/glob/grep/web_search/web_fetch/calculate/read_skill/memory_search）
//   - 新增（不覆盖）：不审批 —— write_file 会在 Rust 端检测目标不存在时直接放行
//   - 修改/删除/执行：需审批（run_shell/edit_file、write_file 覆盖已有、插件声明的 dangerous）
// write_file 特殊：先探测目标是否存在，存在则审批，不存在放行（在 agent.ts 里处理，见 isDangerousDynamic）
const ALWAYS_DANGEROUS = new Set(["run_shell", "edit_file"]);
export function isDangerous(name: string): boolean {
  return ALWAYS_DANGEROUS.has(name) || dangerousPlugins.has(name);
}

// write_file 动态判定：目标已存在 → 覆盖 → 审批；不存在 → 新增 → 直接放行
export async function isDangerousDynamic(name: string, args: any): Promise<boolean> {
  if (isDangerous(name)) return true;
  if (name === "write_file" && isTauri()) {
    try {
      const exists = await invokeTauri("tool_path_exists", { path: args?.path || "" });
      return Boolean(exists);
    } catch { return true; /* 探测失败保守审批 */ }
  }
  return false;
}

// 兼容旧引用
export const DANGEROUS_TOOLS = ALWAYS_DANGEROUS;

export function toolSchemas(reg: Map<string, ToolDef>): any[] {
  return Array.from(reg.values()).map((t) => t.schema);
}
