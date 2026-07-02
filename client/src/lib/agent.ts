/** Agent Loop（流式版）：带工具调用的多轮循环 + 规划 + 失败自纠错
 *
 * 流程：messages + tools → 模型(流式) → 边出字边显示；若返回 tool_calls 则执行、结果塞回 → 再问
 * 循环直到模型不再要求调用工具，输出最终回答。
 *
 * M9 强化：
 *  - 流式输出：助手文字逐字显示（onTextDelta），工具调用分片拼接
 *  - 失败自纠错：工具报错不终止，错误结果塞回让模型自己重试/换法
 *  - 轮次预算软提示：接近上限时提示模型收敛
 */
import { tokenStore, API_BASE } from "./api";
import type { ChatMessage } from "./chat";
import type { ToolDef } from "./tools";
import { isDangerous } from "./tools";

export interface ToolCallEvent {
  id: string;
  name: string;
  args: any;
  status: "pending" | "approved" | "rejected" | "running" | "done" | "error";
  result?: string;
}

export interface AgentCallbacks {
  onText: (fullText: string) => void;          // 最终回答（全量，兼容旧用法）
  onTextDelta?: (delta: string, round: number) => void; // 流式增量（新）
  onToolCall: (ev: ToolCallEvent) => void;     // 新工具调用出现
  onToolUpdate: (ev: ToolCallEvent) => void;   // 工具状态/结果更新
  onRoundStart?: (round: number) => void;      // 新一轮开始（用于分隔思考/执行）
  onDone: (usage?: { total_tokens?: number }) => void;
  onError: (msg: string) => void;
  // 高危工具审批：返回 true=允许
  requireApproval: (ev: ToolCallEvent) => Promise<boolean>;
}

const MAX_ROUNDS = 16;

interface StreamResult {
  content: string;
  toolCalls: any[];
  usage?: { total_tokens?: number };
  finishReason?: string;
}

// 流式调用模型：累积文字（回调增量）+ 拼接分片 tool_calls
async function streamModel(
  model: string,
  messages: any[],
  tools: any[],
  onDelta: ((d: string) => void) | undefined,
  signal?: AbortSignal,
  temperature?: number,
): Promise<StreamResult> {
  const body: any = { model, messages, stream: true };
  if (tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  if (temperature != null) body.temperature = temperature;
  body.stream_options = { include_usage: true };

  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenStore.access}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const code = data?.detail || data?.error?.code || "";
    const map: Record<string, string> = {
      insufficient_credits: "积分不足，请联系管理员充值",
      model_not_authorized: "未授权该模型",
      upstream_error: "上游模型服务异常，请稍后重试",
    };
    throw new Error(map[code] || `请求失败 (${res.status})`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("无法读取响应流");

  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolMap = new Map<number, { id: string; name: string; args: string }>();
  let usage: { total_tokens?: number } | undefined;
  let finishReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      let obj: any;
      try { obj = JSON.parse(payload); } catch { continue; }
      if (obj?.usage) usage = obj.usage;
      const choice = obj?.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) { content += delta.content; onDelta?.(delta.content); }
      if (choice.finish_reason) finishReason = choice.finish_reason;
      // 拼接分片 tool_calls
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolMap.get(idx) || { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolMap.set(idx, cur);
        }
      }
    }
  }

  const toolCalls = Array.from(toolMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ id: v.id || `call_${Math.random().toString(36).slice(2)}`, type: "function", function: { name: v.name, arguments: v.args } }));

  return { content, toolCalls, usage, finishReason };
}

export async function runAgent(
  model: string,
  initialMessages: ChatMessage[],
  registry: Map<string, ToolDef>,
  cb: AgentCallbacks,
  signal?: AbortSignal,
  options?: { temperature?: number; system_prompt?: string },
): Promise<void> {
  const tools = Array.from(registry.values()).map((t) => t.schema);
  const messages: any[] = [];
  // 系统提示：拼上 Agent 行为准则（规划 + 自纠错引导）
  const agentGuide = buildAgentGuide(tools.length > 0);
  const sysParts = [options?.system_prompt, agentGuide].filter(Boolean);
  if (sysParts.length) messages.push({ role: "system", content: sysParts.join("\n\n") });
  messages.push(...initialMessages);

  let totalTokens = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      cb.onRoundStart?.(round);
      // 接近轮次上限：软提示模型尽快收敛
      if (round === MAX_ROUNDS - 2) {
        messages.push({ role: "system", content: "（提示：即将到达工具调用上限，请尽快用现有信息给出最终答案。）" });
      }

      const result = await streamModel(
        model, messages, tools,
        (d) => cb.onTextDelta?.(d, round),
        signal, options?.temperature,
      );
      totalTokens += result.usage?.total_tokens || 0;

      const toolCalls = result.toolCalls;
      // 没有工具调用 → 最终回答
      if (!toolCalls || toolCalls.length === 0) {
        cb.onText(result.content || "");
        cb.onDone({ total_tokens: totalTokens });
        return;
      }

      // 有工具调用：把 assistant 消息（含 tool_calls）加入历史
      messages.push({ role: "assistant", content: result.content || "", tool_calls: toolCalls });

      // 逐个执行工具
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
        const ev: ToolCallEvent = { id: tc.id, name, args, status: "pending" };
        cb.onToolCall(ev);

        const tool = registry.get(name);
        if (!tool) {
          ev.status = "error";
          ev.result = `未知工具：${name}。可用工具见工具列表，请换用已有工具或直接回答。`;
          cb.onToolUpdate({ ...ev });
          messages.push({ role: "tool", tool_call_id: tc.id, content: ev.result });
          continue;
        }

        // 高危工具审批
        if (isDangerous(name)) {
          const ok = await cb.requireApproval(ev);
          if (!ok) {
            ev.status = "rejected";
            ev.result = "用户拒绝执行该操作。请不要重试该操作，可换一种不需要该权限的方式，或询问用户。";
            cb.onToolUpdate({ ...ev });
            messages.push({ role: "tool", tool_call_id: tc.id, content: ev.result });
            continue;
          }
          ev.status = "approved";
          cb.onToolUpdate({ ...ev });
        }

        // 执行（失败自纠错：错误也塞回，让模型自己处理）
        ev.status = "running";
        cb.onToolUpdate({ ...ev });
        try {
          const result2 = await tool.execute(args);
          ev.status = "done";
          ev.result = result2;
        } catch (e: any) {
          ev.status = "error";
          ev.result = `执行失败：${e?.message || e}。请分析原因，修正参数后重试，或改用其他方法。`;
        }
        cb.onToolUpdate({ ...ev });
        messages.push({ role: "tool", tool_call_id: tc.id, content: ev.result || "" });
      }
      // 继续下一轮，让模型基于工具结果回答
    }
    // 超过最大轮数
    cb.onText("（已达到最大工具调用轮数，任务可能未完成。可以让我继续，或拆分任务。）");
    cb.onDone({ total_tokens: totalTokens });
  } catch (e: any) {
    if (e?.name === "AbortError") cb.onDone({ total_tokens: totalTokens });
    else cb.onError(e?.message || "Agent 执行出错");
  }
}

// Agent 行为准则：引导模型规划 + 自主判断 + 自纠错
function buildAgentGuide(hasTools: boolean): string {
  if (!hasTools) return "";
  return [
    "你是一个具备工具调用能力的智能助手。请遵循以下工作方式：",
    "1. 面对复杂任务，先在心里拆解步骤，按需逐步调用工具，不要一次堆砌。",
    "2. 优先用工具获取真实信息（读文件、搜索、执行命令等），不要凭空编造。",
    "3. 工具报错时，分析错误原因，修正参数或换用其他工具重试，不要直接放弃。",
    "4. 每步拿到结果后判断是否达成目标；达成即停止调用工具，给出清晰的最终回答。",
    "5. 涉及写文件、删除、执行命令等高危操作会请求用户批准，请只在必要时使用。",
  ].join("\n");
}
