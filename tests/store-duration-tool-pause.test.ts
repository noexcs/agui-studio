import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore, type ToolEntry } from "../src/core/store";
import { EventType } from "../src/core/events";

/* ── Fix B: shared-layer state bugs (duration ternary, tools stuck on
   "executing" after an interrupt). ─────────────────────────────────── */

let store: ConversationStore | null = null;
const make = () => {
  store = new ConversationStore(false);
  return store;
};
afterEach(() => {
  store?.stop();
  store = null;
});

const dispatch = (s: ConversationStore, event: Record<string, unknown>) => s.dispatch(event as never);
const toolStatuses = (s: ConversationStore) =>
  s.entries.filter((e): e is ToolEntry => e.kind === "tool").map((t) => t.status);

describe("Fix B: duration()", () => {
  it("reports the live elapsed time while the run is in flight (endedAt === 0)", () => {
    const s = make();
    const started = Date.now() - 5000;
    dispatch(s, { type: EventType.RUN_STARTED, threadId: "t", runId: "r", timestamp: new Date(started).toISOString() });
    expect(s.startedAt).toBe(started);
    expect(s.endedAt).toBe(0);
    const d = s.duration();
    expect(d).toBeGreaterThanOrEqual(4900);
    expect(d).toBeLessThanOrEqual(6000);
  });

  it("freezes the final span once the run has ended", () => {
    const s = make();
    const started = Date.now() - 60_000;
    dispatch(s, { type: EventType.RUN_STARTED, threadId: "t", runId: "r", timestamp: new Date(started).toISOString() });
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: { type: "success" },
      timestamp: new Date(started + 3000).toISOString(),
    });
    expect(s.endedAt).toBe(started + 3000);
    expect(s.duration()).toBe(3000);
    // must stay frozen instead of growing with the wall clock
    expect(s.duration()).toBe(3000);
  });

  it("returns 0 before any run started", () => {
    const s = make();
    expect(s.duration()).toBe(0);
  });
});

describe("Fix B: tool calls paused by an interrupt", () => {
  const seedTools = (s: ConversationStore) => {
    dispatch(s, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    // finished before the interrupt — must stay untouched
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc0", toolCallName: "web.search" });
    dispatch(s, { type: EventType.TOOL_CALL_END, toolCallId: "tc0" });
    dispatch(s, { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc0", content: '{"ok":true}' });
    // args fully streamed, execution never completed
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc1", toolCallName: "booking.hold" });
    dispatch(s, { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc1", delta: '{"hotel":"Pessoa"}' });
    dispatch(s, { type: EventType.TOOL_CALL_END, toolCallId: "tc1" });
    // args still streaming when the run pauses
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc2", toolCallName: "booking.hold" });
    dispatch(s, { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc2", delta: '{"hotel":"Peso' });
  };

  it("marks args/executing tools as interrupted when RUN_FINISHED pauses on an interrupt", () => {
    const s = make();
    seedTools(s);
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt", interrupts: [{ id: "i1", reason: "tool_call", toolCallId: "tc1", message: "hold?" }] },
    });
    expect(s.status).toBe("interrupted");
    expect(toolStatuses(s)).toEqual(["done", "interrupted", "interrupted"]);
  });

  it("leaves tool status alone when the run finishes successfully", () => {
    const s = make();
    seedTools(s);
    dispatch(s, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
    expect(s.status).toBe("done");
    expect(toolStatuses(s)).toEqual(["done", "executing", "args"]);
  });

  it("lets a late TOOL_CALL_RESULT after resume complete an interrupted tool", () => {
    const s = make();
    seedTools(s);
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt", interrupts: [{ id: "i1", reason: "tool_call", toolCallId: "tc1", message: "hold?" }] },
    });
    dispatch(s, { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc1", content: '{"reservation":"LP-88213"}' });
    expect(toolStatuses(s)).toEqual(["done", "done", "interrupted"]);
  });

  it("is idempotent when RUN_FINISHED(interrupt) repeats", () => {
    const s = make();
    seedTools(s);
    const outcome = {
      type: "interrupt",
      interrupts: [{ id: "i1", reason: "tool_call", toolCallId: "tc1", message: "hold?" }],
    };
    dispatch(s, { type: EventType.RUN_FINISHED, outcome });
    dispatch(s, { type: EventType.RUN_FINISHED, outcome });
    expect(toolStatuses(s)).toEqual(["done", "interrupted", "interrupted"]);
    expect(s.entries.filter((e) => e.kind === "interrupt")).toHaveLength(1);
  });
});
