/* ─────────────────────────────────────────────────────────────────────
   Direct AG-UI endpoint support.

   Any service that accepts a standard RunAgentInput over HTTP and streams
   AG-UI events back (SSE) can drive the studio — no bridge, no pi, no custom
   backend contract. This module owns the request/response shapes only; the
   store reduces the events.
   ───────────────────────────────────────────────────────────────────── */
import type { BaseEvent, Entry } from "./events";
import { HttpAgentTransport } from "./transport";

export interface AgentEndpoint {
  url: string;
  headers?: Record<string, string>;
}

const URL_KEY = "agui.agent.url";
const HEADERS_KEY = "agui.agent.headers";

/** `?agui=<url>` (endpoint) wins for a session; otherwise the persisted endpoint. */
export function getAgentEndpoint(): AgentEndpoint | null {
  try {
    const param = new URLSearchParams(window.location.search).get("agui");
    const url = param || localStorage.getItem(URL_KEY);
    if (!url) return null;
    const raw = localStorage.getItem(HEADERS_KEY);
    const headers = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return { url: url.replace(/\/$/, ""), headers };
  } catch {
    return null;
  }
}

export function setAgentEndpoint(endpoint: AgentEndpoint | null) {
  try {
    if (!endpoint) {
      localStorage.removeItem(URL_KEY);
      localStorage.removeItem(HEADERS_KEY);
      return;
    }
    localStorage.setItem(URL_KEY, endpoint.url);
    if (endpoint.headers && Object.keys(endpoint.headers).length) {
      localStorage.setItem(HEADERS_KEY, JSON.stringify(endpoint.headers));
    } else {
      localStorage.removeItem(HEADERS_KEY);
    }
  } catch {
    /* private mode */
  }
}

export function newRunId(prefix = "run"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ── RunAgentInput messages from the normalized view model ─────────── */

export interface AgUiMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "developer";
  content?: string;
  toolCalls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  toolCallId?: string;
}

/**
 * Best-effort history projection. AG-UI only requires the messages array, so
 * everything else in our view model (reasoning/plan/interrupt/state) stays out
 * of the request. Tool entries are paired with a synthetic assistant tool-call
 * message, which is the shape every AG-UI agent expects.
 */
export function messagesFromEntries(entries: Entry[]): AgUiMessage[] {
  const messages: AgUiMessage[] = [];
  for (const entry of entries) {
    if (entry.kind === "user") {
      messages.push({ id: entry.id, role: "user", content: entry.text });
    } else if (entry.kind === "assistant") {
      messages.push({ id: entry.id, role: "assistant", content: entry.text });
    } else if (entry.kind === "tool") {
      messages.push({
        id: `${entry.id}_call`,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: entry.id,
            type: "function",
            function: { name: entry.name, arguments: entry.argsRaw || "{}" },
          },
        ],
      });
      messages.push({
        id: `${entry.id}_result`,
        role: "tool",
        toolCallId: entry.id,
        content:
          typeof entry.result === "string"
            ? entry.result
            : JSON.stringify(entry.result ?? (entry.error ? { error: entry.error } : {})),
      });
    }
  }
  return messages;
}

export interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: AgUiMessage[];
  tools: unknown[];
  context: unknown[];
  state: Record<string, unknown>;
  forwardedProps: Record<string, unknown>;
  resume?: { interruptId: string; status: "resolved" | "cancelled"; payload?: unknown }[];
}

export function buildAgentInput(options: {
  threadId: string;
  runId: string;
  entries: Entry[];
  state: Record<string, unknown>;
  token?: string;
}): RunAgentInput {
  return {
    threadId: options.threadId,
    runId: options.runId,
    messages: messagesFromEntries(options.entries),
    tools: [],
    context: [],
    state: options.state,
    forwardedProps: options.token ? { token: options.token } : {},
  };
}

export function buildResumeInput(options: {
  threadId: string;
  runId: string;
  state: Record<string, unknown>;
  decisions: { interruptId: string; approved: boolean; editedArgs?: Record<string, unknown> }[];
}): RunAgentInput {
  return {
    threadId: options.threadId,
    runId: options.runId,
    messages: [],
    tools: [],
    context: [],
    state: options.state,
    forwardedProps: {},
    resume: options.decisions.map((decision) => ({
      interruptId: decision.interruptId,
      status: decision.approved ? "resolved" : "cancelled",
      payload: decision.editedArgs ? { approved: decision.approved, editedArgs: decision.editedArgs } : { approved: decision.approved },
    })),
  };
}

/** POST a standard RunAgentInput and yield AG-UI events from the SSE stream. */
export async function* streamAgentRun(options: {
  endpoint: AgentEndpoint;
  input: RunAgentInput;
  signal?: AbortSignal;
}): AsyncGenerator<BaseEvent> {
  const transport = new HttpAgentTransport(options.endpoint);
  yield* transport.run(options.input as unknown as Record<string, unknown>, options.signal);
}
