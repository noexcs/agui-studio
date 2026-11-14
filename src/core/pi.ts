/* ─────────────────────────────────────────────────────────────────────
   Browser side of the pi bridge (server/bridge.mjs).

   The bridge runs `pi --mode rpc` and translates its JSONL session events
   into AG-UI events. Here we only speak SSE + JSON.
   ───────────────────────────────────────────────────────────────────── */
import type { BaseEvent } from "./events";

export type PiBackend = "pi" | "fixture" | "deepseek" | "deepagent";

/** What the demo sends to pi when you hit replay. */
export const PI_PROMPT = "Review the four AG-UI skins and suggest one visual fix for each.";

export interface BridgeHealth {
  reachable: boolean;
  pi: boolean;
  version?: string;
  error?: string;
  deepseek?: { configured: boolean; model?: string; baseUrl?: string };
  deepagent?: { reachable: boolean; graphId?: string; deploymentUrl?: string };
}

export function bridgeUrl(): string {
  const param = new URLSearchParams(window.location.search).get("bridge");
  if (param) return param.replace(/\/$/, "");
  try {
    return (localStorage.getItem("agui.bridge") || "http://127.0.0.1:5179").replace(/\/$/, "");
  } catch {
    return "http://127.0.0.1:5179";
  }
}

export async function checkBridge(): Promise<BridgeHealth> {
  try {
    const res = await fetch(`${bridgeUrl()}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { reachable: false, pi: false, error: `bridge ${res.status}` };
    const data = await res.json();
    return { reachable: true, pi: !!data.pi, version: data.version, error: data.error, deepseek: data.deepseek, deepagent: data.deepagent };
  } catch (error) {
    return { reachable: false, pi: false, error: String((error as Error).message || error) };
  }
}

export async function streamPiRun(options: {
  backend: PiBackend;
  prompt: string;
  lang?: "en" | "zh";
  signal: AbortSignal;
  onEvent: (event: BaseEvent) => void;
}): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${bridgeUrl()}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: options.prompt,
      backend: options.backend,
      lang: options.lang,
      instant: new URLSearchParams(window.location.search).has("instant"),
    }),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new Error(`can't reach the bridge at ${bridgeUrl()} — start it with: node server/bridge.mjs`);
  }

  if (!res.ok) throw new Error(`pi bridge returned ${res.status}`);
  if (!res.body) throw new Error("pi bridge returned an empty stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames end with a blank line
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const event = JSON.parse(data) as BaseEvent;
        if (!event || typeof event.type !== "string") continue; // e.g. the `event: end` sentinel
        options.onEvent(event);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

export async function stopPiRun(): Promise<void> {
  try {
    await fetch(`${bridgeUrl()}/api/stop`, { method: "POST" });
  } catch {
    /* bridge may be gone */
  }
}

