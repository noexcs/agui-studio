import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore, type ToolEntry } from "../src/core/store";
import { EventType } from "../src/core/events";

/* ── Fix C item 12: stop() must not leave tool cards reading as "in flight".
   Fix B already flips args/executing tools on the interrupt path; the stop()
   path takes the same route (ToolStatus has no "stopped" member, so the
   paused "interrupted" value is the aligned one). ──────────────────────── */

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

describe("Fix C: tools paused by stop()", () => {
  const seedTools = (s: ConversationStore) => {
    dispatch(s, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    // finished before the stop — must stay untouched
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc0", toolCallName: "web.search" });
    dispatch(s, { type: EventType.TOOL_CALL_END, toolCallId: "tc0" });
    dispatch(s, { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc0", content: '{"ok":true}' });
    // executing when the user hits stop
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc1", toolCallName: "booking.hold" });
    dispatch(s, { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc1", delta: '{"hotel":"Pessoa"}' });
    dispatch(s, { type: EventType.TOOL_CALL_END, toolCallId: "tc1" });
    // still streaming args when the user hits stop
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc2", toolCallName: "booking.hold" });
    dispatch(s, { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc2", delta: '{"hotel":"Peso' });
  };

  it("marks args/executing tools as interrupted when the run is stopped", () => {
    const s = make();
    seedTools(s);
    expect(s.status).toBe("running");
    s.stop();
    expect(s.status).toBe("stopped");
    expect(toolStatuses(s)).toEqual(["done", "interrupted", "interrupted"]);
  });

  it("also ends assistant/reasoning streaming on stop (existing behaviour, kept)", () => {
    const s = make();
    seedTools(s);
    dispatch(s, { type: EventType.TEXT_MESSAGE_START, messageId: "m1" });
    dispatch(s, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "partial" });
    s.stop();
    const assistant = s.entries.find((e) => e.kind === "assistant");
    expect(assistant && "streaming" in assistant && assistant.streaming).toBe(false);
  });

  it("is idempotent: stopping twice does not change tool states", () => {
    const s = make();
    seedTools(s);
    s.stop();
    const afterFirst = toolStatuses(s);
    s.stop();
    expect(toolStatuses(s)).toEqual(afterFirst);
    expect(s.status).toBe("stopped");
  });

  it("keeps the interrupt-path parity: stop on an already-interrupted run is a no-op for tools", () => {
    const s = make();
    seedTools(s);
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt", interrupts: [{ id: "i1", reason: "tool_call", toolCallId: "tc1", message: "hold?" }] },
    });
    expect(toolStatuses(s)).toEqual(["done", "interrupted", "interrupted"]);
    s.stop();
    expect(s.status).toBe("stopped");
    expect(toolStatuses(s)).toEqual(["done", "interrupted", "interrupted"]);
  });
});
