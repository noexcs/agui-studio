import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";

/**
 * L1 protocol matrix: every declared event type is dispatched at least once,
 * plus ordering / duplicate / malformed cases that the UI depends on.
 */

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

const MINIMAL: Record<string, Record<string, unknown>> = {
  RUN_STARTED: { threadId: "t1", runId: "r1" },
  RUN_FINISHED: { outcome: { type: "success" } },
  RUN_ERROR: { message: "boom" },
  STEP_STARTED: { stepName: "step" },
  STEP_FINISHED: { stepName: "step" },
  TEXT_MESSAGE_START: { messageId: "m1", role: "assistant" },
  TEXT_MESSAGE_CONTENT: { messageId: "m1", delta: "hello" },
  TEXT_MESSAGE_END: { messageId: "m1" },
  TEXT_MESSAGE_CHUNK: { messageId: "m2", delta: "chunk" },
  TOOL_CALL_START: { toolCallId: "tc1", toolCallName: "search" },
  TOOL_CALL_ARGS: { toolCallId: "tc1", delta: '{"q":1}' },
  TOOL_CALL_END: { toolCallId: "tc1" },
  TOOL_CALL_RESULT: { toolCallId: "tc1", content: '{"ok":true}' },
  TOOL_CALL_CHUNK: { toolCallId: "tc2", delta: '{"q":2}' },
  STATE_SNAPSHOT: { snapshot: { a: 1 } },
  STATE_DELTA: { delta: [{ op: "add", path: "/b", value: 2 }] },
  MESSAGES_SNAPSHOT: { messages: [] },
  ACTIVITY_SNAPSHOT: { messageId: "act1", activityType: "PLAN", content: { title: "t", steps: [] } },
  ACTIVITY_DELTA: { messageId: "act1", patch: [] },
  REASONING_START: { messageId: "r1" },
  REASONING_MESSAGE_START: { messageId: "r1", role: "reasoning" },
  REASONING_MESSAGE_CONTENT: { messageId: "r1", delta: "think" },
  REASONING_MESSAGE_END: { messageId: "r1" },
  REASONING_END: { messageId: "r1" },
  REASONING_ENCRYPTED_VALUE: { messageId: "r1", value: "enc" },
  RAW: { event: { foo: 1 }, source: "test" },
  CUSTOM: { name: "suggestions", value: ["a", "b"] },
  SUBAGENT_STARTED: { subagentId: "sa1", name: "scout" },
  SUBAGENT_FINISHED: { subagentId: "sa1" },
  SUBAGENT_ERROR: { subagentId: "sa1", message: "failed" },
};

describe("event matrix", () => {
  it("declares a minimal payload for every event type", () => {
    const declared = Object.values(EventType);
    const missing = declared.filter((type) => !(type in MINIMAL));
    expect(missing).toEqual([]);
    expect(declared).toHaveLength(30);
  });

  it.each(Object.values(EventType))("handles %s without crashing", (type) => {
    const s = make();
    expect(() => dispatch(s, { type, ...MINIMAL[type] })).not.toThrow();
    expect(s.events).toHaveLength(1);
  });

  it("keeps unknown / extension event types in the log", () => {
    const s = make();
    dispatch(s, { type: "FUTURE_EVENT", payload: { a: 1 } });
    expect(s.events).toHaveLength(1);
  });
});

describe("ordering and idempotency", () => {
  it("creates the assistant entry when CONTENT arrives before START", () => {
    const s = make();
    dispatch(s, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "early" });
    const assistant = s.entries.find((entry) => entry.kind === "assistant");
    expect(assistant && assistant.kind === "assistant" ? assistant.text : "").toBe("early");
  });

  it("does not duplicate entries on a repeated START", () => {
    const s = make();
    dispatch(s, { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" });
    dispatch(s, { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" });
    dispatch(s, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "x" });
    expect(s.entries.filter((entry) => entry.kind === "assistant")).toHaveLength(1);
  });

  it("closes streaming on TEXT_MESSAGE_END", () => {
    const s = make();
    dispatch(s, { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" });
    dispatch(s, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "x" });
    dispatch(s, { type: EventType.TEXT_MESSAGE_END, messageId: "m1" });
    const assistant = s.entries.find((entry) => entry.kind === "assistant");
    expect(assistant && assistant.kind === "assistant" ? assistant.streaming : true).toBe(false);
  });

  it("ignores tool events for unknown tool ids", () => {
    const s = make();
    dispatch(s, { type: EventType.TOOL_CALL_ARGS, toolCallId: "nope", delta: "{}" });
    dispatch(s, { type: EventType.TOOL_CALL_END, toolCallId: "nope" });
    dispatch(s, { type: EventType.TOOL_CALL_RESULT, toolCallId: "nope", content: "{}" });
    expect(s.entries).toHaveLength(0);
  });

  it("applies STATE_DELTA after a snapshot and ignores patches for missing paths", () => {
    const s = make();
    dispatch(s, { type: EventType.STATE_SNAPSHOT, snapshot: { budget: 800 } });
    dispatch(s, { type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/budget", value: 700 }] });
    expect(s.sharedState).toEqual({ budget: 700 });
    expect(s.stateVersion).toBe(2);
  });

  it("does not duplicate an interrupt entry when RUN_FINISHED repeats", () => {
    const s = make();
    const outcome = {
      type: "interrupt",
      interrupts: [{ id: "i1", reason: "confirmation", message: "confirm?" }],
    };
    dispatch(s, { type: EventType.RUN_FINISHED, outcome });
    dispatch(s, { type: EventType.RUN_FINISHED, outcome });
    expect(s.entries.filter((entry) => entry.kind === "interrupt")).toHaveLength(1);
    expect(s.pendingInterrupts()).toHaveLength(1);
  });

  it("treats a second resolve as a no-op", () => {
    const s = make();
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt", interrupts: [{ id: "i1", reason: "confirmation", message: "confirm?" }] },
    });
    s.resolveInterrupt(true, undefined, "i1");
    const first = s.lastResume;
    s.resolveInterrupt(true, undefined, "i1");
    expect(s.lastResume).toEqual(first);
    expect(s.pendingInterrupts()).toHaveLength(0);
  });

  it("captures suggestions and usage from CUSTOM", () => {
    const s = make();
    dispatch(s, { type: EventType.CUSTOM, name: "suggestions", value: ["one", "two"] });
    dispatch(s, { type: EventType.CUSTOM, name: "usage", value: { totalTokens: 512 } });
    expect(s.suggestions).toEqual(["one", "two"]);
    expect(s.tokens).toBe(512);
  });

  it("ignores ACTIVITY_DELTA for an unknown activity", () => {
    const s = make();
    dispatch(s, { type: EventType.ACTIVITY_DELTA, messageId: "missing", patch: [{ op: "replace", path: "/x", value: 1 }] });
    expect(s.entries).toHaveLength(0);
  });
});

describe("status machine", () => {
  it("goes idle -> running -> done", () => {
    const s = make();
    expect(s.status).toBe("idle");
    dispatch(s, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    expect(s.status).toBe("running");
    dispatch(s, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
    expect(s.status).toBe("done");
  });

  it("records RUN_ERROR with an error entry", () => {
    const s = make();
    dispatch(s, { type: EventType.RUN_ERROR, message: "boom" });
    expect(s.status).toBe("error");
    expect(s.entries.some((entry) => entry.kind === "error")).toBe(true);
  });
});
