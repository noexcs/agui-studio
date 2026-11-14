/**
 * DeepSeek (OpenAI-compatible) → AG-UI SSE runner.
 *
 * This is the "real model" backend: a live chat-completions stream is mapped
 * into AG-UI events by deepseek-map.mjs, and tool calls are executed locally
 * (stub tools) so the client sees the full TOOL_CALL_* lifecycle and a second
 * model round with the tool results.
 *
 * Credentials: DEEPSEEK_API_KEY, or the key already configured for pi in
 * ~/.pi/agent/models.json (providers["deepseek-api"]). Never hard-coded.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDeepseekMapper } from "./deepseek-map.mjs";

const MODELS_FILE = join(homedir(), ".pi", "agent", "models.json");

function readPiProvider() {
  try {
    if (!existsSync(MODELS_FILE)) return null;
    const parsed = JSON.parse(readFileSync(MODELS_FILE, "utf8"));
    return parsed?.providers?.["deepseek-api"] ?? null;
  } catch {
    return null;
  }
}

export function deepseekConfig() {
  const provider = readPiProvider();
  const key = process.env.DEEPSEEK_API_KEY || provider?.apiKey || "";
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || provider?.baseUrl || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || provider?.models?.[0]?.id || "deepseek-flash";
  return { key, baseUrl, model, configured: Boolean(key) };
}

export function deepseekHealth() {
  const config = deepseekConfig();
  return { configured: config.configured, model: config.model, baseUrl: config.baseUrl };
}

/* ── stub tools: enough to exercise TOOL_CALL_* end-to-end ─────────── */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city.",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "City name" } },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for up-to-date information.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
];

function executeTool(name, rawArgs) {
  let args = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    /* keep empty args */
  }
  if (name === "get_weather") {
    return { city: args.city ?? "unknown", temp_c: 22, condition: "sunny", source: "stub-tool" };
  }
  if (name === "search_web") {
    return {
      query: args.query ?? "",
      results: [
        { title: "Stub result 1", url: "https://example.com/1" },
        { title: "Stub result 2", url: "https://example.com/2" },
      ],
    };
  }
  return { error: `unknown tool: ${name}` };
}

let activeController = null;

export function stopDeepseek() {
  activeController?.abort();
  activeController = null;
}

async function readSse(response, onChunk, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (signal.aborted) return;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      try {
        onChunk(JSON.parse(data));
      } catch {
        /* skip malformed upstream frame */
      }
    }
  }
}

export async function runDeepseek(res, body, runId, { openStream }) {
  const config = deepseekConfig();
  const meta = { threadId: body.threadId || `ds_${Date.now().toString(36)}`, runId };
  const stream = openStream(res, meta);
  const controller = new AbortController();
  activeController = controller;
  const zh = body.lang === "zh";
  const prompt = String(body.prompt || "").trim() || (zh ? "介绍一下你能做什么。" : "Introduce what you can do.");

  const send = (event) => stream.send(event);

  if (!config.configured) {
    send({ type: "RUN_STARTED", metadata: { provider: "deepseek", configured: false } });
    send({
      type: "RUN_ERROR",
      message: "DeepSeek is not configured: set DEEPSEEK_API_KEY or pi's deepseek-api provider.",
    });
    stream.close();
    return;
  }

  const messages = [
    {
      role: "system",
      content: zh
        ? "你是一个简洁的旅行助手。需要实时信息时调用工具；回答控制在三句话以内。"
        : "You are a concise travel assistant. Call tools when you need live information; keep answers under three sentences.",
    },
    { role: "user", content: prompt },
  ];

  send({
    type: "RUN_STARTED",
    metadata: {
      provider: "deepseek",
      model: config.model,
      traceId: `trace_${runId}`,
      baseUrl: config.baseUrl,
    },
  });

  try {
    for (let round = 0; round < 4; round += 1) {
      if (controller.signal.aborted) break;
      send({ type: "STEP_STARTED", stepName: round === 0 ? "model" : `model round ${round + 1}` });

      const mapper = createDeepseekMapper({
        threadId: meta.threadId,
        runId,
        idPrefix: `${runId.replace(/[^a-z0-9]/gi, "")}_${round}`,
      });
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: body.model || config.model,
          stream: true,
          stream_options: { include_usage: true },
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.4,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`DeepSeek ${response.status}: ${detail.slice(0, 300)}`);
      }

      await readSse(response, (chunk) => {
        for (const event of mapper.mapChunk(chunk)) send(event);
      }, controller.signal);

      for (const event of mapper.finish()) send(event);
      send({ type: "STEP_FINISHED", stepName: round === 0 ? "model" : `model round ${round + 1}` });
      if (controller.signal.aborted) break;

      const calls = mapper.toolCalls();
      if (!calls.length) break;

      messages.push({
        role: "assistant",
        content: mapper.text() || null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args || "{}" },
        })),
      });

      for (const call of calls) {
        send({ type: "STEP_STARTED", stepName: `tool:${call.name}` });
        const result = executeTool(call.name, call.args);
        send({
          type: "TOOL_CALL_RESULT",
          toolCallId: call.id,
          content: JSON.stringify(result),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
        send({ type: "STEP_FINISHED", stepName: `tool:${call.name}` });
      }
    }

    send({ type: "CUSTOM", name: "suggestions", value: zh ? ["再查一个城市", "给我打包清单", "改成两天行程"] : ["Check another city", "Give me a packing list", "Make it two days"] });
    send({ type: "RUN_FINISHED", outcome: { type: "success" } });
  } catch (error) {
    if (controller.signal.aborted) {
      // client stopped the run; the store already reflects "stopped"
    } else {
      send({ type: "RUN_ERROR", message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    activeController = null;
    stream.close();
  }
}
