/** Agent Loop：带工具调用的多轮循环
 *
 * 流程：messages + tools → 模型 → 若返回 tool_calls 则执行工具、结果塞回 → 再问模型
 * 循环直到模型不再要求调用工具，输出最终回答。
 */
import { tokenStore, API_BASE } from "./api";
import type { ChatMessage } from "./chat";
import type { ToolDef } from "./tools";
import { DANGEROUS_TOOLS } from "./tools";

export interface ToolCallEvent {
  id: string;
  name: string;
  args: any;
  status: "pending" | "approved" | "rejected" | "running" | "done" | "error";
  result?: string;
}

export interface AgentCallbacks {
  onText: (fullText: string) => void;          // 最终回答（流式累加）
  onToolCall: (ev: ToolCallEvent) => void;     // 新工具调用出现
  onToolUpdate: (ev: ToolCallEvent) => void;   // 工具状态/结果更新
  onDone: (usage?: { total_tokens?: number }) => void;
  onError: (msg: string) => void;
  // 高危工具审批：返回 true=允许
  requireApproval: (ev: ToolCallEvent) => Promise<boolean>;
}

const MAX_ROUNDS = 8;

async function callModel(
  model: string,
  messages: any[],
  tools: any[],
  signal?: AbortSignal,
  temperature?: number,
): Promise<any> {
  const body: any = { model, messages, stream: false };
  if (tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  if (temperature != null) body.temperature = temperature;

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
  return res.json();
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
  if (options?.system_prompt) messages.push({ role: "system", content: options.system_prompt });
  messages.push(...initialMessages);

  let totalTokens = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await callModel(model, messages, tools, signal, options?.temperature);
      totalTokens += resp?.usage?.total_tokens || 0;
      const choice = resp?.choices?.[0];
      const msg = choice?.message;
      if (!msg) throw new Error("模型无响应");

      const toolCalls = msg.tool_calls;
      // 没有工具调用 → 最终回答
      if (!toolCalls || toolCalls.length === 0) {
        cb.onText(msg.content || "");
        cb.onDone({ total_tokens: totalTokens });
        return;
      }

      // 有工具调用：先把 assistant 消息（含 tool_calls）加入历史
      messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });

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
          ev.result = `未知工具：${name}`;
          cb.onToolUpdate({ ...ev });
          messages.push({ role: "tool", tool_call_id: tc.id, content: ev.result });
          continue;
        }

        // 高危工具审批
        if (DANGEROUS_TOOLS.has(name)) {
          const ok = await cb.requireApproval(ev);
          if (!ok) {
            ev.status = "rejected";
            ev.result = "用户拒绝执行该操作";
            cb.onToolUpdate({ ...ev });
            messages.push({ role: "tool", tool_call_id: tc.id, content: ev.result });
            continue;
          }
          ev.status = "approved";
          cb.onToolUpdate({ ...ev });
        }

        // 执行
        ev.status = "running";
        cb.onToolUpdate({ ...ev });
        try {
          const result = await tool.execute(args);
          ev.status = "done";
          ev.result = result;
        } catch (e: any) {
          ev.status = "error";
          ev.result = `执行失败：${e?.message || e}`;
        }
        cb.onToolUpdate({ ...ev });
        messages.push({ role: "tool", tool_call_id: tc.id, content: ev.result || "" });
      }
      // 继续下一轮，让模型基于工具结果回答
    }
    // 超过最大轮数
    cb.onText("（已达到最大工具调用轮数，任务可能未完成）");
    cb.onDone({ total_tokens: totalTokens });
  } catch (e: any) {
    if (e?.name === "AbortError") cb.onDone({ total_tokens: totalTokens });
    else cb.onError(e?.message || "Agent 执行出错");
  }
}
