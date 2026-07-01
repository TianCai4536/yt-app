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

// 构建当前环境可用的工具表
export function buildToolRegistry(enableLocal: boolean): Map<string, ToolDef> {
  const reg = new Map<string, ToolDef>();
  for (const s of cloudSchemas) {
    const name = s.function.name;
    reg.set(name, { schema: s, source: "cloud", execute: (args) => execCloudTool(name, args) });
  }
  // 本地工具：仅在桌面版或显式开启时注入
  if (enableLocal && isTauri()) {
    for (const s of LOCAL_TOOL_SCHEMAS) {
      const name = s.function.name;
      reg.set(name, { schema: s, source: "local", execute: (args) => execLocalTool(name, args) });
    }
  }
  return reg;
}

// 高危工具（需审批）
export const DANGEROUS_TOOLS = new Set(["write_file", "run_shell"]);

export function toolSchemas(reg: Map<string, ToolDef>): any[] {
  return Array.from(reg.values()).map((t) => t.schema);
}
