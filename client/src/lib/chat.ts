/** 流式聊天：调用 /v1/chat/completions */
import { tokenStore, API_BASE } from "./api";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onDone: (usage?: { total_tokens?: number }) => void;
  onError: (msg: string) => void;
}

export async function streamChat(
  model: string,
  messages: ChatMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
  options?: { temperature?: number; system_prompt?: string },
): Promise<void> {
  let res: Response;
  const finalMessages = options?.system_prompt
    ? [{ role: "system" as const, content: options.system_prompt }, ...messages]
    : messages;
  const body: any = { model, messages: finalMessages, stream: true };
  if (options?.temperature != null) body.temperature = options.temperature;
  try {
    res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenStore.access}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    cb.onError(e?.name === "AbortError" ? "已停止" : "网络错误");
    return;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const code = data?.detail || data?.error?.code || "";
    const map: Record<string, string> = {
      insufficient_credits: "积分不足，请联系管理员充值",
      model_not_authorized: "未授权该模型",
      upstream_error: "上游模型服务异常，请稍后重试",
    };
    cb.onError(map[code] || `请求失败 (${res.status})`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    cb.onError("无法读取响应流");
    return;
  }
  const decoder = new TextDecoder();
  let buf = "";
  let usage: { total_tokens?: number } | undefined;

  try {
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
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta?.content;
          if (delta) cb.onDelta(delta);
          if (obj?.usage) usage = obj.usage;
        } catch {
          /* ignore partial json */
        }
      }
    }
    cb.onDone(usage);
  } catch (e: any) {
    if (e?.name === "AbortError") cb.onDone(usage);
    else cb.onError("流式读取中断");
  }
}
