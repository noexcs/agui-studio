/* ─────────────────────────────────────────────────────────────────────
   AG-UI protocol primitives: event types, JSON Patch, event scheduling.
   Zero React. Zero styling. Anything here can be swapped for a real
   @ag-ui/client transport without touching a single skin.
   ───────────────────────────────────────────────────────────────────── */

export const EventType = {
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  STEP_STARTED: "STEP_STARTED",
  STEP_FINISHED: "STEP_FINISHED",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  TEXT_MESSAGE_CHUNK: "TEXT_MESSAGE_CHUNK",
  TOOL_CALL_START: "TOOL_CALL_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",
  TOOL_CALL_RESULT: "TOOL_CALL_RESULT",
  TOOL_CALL_CHUNK: "TOOL_CALL_CHUNK",
  STATE_SNAPSHOT: "STATE_SNAPSHOT",
  STATE_DELTA: "STATE_DELTA",
  MESSAGES_SNAPSHOT: "MESSAGES_SNAPSHOT",
  ACTIVITY_SNAPSHOT: "ACTIVITY_SNAPSHOT",
  ACTIVITY_DELTA: "ACTIVITY_DELTA",
  REASONING_START: "REASONING_START",
  REASONING_MESSAGE_START: "REASONING_MESSAGE_START",
  REASONING_MESSAGE_CONTENT: "REASONING_MESSAGE_CONTENT",
  REASONING_MESSAGE_CHUNK: "REASONING_MESSAGE_CHUNK",
  REASONING_MESSAGE_END: "REASONING_MESSAGE_END",
  REASONING_END: "REASONING_END",
  REASONING_ENCRYPTED_VALUE: "REASONING_ENCRYPTED_VALUE",
  SUBAGENT_STARTED: "SUBAGENT_STARTED",
  SUBAGENT_FINISHED: "SUBAGENT_FINISHED",
  SUBAGENT_ERROR: "SUBAGENT_ERROR",
  RAW: "RAW",
  CUSTOM: "CUSTOM",
} as const;

export type EventTypeName = (typeof EventType)[keyof typeof EventType];

export interface BaseEvent {
  type: EventTypeName;
  threadId?: string;
  runId?: string;
  timestamp?: string | number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "test"; path: string; value: unknown };

export interface TimedEvent {
  at: number;
  event: BaseEvent;
}

/* ── JSON Patch (RFC 6902), the subset AG-UI producers actually emit ── */
export function parsePointer(path: string): string[] {
  if (path === "") return [];
  return path
    .split("/")
    .slice(1)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getAt(doc: any, tokens: string[]): any {
  let node = doc;
  for (const t of tokens) {
    if (node == null) return undefined;
    node = node[t];
  }
  return node;
}

/** Apply JSON Patch in place. Returns the touched JSON pointers. */
export function applyPatch(doc: any, ops: JsonPatchOp[] | undefined): string[] {
  const touched: string[] = [];
  if (!ops) return touched;
  for (const op of ops) {
    const tokens = parsePointer(op.path);
    switch (op.op) {
      case "add": {
        const last = tokens[tokens.length - 1];
        const parent = getAt(doc, tokens.slice(0, -1));
        if (Array.isArray(parent) && last === "-") parent.push(op.value);
        else if (Array.isArray(parent)) parent.splice(Number(last), 0, op.value);
        else if (tokens.length === 0) throw new Error("cannot add to document root");
        else parent[last] = op.value;
        break;
      }
      case "replace": {
        if (tokens.length === 0) throw new Error("cannot replace document root");
        const parent = getAt(doc, tokens.slice(0, -1));
        parent[tokens[tokens.length - 1]] = op.value;
        break;
      }
      case "remove": {
        if (tokens.length === 0) throw new Error("cannot remove document root");
        const parent = getAt(doc, tokens.slice(0, -1));
        const last = tokens[tokens.length - 1];
        if (Array.isArray(parent)) parent.splice(Number(last), 1);
        else delete parent[last];
        break;
      }
      case "test": {
        const current = getAt(doc, tokens);
        if (JSON.stringify(current) !== JSON.stringify(op.value)) {
          throw new Error("JSON Patch test failed at " + op.path);
        }
        break;
      }
    }
    touched.push(op.path);
  }
  return touched;
}

/* ── scheduler: replays a timed event list at a given speed ─────────── */
export interface PlayHandle {
  promise: Promise<{ cancelled: boolean }>;
  cancel: () => void;
}

export function play(
  events: TimedEvent[],
  onEvent: (event: BaseEvent, index: number) => void,
  options: { speed?: number; instant?: boolean } = {}
): PlayHandle {
  const speed = options.speed ?? 1;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let index = 0;

  const promise = new Promise<{ cancelled: boolean }>((resolve) => {
    if (options.instant) {
      for (let i = 0; i < events.length && !cancelled; i++) {
        onEvent(events[i].event, i + 1);
      }
      resolve({ cancelled });
      return;
    }
    const tick = () => {
      if (cancelled) return resolve({ cancelled: true });
      const item = events[index++];
      if (!item) return resolve({ cancelled: false });
      // never let one bad event kill the whole stream: a throwing handler used to
      // stop the setTimeout chain, which looked like the run "freezing" mid-answer
      try {
        onEvent(item.event, index);
      } catch (err) {
        console.error("[agui] event handler failed for", item.event.type, err);
      }
      const next = events[index];
      timer = setTimeout(tick, next ? Math.max(0, (next.at - item.at) / speed) : 0);
    };
    tick();
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export const estimateTokens = (text: string) => Math.round((text || "").length / 4);

export const formatDuration = (ms: number) => {
  if (!ms || ms < 0) return "0s";
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60_000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60_000) + "m " + Math.round((ms % 60_000) / 1000) + "s";
};
