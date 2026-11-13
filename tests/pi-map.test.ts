import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPiMapper, stateSnapshotFromPi } from "../server/pi-map.mjs";

/* ── helpers ─────────────────────────────────────────────────────────── */

const THREAD = "thread_test";
const RUN = "run_test";
const newMapper = () => createPiMapper({ threadId: THREAD, runId: RUN });

// Anchor on the vitest working directory (the repo root for `pnpm test`).
// import.meta.url is unusable here: under the jsdom environment vitest feeds
// `new URL(..., import.meta.url)` a root-less file:///tests/... base, which
// resolves sibling paths against "/".
const repoPath = (...segments: string[]): string => {
  const resolved = join(process.cwd(), ...segments);
  if (!existsSync(resolved)) {
    throw new Error(`cannot locate ${segments.join("/")} from cwd ${process.cwd()} — run vitest from the repo root`);
  }
  return resolved;
};

const FIXTURE_PATH = repoPath("server", "fixtures", "pi-run.jsonl");
const FIXTURE_RECORDS: any[] = readFileSync(FIXTURE_PATH, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

/** Feed records through one fresh mapper, concatenating all emitted events. */
const mapAll = (records: any[]): any[] => {
  const mapper = newMapper();
  return records.flatMap((record) => mapper.map(record));
};

const eventTypes = (events: any[]): string[] => events.map((event) => event.type);
const repeat = (type: string, count: number): string[] => Array<string>(count).fill(type);
const update = (assistantMessageEvent: Record<string, unknown>): any => ({
  type: "message_update",
  assistantMessageEvent,
});

/* Recorded assistant output, assembled from the fixture's delta fragments. */
const THINKING_TEXT =
  "Four skins, one content model. I should read the shared renderers first, then look for places where a skin fights the protocol instead of expressing it.";
const REPLY_PART_1 =
  "Read all four skins. They share `ChatPage` and `useConversation()`, so the fixes stay inside one folder each.\n\n";
const REPLY_PART_2 =
  "### One fix per skin\n\n- **Aurora** — the inspector event list is 9.5px mono. Raise it to 10.5px and drop `+3.85s` to one decimal; it is the densest text on screen.\n" +
  "- **Paper** — margin notes truncate mid-word at 220 chars. Clip on a sentence bound instead, or let the rail scroll without decoration.\n" +
  "- **Terminal** — good. Filter deltas from the trace by default so `TOOL_CALL_*` and `STATE_*` stay legible.\n" +
  "- **Brutalist** — the hard shadow sits on every card; remove it from tool cards so approval keeps the loudest edge.\n";
const REPLY_PART_3 =
  "Want me to apply the Aurora and Brutalist changes now? Both are two-line CSS edits and do not touch the shared contract.";

/* ── run lifecycle ───────────────────────────────────────────────────── */

describe("createPiMapper: run lifecycle", () => {
  it("maps agent_start to RUN_STARTED stamped with thread and run ids", () => {
    const events = newMapper().map({ type: "agent_start" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "RUN_STARTED", threadId: THREAD, runId: RUN });
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("maps agent_settled to a trailing STEP_FINISHED plus RUN_FINISHED (success, or stopped when aborted)", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });

    const settled = mapper.map({ type: "agent_settled", aborted: false });
    expect(settled.map((e) => e.type)).toEqual(["STEP_FINISHED", "RUN_FINISHED"]);
    expect(settled[0].stepName).toBe("turn 1");
    expect(settled[1].outcome).toEqual({ type: "success" });

    const abortedMapper = newMapper();
    const aborted = abortedMapper.map({ type: "agent_settled", aborted: true });
    expect(aborted[1].outcome).toEqual({ type: "stopped" });
  });

  it("emits nothing for agent_end — RUN_FINISHED comes only from agent_settled", () => {
    expect(newMapper().map({ type: "agent_end", messages: [], willRetry: false })).toEqual([]);
  });
});

/* ── text lifecycle ──────────────────────────────────────────────────── */

describe("createPiMapper: text lifecycle", () => {
  it("maps a text block to TEXT_MESSAGE_START/CONTENT/END with one stable messageId and accumulating deltas", () => {
    const events = mapAll([
      { type: "turn_start" },
      update({ type: "text_start", contentIndex: 0 }),
      update({ type: "text_delta", contentIndex: 0, delta: "Hel" }),
      update({ type: "text_delta", contentIndex: 0, delta: "lo" }),
      update({ type: "text_end", contentIndex: 0 }),
    ]);

    expect(eventTypes(events)).toEqual([
      "STEP_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
    ]);
    const messageIds = events
      .filter((e) => e.type.startsWith("TEXT_MESSAGE_"))
      .map((e) => e.messageId);
    expect(new Set(messageIds)).toEqual(new Set(["pi_msg_1_text_0"]));
    expect(events[1].role).toBe("assistant");
    expect(
      events
        .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
        .map((e) => e.delta)
        .join("")
    ).toBe("Hello");
  });

  it("closes a text block the provider left open when the assistant message ends (exactly once)", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });
    const opened = mapper.map(update({ type: "text_start", contentIndex: 2 }));
    expect(opened.map((e) => e.type)).toEqual(["TEXT_MESSAGE_START"]);

    const messageEnd = mapper.map({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "stop" },
    });
    expect(messageEnd.map((e) => e.type)).toEqual(["TEXT_MESSAGE_END"]);
    expect(messageEnd[0].messageId).toBe("pi_msg_1_text_2");

    // the block is now closed: a second message_end emits nothing more
    expect(mapper.map({ type: "message_end", message: { role: "assistant" } })).toEqual([]);
  });
});

/* ── thinking / reasoning lifecycle ──────────────────────────────────── */

describe("createPiMapper: thinking lifecycle", () => {
  it("maps thinking to REASONING_* events whose ids never collide with text ids in the same turn", () => {
    const events = mapAll([
      { type: "turn_start" },
      update({ type: "thinking_start", contentIndex: 0 }),
      update({ type: "thinking_delta", contentIndex: 0, delta: "plan " }),
      update({ type: "thinking_delta", contentIndex: 0, delta: "more" }),
      update({ type: "thinking_end", contentIndex: 0 }),
      update({ type: "text_start", contentIndex: 1 }),
      update({ type: "text_delta", contentIndex: 1, delta: "answer" }),
      update({ type: "text_end", contentIndex: 1 }),
    ]);

    expect(eventTypes(events)).toEqual([
      "STEP_STARTED",
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
    ]);

    const reasoning = events.filter((e) => e.type.startsWith("REASONING_"));
    const text = events.filter((e) => e.type.startsWith("TEXT_MESSAGE_"));
    expect(new Set(reasoning.map((e) => e.messageId))).toEqual(new Set(["pi_msg_1_think_0"]));
    expect(new Set(text.map((e) => e.messageId))).toEqual(new Set(["pi_msg_1_text_1"]));
    expect(events[2].role).toBe("reasoning");
    expect(
      reasoning
        .filter((e) => e.type === "REASONING_MESSAGE_CONTENT")
        .map((e) => e.delta)
        .join("")
    ).toBe("plan more");
    expect(
      text
        .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
        .map((e) => e.delta)
        .join("")
    ).toBe("answer");
  });

  it("closes a thinking block left open at assistant message_end", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });
    mapper.map(update({ type: "thinking_start", contentIndex: 0 }));

    const messageEnd = mapper.map({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "thinking" }] },
    });
    expect(messageEnd.map((e) => e.type)).toEqual(["REASONING_MESSAGE_END", "REASONING_END"]);
    expect(messageEnd.every((e) => e.messageId === "pi_msg_1_think_0")).toBe(true);
  });
});

/* ── tool calls ──────────────────────────────────────────────────────── */

describe("createPiMapper: tool calls", () => {
  it("maps streamed toolcall updates to TOOL_CALL_START/ARGS/END and skips duplicates on tool_execution_start", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });

    const streamed = [
      ...mapper.map(update({ type: "toolcall_start", contentIndex: 2, id: "call_1", toolName: "read" })),
      ...mapper.map(update({ type: "toolcall_delta", contentIndex: 2, id: "call_1", delta: '{"path":' })),
      ...mapper.map(
        update({
          type: "toolcall_end",
          contentIndex: 2,
          toolCall: { id: "call_1", type: "function", function: { name: "read", arguments: '{"path":' } },
        })
      ),
    ];
    expect(eventTypes(streamed)).toEqual(["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
    expect(streamed.map((e) => e.toolCallId)).toEqual(["call_1", "call_1", "call_1"]);
    expect(streamed[0].toolCallName).toBe("read");
    expect(streamed[1].delta).toBe('{"path":');

    // pi then actually executes the streamed tool: no duplicate TOOL_CALL_*
    const executionStart = mapper.map({
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "read",
      args: { path: "src/x.ts" },
    });
    expect(eventTypes(executionStart)).toEqual(["STEP_STARTED"]);
    expect(executionStart[0].stepName).toBe("read");
  });

  it("synthesizes a full TOOL_CALL_* lifecycle for tools executed without a streamed toolcall", () => {
    const mapper = newMapper();
    const start = mapper.map({
      type: "tool_execution_start",
      toolCallId: "call_9",
      toolName: "bash",
      args: { cmd: "ls" },
    });
    expect(eventTypes(start)).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "STEP_STARTED",
    ]);
    expect(start[0]).toMatchObject({ toolCallId: "call_9", toolCallName: "bash" });
    expect(start[1].toolCallId).toBe("call_9");
    expect(start[1].delta).toBe(JSON.stringify({ cmd: "ls" }));
    expect(start[3].stepName).toBe("bash");

    const end = mapper.map({
      type: "tool_execution_end",
      toolCallId: "call_9",
      toolName: "bash",
      result: { ok: true },
    });
    expect(eventTypes(end)).toEqual(["TOOL_CALL_RESULT", "STEP_FINISHED"]);
    expect(end[0]).toMatchObject({
      messageId: "pi_tool_call_9",
      role: "tool",
      toolCallId: "call_9",
      content: JSON.stringify({ ok: true }),
    });
    expect(end[1].stepName).toBe("bash");
  });

  it("falls back to an error payload in TOOL_CALL_RESULT when a tool fails without a result", () => {
    const end = newMapper().map({
      type: "tool_execution_end",
      toolCallId: "call_x",
      toolName: "bash",
      isError: true,
    });
    expect(end[0].type).toBe("TOOL_CALL_RESULT");
    expect(JSON.parse(end[0].content)).toEqual({ error: "tool failed" });
  });

  it("maps tool_execution_update to a CUSTOM pi.tool_progress event", () => {
    const events = newMapper().map({
      type: "tool_execution_update",
      toolCallId: "call_1",
      toolName: "read",
      partialResult: { content: [{ type: "text", text: "…" }], details: {} },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("CUSTOM");
    expect(events[0].name).toBe("pi.tool_progress");
    expect(events[0].value).toEqual({
      toolCallId: "call_1",
      partialResult: { content: [{ type: "text", text: "…" }], details: {} },
    });
  });
});

/* ── messages, steps, errors, passthrough ────────────────────────────── */

describe("createPiMapper: messages, steps, errors, passthrough", () => {
  it("emits a CUSTOM pi.message_start for assistant messages with the current turn number, nothing for user messages", () => {
    const mapper = newMapper();
    expect(mapper.map({ type: "message_start", message: { role: "user", content: "hi" } })).toEqual([]);

    mapper.map({ type: "turn_start" });
    const first = mapper.map({ type: "message_start", message: { role: "assistant", content: [] } });
    expect(first).toHaveLength(1);
    expect(first[0].type).toBe("CUSTOM");
    expect(first[0].name).toBe("pi.message_start");
    expect(first[0].value).toEqual({ turn: 1 });

    mapper.map({ type: "turn_end" });
    mapper.map({ type: "turn_start" });
    const second = mapper.map({ type: "message_start", message: { role: "assistant", content: [] } });
    expect(second[0].value).toEqual({ turn: 2 });
  });

  it("numbers STEP_STARTED / STEP_FINISHED stepNames in order across turns", () => {
    const events = mapAll([
      { type: "turn_start" },
      { type: "turn_end" },
      { type: "turn_start" },
      { type: "turn_end" },
    ]);
    expect(eventTypes(events)).toEqual([
      "STEP_STARTED",
      "STEP_FINISHED",
      "STEP_STARTED",
      "STEP_FINISHED",
    ]);
    expect(events.map((e) => e.stepName)).toEqual(["turn 1", "turn 1", "turn 2", "turn 2"]);
  });

  it("reports usage as a CUSTOM event on assistant message_end (and via turn_end message usage)", () => {
    const mapper = newMapper();
    const messageEnd = mapper.map({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { input: 5, output: 2 } },
      usage: { input: 5, output: 2 },
    });
    expect(messageEnd.map((e) => e.type)).toEqual(["CUSTOM"]);
    expect(messageEnd[0].name).toBe("usage");
    expect(messageEnd[0].value).toEqual({ input: 5, output: 2 });

    const turnEnd = mapper.map({
      type: "turn_end",
      message: { role: "assistant", usage: { input: 9, output: 1 } },
    });
    expect(turnEnd.map((e) => e.type)).toEqual(["STEP_FINISHED", "CUSTOM"]);
    expect(turnEnd[1].value).toEqual({ input: 9, output: 1 });

    // no usage attached → no CUSTOM event
    expect(eventTypes(mapper.map({ type: "turn_end", message: { role: "assistant" } }))).toEqual(["STEP_FINISHED"]);
  });

  it("maps provider errors to RUN_ERROR", () => {
    const streamedError = newMapper().map(update({ type: "error", error: "provider exploded" }));
    expect(streamedError).toHaveLength(1);
    expect(streamedError[0].type).toBe("RUN_ERROR");
    expect(streamedError[0].message).toBe("provider exploded");

    const topLevel = newMapper().map({ type: "error", message: "pi died" });
    expect(topLevel[0].type).toBe("RUN_ERROR");
    expect(topLevel[0].message).toBe("pi died");
  });

  it("forwards retry / compaction / extension records as CUSTOM events", () => {
    const mapper = newMapper();
    const retry = mapper.map({ type: "auto_retry_start", attempt: 2 });
    expect(retry[0]).toMatchObject({ type: "CUSTOM", name: "pi.retry" });

    const compaction = mapper.map({ type: "compaction_end", result: { ok: true } });
    expect(compaction[0]).toMatchObject({ type: "CUSTOM", name: "pi.compaction", value: { ok: true } });

    const extension = mapper.map({ type: "extension_error", message: "boom" });
    expect(extension[0]).toMatchObject({ type: "CUSTOM", name: "pi.extension_error" });
  });

  it("ignores get_state, session and unknown/malformed object records without crashing", () => {
    const mapper = newMapper();
    expect(mapper.map({ type: "get_state" })).toEqual([]);
    expect(mapper.map({ type: "session", id: "sess_1", cwd: "/tmp" })).toEqual([]);
    expect(mapper.map({})).toEqual([]);
    expect(mapper.map({ type: "some_future_record", payload: { x: 1 } })).toEqual([]);
    expect(mapper.map({ type: "message_update" })).toEqual([]);
    expect(mapper.map({ type: "message_update", assistantMessageEvent: {} })).toEqual([]);
    expect(mapper.map({ type: "message_update", assistantMessageEvent: { type: "mystery" } })).toEqual([]);
    expect(mapper.map({ type: "message_end", message: { role: "user" } })).toEqual([]);
  });
});

/* ── stateSnapshotFromPi ─────────────────────────────────────────────── */

describe("stateSnapshotFromPi", () => {
  it("builds a STATE_SNAPSHOT with agent info, tools, thinking level, cwd and usage", () => {
    const snapshot = stateSnapshotFromPi(
      {
        name: "pi",
        model: "pi-coder",
        sessionId: "sess_42",
        tools: ["bash", "read"],
        thinkingLevel: "high",
        cwd: "/work",
        usage: { input: 10 },
      },
      { threadId: THREAD, runId: RUN }
    );

    expect(snapshot.type).toBe("STATE_SNAPSHOT");
    expect(snapshot.threadId).toBe(THREAD);
    expect(snapshot.runId).toBe(RUN);
    expect(snapshot.snapshot).toEqual({
      agent: { name: "pi", model: "pi-coder", sessionId: "sess_42" },
      tools: ["bash", "read"],
      thinking: "high",
      cwd: "/work",
      usage: { input: 10 },
    });
  });

  it("falls back to defaults (modelName / session.id aliases included) for missing fields and null state", () => {
    const aliased = stateSnapshotFromPi(
      { modelName: "gpt-x", session: { id: "sess_7" } },
      { threadId: THREAD, runId: RUN }
    );
    expect(aliased.snapshot).toMatchObject({
      agent: { name: "pi", model: "gpt-x", sessionId: "sess_7" },
    });

    const empty = stateSnapshotFromPi(null, { threadId: "thread_only", runId: RUN });
    expect(empty.type).toBe("STATE_SNAPSHOT");
    expect(empty.snapshot).toEqual({
      agent: { name: "pi", model: "pi agent", sessionId: "thread_only" },
      tools: [],
      thinking: "off",
      cwd: "",
      usage: {},
    });
  });
});

/* ── recorded fixture replay (real pi JSONL through the mapper) ─────── */

describe("createPiMapper: recorded fixture replay", () => {
  const events = mapAll(FIXTURE_RECORDS);
  const byType = (type: string) => events.filter((event) => event.type === type);
  const deltasOf = (type: string, messageId?: string) =>
    events
      .filter((e) => e.type === type && (messageId === undefined || e.messageId === messageId))
      .map((e) => e.delta)
      .join("");

  it("replays the recorded session into the exact expected AG-UI event sequence", () => {
    expect(eventTypes(events)).toEqual([
      "RUN_STARTED",
      "STEP_STARTED", // turn 1
      "CUSTOM", // pi.message_start
      "REASONING_START",
      "REASONING_MESSAGE_START",
      ...repeat("REASONING_MESSAGE_CONTENT", 3),
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "TEXT_MESSAGE_START", // pi_msg_1_text_1
      ...repeat("TEXT_MESSAGE_CONTENT", 3),
      "TOOL_CALL_START", // call_read_1 (streamed)
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "STEP_STARTED", // tool execution of the streamed call → no duplicate TOOL_CALL_*
      "CUSTOM", // pi.tool_progress
      "TOOL_CALL_RESULT",
      "STEP_FINISHED",
      "TEXT_MESSAGE_START", // pi_msg_1_text_3
      ...repeat("TEXT_MESSAGE_CONTENT", 12),
      "TEXT_MESSAGE_END",
      "TEXT_MESSAGE_END", // text block 1 was left open across the tool call; closed by message_end
      "CUSTOM", // usage
      "STEP_FINISHED", // turn 1
      "STEP_STARTED", // turn 2
      "CUSTOM", // pi.message_start
      "TEXT_MESSAGE_START", // pi_msg_2_text_0
      ...repeat("TEXT_MESSAGE_CONTENT", 4),
      "TEXT_MESSAGE_END",
      "CUSTOM", // usage
      "STEP_FINISHED", // turn 2 (closed once — agent_settled no longer duplicates it)
      "RUN_FINISHED",
    ]);

    expect(byType("STEP_STARTED").map((e) => e.stepName)).toEqual(["turn 1", "read", "turn 2"]);
    expect(byType("STEP_FINISHED").map((e) => e.stepName)).toEqual(["read", "turn 1", "turn 2"]);
    expect(byType("CUSTOM").map((e) => e.name)).toEqual([
      "pi.message_start",
      "pi.tool_progress",
      "usage",
      "pi.message_start",
      "usage",
    ]);
    const finished = events[events.length - 1];
    expect(finished.outcome).toEqual({ type: "success" });
    expect(events.filter((e) => e.type === "RUN_ERROR")).toHaveLength(0);
  });

  it("accumulates recorded text and reasoning deltas into the assistant's full reply", () => {
    expect(deltasOf("TEXT_MESSAGE_CONTENT", "pi_msg_1_text_1")).toBe(REPLY_PART_1);
    expect(deltasOf("TEXT_MESSAGE_CONTENT", "pi_msg_1_text_3")).toBe(REPLY_PART_2);
    expect(deltasOf("TEXT_MESSAGE_CONTENT", "pi_msg_2_text_0")).toBe(REPLY_PART_3);
    expect(
      deltasOf("TEXT_MESSAGE_CONTENT", "pi_msg_1_text_1") +
        deltasOf("TEXT_MESSAGE_CONTENT", "pi_msg_1_text_3") +
        deltasOf("TEXT_MESSAGE_CONTENT", "pi_msg_2_text_0")
    ).toBe(REPLY_PART_1 + REPLY_PART_2 + REPLY_PART_3);
    expect(deltasOf("REASONING_MESSAGE_CONTENT")).toBe(THINKING_TEXT);
    expect(deltasOf("TOOL_CALL_ARGS")).toBe('{"path": "src/skins/paper/paper.css"}');
  });

  it("keeps every lifecycle paired by stable ids and stamps thread/run/timestamp on all events", () => {
    const textIds = (type: string) => byType(type).map((e) => e.messageId).sort();
    expect(textIds("TEXT_MESSAGE_START")).toEqual(["pi_msg_1_text_1", "pi_msg_1_text_3", "pi_msg_2_text_0"]);
    expect(textIds("TEXT_MESSAGE_END")).toEqual(["pi_msg_1_text_1", "pi_msg_1_text_3", "pi_msg_2_text_0"]);
    expect(textIds("REASONING_START")).toEqual(["pi_msg_1_think_0"]);
    expect(textIds("REASONING_MESSAGE_START")).toEqual(["pi_msg_1_think_0"]);
    expect(textIds("REASONING_MESSAGE_END")).toEqual(["pi_msg_1_think_0"]);
    expect(textIds("REASONING_END")).toEqual(["pi_msg_1_think_0"]);

    const toolIds = (type: string) => new Set(byType(type).map((e) => e.toolCallId));
    expect(toolIds("TOOL_CALL_START")).toEqual(new Set(["call_read_1"]));
    // recorded pi `toolcall_delta` records carry no `id` (only contentIndex + delta);
    // the mapper backfills the toolCallId tracked from toolcall_start (fix round 1).
    expect(toolIds("TOOL_CALL_ARGS")).toEqual(new Set(["call_read_1"]));
    expect(toolIds("TOOL_CALL_END")).toEqual(new Set(["call_read_1"]));
    expect(toolIds("TOOL_CALL_RESULT")).toEqual(new Set(["call_read_1"]));

    const result = byType("TOOL_CALL_RESULT")[0];
    expect(result.messageId).toBe("pi_tool_call_read_1");
    expect(result.role).toBe("tool");
    expect(JSON.parse(result.content).content[0].text).toContain("Paper: an editorial correspondence view");

    for (const event of events) {
      expect(event.threadId).toBe(THREAD);
      expect(event.runId).toBe(RUN);
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});

/* ── regressions: fix round 1 (controller-ruled defects) ────────────── */

describe("createPiMapper: regressions (fix round 1)", () => {
  it("backfills toolCallId for id-less toolcall_delta records from the tracked toolcall_start", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });

    const events = [
      ...mapper.map(update({ type: "toolcall_start", contentIndex: 2, id: "call_1", toolName: "read" })),
      ...mapper.map(update({ type: "toolcall_delta", contentIndex: 2, delta: '{"path":' })), // pi deltas carry no id
      ...mapper.map(update({ type: "toolcall_delta", contentIndex: 2, delta: '"file"}' })),
      ...mapper.map(
        update({
          type: "toolcall_end",
          contentIndex: 2,
          toolCall: { id: "call_1", type: "function", function: { name: "read", arguments: "{}" } },
        })
      ),
    ];

    expect(eventTypes(events)).toEqual(["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
    expect(events.map((event) => event.toolCallId)).toEqual(["call_1", "call_1", "call_1", "call_1"]);
  });

  it("routes id-less args deltas to the right call when two toolcalls stream concurrently", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });

    const events = [
      ...mapper.map(update({ type: "toolcall_start", contentIndex: 2, id: "call_a", toolName: "read" })),
      ...mapper.map(update({ type: "toolcall_start", contentIndex: 5, id: "call_b", toolName: "bash" })),
      ...mapper.map(update({ type: "toolcall_delta", contentIndex: 2, delta: '{"a":' })),
      ...mapper.map(update({ type: "toolcall_delta", contentIndex: 5, delta: '{"b":' })),
      ...mapper.map(update({ type: "toolcall_delta", contentIndex: 2, delta: "1}" })),
      ...mapper.map(update({ type: "toolcall_end", contentIndex: 2, toolCall: { id: "call_a" } })),
      ...mapper.map(update({ type: "toolcall_end", contentIndex: 5, toolCall: { id: "call_b" } })),
    ];

    const args = events.filter((event) => event.type === "TOOL_CALL_ARGS");
    expect(args.map((event) => `${event.toolCallId}:${event.delta}`)).toEqual([
      'call_a:{"a":',
      'call_b:{"b":',
      "call_a:1}",
    ]);
    expect(events.filter((event) => event.type === "TOOL_CALL_END").map((event) => event.toolCallId)).toEqual([
      "call_a",
      "call_b",
    ]);
  });

  it("keeps ids consistent when toolcall_end omits the toolCall object", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });

    const events = [
      ...mapper.map(update({ type: "toolcall_start", contentIndex: 2, id: "call_1", toolName: "read" })),
      ...mapper.map(update({ type: "toolcall_end", contentIndex: 2 })), // no toolCall object at all
    ];
    expect(eventTypes(events)).toEqual(["TOOL_CALL_START", "TOOL_CALL_END"]);
    expect(events[1].toolCallId).toBe("call_1");

    // the real id must now be tracked: executing it must NOT resynthesize the lifecycle
    const execution = mapper.map({ type: "tool_execution_start", toolCallId: "call_1", toolName: "read", args: {} });
    expect(eventTypes(execution)).toEqual(["STEP_STARTED"]);
  });

  it("never tracks undefined ids from degenerate toolcall records", () => {
    const mapper = newMapper();
    mapper.map({ type: "turn_start" });

    const end = mapper.map(update({ type: "toolcall_end", contentIndex: 7 })); // no start, no toolCall, no id
    expect(eventTypes(end)).toEqual(["TOOL_CALL_END"]);
    expect(end[0].toolCallId).toBeUndefined();

    // an unrelated real tool execution still synthesizes its own lifecycle
    const execution = mapper.map({
      type: "tool_execution_start",
      toolCallId: "call_x",
      toolName: "bash",
      args: { cmd: "ls" },
    });
    expect(eventTypes(execution)).toEqual(["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "STEP_STARTED"]);
  });

  it("returns [] for non-object pi records instead of throwing", () => {
    const mapper = newMapper();
    expect(mapper.map(null)).toEqual([]);
    expect(mapper.map(undefined)).toEqual([]);
    expect(mapper.map(42)).toEqual([]);
    expect(mapper.map("junk")).toEqual([]);
    expect(mapper.map(true)).toEqual([]);
    expect(mapper.map([1, 2])).toEqual([]);
    // the mapper stays usable afterwards
    expect(eventTypes(mapper.map({ type: "agent_start" }))).toEqual(["RUN_STARTED"]);
  });

  it("emits STEP_FINISHED for a turn at most once (turn_end close wins; agent_settled does not duplicate)", () => {
    const events = mapAll([
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "turn_end" },
      { type: "agent_settled", aborted: false },
    ]);
    expect(eventTypes(events)).toEqual(["RUN_STARTED", "STEP_STARTED", "STEP_FINISHED", "RUN_FINISHED"]);
    expect(events.filter((event) => event.type === "STEP_FINISHED").map((event) => event.stepName)).toEqual(["turn 1"]);
    expect(events[events.length - 1].outcome).toEqual({ type: "success" });
  });

  it("still closes an open turn exactly once on agent_settled when turn_end never arrives", () => {
    const events = mapAll([{ type: "turn_start" }, { type: "agent_settled", aborted: false }]);
    expect(eventTypes(events)).toEqual(["STEP_STARTED", "STEP_FINISHED", "RUN_FINISHED"]);
    expect(events[1].stepName).toBe("turn 1");
    expect(events[2].outcome).toEqual({ type: "success" });
  });
});
