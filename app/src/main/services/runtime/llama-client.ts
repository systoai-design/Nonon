import type { ChatMessage, InferenceClient, InferenceRequest, InferenceResult, Locations } from "../../../shared/contracts";

const LOCAL: Locations = { ai: "local", files: "this-computer" };

export interface OpenAiCompatOptions {
  /** Sent as a bearer token. The runtime service generates one per launch; the shared dev server has none. */
  apiKey?: string;
  /** Called before every request; the runtime service uses it to wake an idle-unloaded server. */
  beforeRequest?: () => Promise<void>;
  /** Called after every request settles; the runtime service uses it to restart the idle timer. */
  afterRequest?: () => void;
  /** Resolves the base URL per request, because a restarted server gets a new port. */
  resolveBaseUrl?: () => string;
}

interface Timings {
  predicted_per_second?: number;
  predicted_n?: number;
  prompt_n?: number;
}

interface StreamChunk {
  choices?: { delta?: { content?: string | null }; message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  timings?: Timings;
}

/** llama-server's own OpenAI-compatible endpoint. `baseUrl` is the server root, e.g. http://127.0.0.1:18088. */
export function createOpenAiCompatClient(
  baseUrl: string,
  location: Locations = LOCAL,
  options: OpenAiCompatOptions = {},
): InferenceClient {
  const root = (url: string) => url.replace(/\/+$/, "").replace(/\/v1$/, "");

  return {
    location,
    async chat(req: InferenceRequest): Promise<InferenceResult> {
      try {
        await options.beforeRequest?.();
        return await run(root(options.resolveBaseUrl?.() ?? baseUrl), location, options.apiKey, req);
      } finally {
        options.afterRequest?.();
      }
    },
  };
}

/** Qwen3.5's chat template answers 500 when a system message is not first, so extras are folded into one leading message. */
export function systemFirst(messages: ChatMessage[]): ChatMessage[] {
  const system = messages.filter((m) => m.role === "system");
  if (system.length === 0 || (system.length === 1 && messages[0]?.role === "system")) return messages;
  const merged: ChatMessage = { role: "system", content: system.map((m) => m.content).join("\n\n") };
  return [merged, ...messages.filter((m) => m.role !== "system")];
}

async function run(
  base: string,
  location: Locations,
  apiKey: string | undefined,
  req: InferenceRequest,
): Promise<InferenceResult> {
  const stream = typeof req.onToken === "function";
  const body: Record<string, unknown> = {
    messages: systemFirst(req.messages),
    stream,
    // Qwen3.5 otherwise spends hundreds of tokens thinking before the first visible word.
    chat_template_kwargs: { enable_thinking: false },
    cache_prompt: true,
  };
  if (stream) body.stream_options = { include_usage: true };
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.jsonSchema) {
    body.response_format = { type: "json_schema", json_schema: { name: "out", schema: req.jsonSchema, strict: true } };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`The AI on this computer ran into a problem (error ${response.status}). ${detail}`.trim());
  }

  let text = "";
  let timings: Timings | undefined;
  let usage: StreamChunk["usage"];

  if (!stream) {
    const json = (await response.json()) as StreamChunk;
    text = json.choices?.[0]?.message?.content ?? "";
    timings = json.timings;
    usage = json.usage;
  } else {
    if (!response.body) throw new Error("The AI on this computer sent back nothing. Please try again.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const handle = (line: string) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(payload) as StreamChunk;
      } catch {
        return;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        req.onToken?.(delta);
      }
      if (chunk.timings) timings = chunk.timings;
      if (chunk.usage) usage = chunk.usage;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        handle(pending.slice(0, nl).trim());
        pending = pending.slice(nl + 1);
      }
    }
    handle(pending.trim());
  }

  const result: InferenceResult = { text, location };
  const promptTokens = usage?.prompt_tokens ?? timings?.prompt_n;
  const completionTokens = usage?.completion_tokens ?? timings?.predicted_n;
  if (promptTokens !== undefined) result.promptTokens = promptTokens;
  if (completionTokens !== undefined) result.completionTokens = completionTokens;
  if (timings?.predicted_per_second !== undefined) result.tokensPerSecond = timings.predicted_per_second;
  return result;
}
