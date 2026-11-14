import { describe, expect, it } from "vitest";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";

const make = () => new ConversationStore(false);

describe("generic AG-UI streams (no demo dialect)", () => {
  it("keeps pending interrupts across a MESSAGES_SNAPSHOT", () => {
    const store = make();
    store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
    store.dispatch({
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt", interrupts: [{ id: "int_1", reason: "confirm", message: "ok?" }] },
    } as never);
    expect(store.pendingInterrupts()).toHaveLength(1);

    store.dispatch({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        { id: "u1", role: "user", content: "hello" },
        { id: "a1", role: "assistant", content: "hi" },
      ],
    } as never);

    expect(store.pendingInterrupts()).toHaveLength(1);
    expect(store.entries.some((entry) => entry.kind === "interrupt" && entry.id === "int_1")).toBe(true);
  });

  it("assembles chunk-only text without messageId and finalizes streaming", () => {
    const store = make();
    store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
    store.dispatch({ type: EventType.TEXT_MESSAGE_CHUNK, delta: "Hel" } as never);
    store.dispatch({ type: EventType.TEXT_MESSAGE_CHUNK, delta: "lo" } as never);
    store.dispatch({ type: EventType.RUN_FINISHED, outcome: { type: "success" } } as never);

    const assistants = store.entries.filter((entry) => entry.kind === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ text: "Hello", streaming: false });
  });

  it("opens a tool call from the first TOOL_CALL_CHUNK", () => {
    const store = make();
    store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
    store.dispatch({
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: "call_1",
      toolCallName: "search",
      delta: '{"q":"x"}',
    } as never);
    store.dispatch({ type: EventType.TOOL_CALL_RESULT, toolCallId: "call_1", content: '{"ok":true}' } as never);

    const tool = store.entries.find((entry) => entry.kind === "tool");
    expect(tool).toMatchObject({ name: "search", status: "done", result: { ok: true } });
  });

  it("surfaces reasoning chunk events", () => {
    const store = make();
    store.dispatch({ type: EventType.REASONING_MESSAGE_CHUNK, delta: "why" } as never);
    expect(store.entries.find((entry) => entry.kind === "reasoning")).toMatchObject({ text: "why" });
  });

  it("uses protocol field names for subagents and encrypted reasoning", () => {
    const store = make();
    store.dispatch({ type: EventType.SUBAGENT_STARTED, subagentRunId: "sub_1", name: "Research" } as never);
    store.dispatch({ type: EventType.SUBAGENT_FINISHED, subagentRunId: "sub_1" } as never);
    expect(store.entries.find((entry) => entry.kind === "subagent")).toMatchObject({
      id: "sub_1",
      status: "done",
    });

    store.dispatch({ type: EventType.REASONING_START, messageId: "rsn_1" } as never);
    store.dispatch({
      type: EventType.REASONING_ENCRYPTED_VALUE,
      subtype: "message",
      entityId: "rsn_1",
      encryptedValue: "enc_blob",
    } as never);
    expect(store.entries.find((entry) => entry.kind === "reasoning")).toMatchObject({
      encryptedValue: "enc_blob",
    });
  });

  it("normalizes arbitrary activity content instead of throwing", () => {
    const store = make();
    store.dispatch({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "act",
      activityType: "PLAN",
      content: { steps: [{ description: "observe" }, null, { status: "completed", title: "finish" }] },
    } as never);
    const plan = store.entries.find((entry) => entry.kind === "plan");
    expect(plan).toMatchObject({
      steps: [
        { label: "observe", state: "pending" },
        { label: "Step 2", state: "pending" },
        { label: "finish", state: "done" },
      ],
    });

    expect(() =>
      store.dispatch({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "act2",
        activityType: "PLAN",
        content: { steps: "not-an-array" },
      } as never)
    ).not.toThrow();
  });

  it("maps cancelled runs to stopped and reads usage from terminal events", () => {
    const a = make();
    a.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
    a.dispatch({ type: EventType.RUN_FINISHED, outcome: { type: "cancelled" } } as never);
    expect(a.status).toBe("stopped");

    const b = make();
    b.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
    b.dispatch({
      type: EventType.RUN_FINISHED,
      outcome: { type: "success" },
      usage: [{ totalTokens: 42 }],
    } as never);
    expect(b.tokens).toBe(42);
  });
});
