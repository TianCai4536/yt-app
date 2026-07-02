/** 技能系统（对标 OpenClaw Skills）
 *
 * ~/.yt/skills/<名>/SKILL.md：声明式技能（frontmatter: name/description + 正文步骤）
 * 启动时只扫描"名+描述"注入 system prompt（不占大上下文）；
 * Agent 判断任务匹配某技能 → 调 read_skill 工具读完整 SKILL.md → 照做。
 *
 * 纯前端实现：复用 Tauri 的 list_dir/read_file，免重新编译。
 * 首次启动把内置技能 seed 到 ~/.yt/skills。
 */
import { BUILTIN_SKILLS } from "./builtinSkills";

export interface SkillMeta {
  name: string;
  description: string;
  dir: string; // 技能目录绝对路径
}

let skills: SkillMeta[] = [];

function invokeTauri(cmd: string, args: any): Promise<any> {
  const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI_INTERNALS__?.invoke;
  return invoke(cmd, args);
}
function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== "undefined" || typeof (window as any).__TAURI__ !== "undefined";
}

// 由插件目录推导技能目录：<home>/.yt/plugins → <home>/.yt/skills
async function skillsRoot(): Promise<string> {
  const pdir = String(await invokeTauri("tool_plugin_dir", {}));
  // 兼容 Windows(\) 与 Unix(/)
  return pdir.replace(/plugins\/?$/, "skills").replace(/plugins\\?$/, "skills");
}

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

// 解析 SKILL.md 的 frontmatter（--- 包裹的 name/description）
function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: any = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*"?(.*?)"?\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

// 首次启动：把内置技能写入 ~/.yt/skills（已存在则跳过，不覆盖用户改动）
async function seedBuiltinSkills(root: string): Promise<void> {
  for (const sk of BUILTIN_SKILLS) {
    const dir = joinPath(root, sk.name);
    const file = joinPath(dir, "SKILL.md");
    try {
      // read_file 成功说明已存在，跳过
      await invokeTauri("tool_read_file", { path: file });
    } catch {
      // 不存在 → 写入
      try { await invokeTauri("tool_write_file", { path: file, content: sk.content }); } catch { /* ignore */ }
    }
  }
}

// 加载技能清单（仅桌面版）
export async function loadSkills(): Promise<void> {
  if (!isTauri()) { skills = []; return; }
  try {
    const root = await skillsRoot();
    await seedBuiltinSkills(root);
    const listing = String(await invokeTauri("tool_list_dir", { path: root }));
    const found: SkillMeta[] = [];
    for (const line of listing.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("[目录]")) continue;
      const name = t.replace("[目录]", "").trim();
      if (!name) continue;
      const dir = joinPath(root, name);
      try {
        const md = String(await invokeTauri("tool_read_file", { path: joinPath(dir, "SKILL.md") }));
        const fm = parseFrontmatter(md);
        found.push({ name: fm.name || name, description: fm.description || "(无描述)", dir });
      } catch { /* 没有 SKILL.md 的目录跳过 */ }
    }
    skills = found;
  } catch {
    skills = [];
  }
}

export function skillCount(): number { return skills.length; }
export function getSkills(): SkillMeta[] { return skills; }

// 生成注入 system prompt 的技能清单段落
export function buildSkillsPrompt(): string {
  if (!skills.length) return "";
  const lines = skills.map((s) => `- ${s.name}：${s.description}`);
  return [
    "你拥有以下【技能】（预设的标准作业流程）。当用户的任务与某技能匹配时，先调用 read_skill 工具读取该技能的完整步骤，再严格按步骤执行：",
    ...lines,
    "（技能只在需要时读取，不要无关调用。）",
  ].join("\n");
}

// read_skill 工具：读取指定技能的完整 SKILL.md
export const READ_SKILL_SCHEMA = {
  type: "function",
  function: {
    name: "read_skill",
    description: "读取一个技能的完整操作步骤（SKILL.md）。当任务匹配某个已列出的技能时，先用它读取详细流程。",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "技能名（技能清单里列出的名字）" } },
      required: ["name"],
    },
  },
};

export async function execReadSkill(args: any): Promise<string> {
  if (!isTauri()) return "[技能仅在桌面版可用]";
  const name = String(args?.name || "").trim();
  const sk = skills.find((s) => s.name === name) || skills.find((s) => s.dir.endsWith(name));
  if (!sk) return `未找到技能：${name}。可用技能：${skills.map((s) => s.name).join("、") || "（无）"}`;
  try {
    return String(await invokeTauri("tool_read_file", { path: joinPath(sk.dir, "SKILL.md") }));
  } catch (e: any) {
    return `读取技能失败：${e?.message || e}`;
  }
}

// 重新扫描（新增技能后调用，免重启）
export async function reloadSkills(): Promise<void> { await loadSkills(); }
