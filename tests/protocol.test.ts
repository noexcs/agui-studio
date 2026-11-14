import { describe, expect, it, afterEach } from "vitest";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";

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

describe("MESSAGES_SNAPSHOT", () => {
  it("rebuilds the transcript from authoritative messages", () => {
    const s = make();
    dispatch(s, {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        { id: "u1", role: "user", content: "hello" },
        {
          id: "a1",
          role: "assistant",
          content: [{ type: "text", text: "hi there" }],
          toolCalls: [{ id: "tc1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } }],
        },
        { id: "t1", role: "tool", content: '{"ok":true}', toolCallId: "tc1" },
        { id: "r1", role: "reasoning", content: "thought" },
      ],
    });

    expect(s.entries.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool", "reasoning"]);
    const assistant = s.entries.find((entry) => entry.kind === "assistant");
    const tool = s.entries.find((entry) => entry.kind === "tool");
    expect(assistant && assistant.kind === "assistant" ? assistant.text : "").toBe("hi there");
    expect(tool && tool.kind === "tool" ? tool.status : "").toBe("done");
  });
});

describe("chunk events", () => {
  it("merges TEXT_MESSAGE_CHUNK without a START", () => {
    const s = make();
    dispatch(s, { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", delta: "chunked " });
    dispatch(s, { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", delta: "tokens" });
    const assistant = s.entries.find((entry) => entry.kind === "assistant");
    expect(assistant && assistant.kind === "assistant" ? assistant.text : "").toBe("chunked tokens");
  });

  it("merges TOOL_CALL_CHUNK into the tool arguments", () => {
    const s = make();
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc1", toolCallName: "search" });
    dispatch(s, { type: EventType.TOOL_CALL_CHUNK, toolCallId: "tc1", delta: '{"q":' });
    dispatch(s, { type: EventType.TOOL_CALL_CHUNK, toolCallId: "tc1", delta: '"x"}' });
    const tool = s.entries.find((entry) => entry.kind === "tool");
    expect(tool && tool.kind === "tool" ? tool.argsRaw : "").toBe('{"q":"x"}');
  });
});

describe("tool errors", () => {
  it("marks the tool as failed from the result payload", () => {
    const s = make();
    dispatch(s, { type: EventType.TOOL_CALL_START, toolCallId: "tc1", toolCallName: "search" });
    dispatch(s, { type: EventType.TOOL_CALL_END, toolCallId: "tc1" });
    dispatch(s, { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc1", content: '{"error":"boom"}' });
    const tool = s.entries.find((entry) => entry.kind === "tool");
    expect(tool && tool.kind === "tool" ? tool.status : "").toBe("error");
    expect(tool && tool.kind === "tool" ? tool.error : "").toBe("boom");
  });
});

const interrupt = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  reason: "confirmation",
  message: `confirm ${id}?`,
  responseSchema: { type: "object", required: ["approved"], properties: { approved: { type: "boolean" } } },
  ...extra,
});

describe("interrupts", () => {
  it("keeps parallel interrupts and resumes only when all are resolved", () => {
    const s = make();
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt", interrupts: [interrupt("i1"), interrupt("i2")] },
    });

    expect(s.status).toBe("interrupted");
    expect(s.pendingInterrupts()).toHaveLength(2);

    s.resolveInterrupt(true, undefined, "i1");
    expect(s.status).toBe("interrupted");
    expect(s.pendingInterrupts()).toHaveLength(1);

    s.resolveInterrupt(false, undefined, "i2");
    expect(s.pendingInterrupts()).toHaveLength(0);
    expect(s.lastResume).toHaveLength(2);
    expect(s.lastResume[0].approved).toBe(true);
    expect(s.lastResume[1].approved).toBe(false);
    expect(s.status).toBe("running");
  });

  it("rejects a resume payload that misses required schema fields", () => {
    const s = make();
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: {
        type: "interrupt",
        interrupts: [
          interrupt("i1", {
            responseSchema: {
              type: "object",
              required: ["approved", "editedArgs"],
              properties: { approved: { type: "boolean" }, editedArgs: { type: "object" } },
            },
          }),
        ],
      },
    });

    s.resolveInterrupt(true);
    expect(s.pendingInterrupts()).toHaveLength(1);
    expect(s.errorMessage).toContain("responseSchema");

    s.resolveInterrupt(true, { hotel: "x" });
    expect(s.pendingInterrupts()).toHaveLength(0);
    expect(s.lastResume[0].editedArgs).toEqual({ hotel: "x" });
  });

  it("expires an interrupt and never submits it", () => {
    const s = make();
    dispatch(s, {
      type: EventType.RUN_FINISHED,
      outcome: {
        type: "interrupt",
        interrupts: [interrupt("i1", { expiresAt: new Date(Date.now() - 1000).toISOString() })],
      },
    });

    s.resolveInterrupt(true, undefined, "i1");
    const entry = s.entries.find((item) => item.kind === "interrupt");
    expect(entry && entry.kind === "interrupt" ? entry.status : "").toBe("denied");
    expect(entry && entry.kind === "interrupt" ? entry.expired : false).toBe(true);
    expect(s.lastResume[0].approved).toBe(false);
  });
});

describe("P1: capabilities, subagents, encrypted reasoning, activity types", () => {
  it("exposes declared capabilities", () => {
    const s = make();
    expect(s.capabilities.tools.supported).toBe(true);
    expect(s.capabilities.humanInTheLoop.interrupts).toBe(true);
  });

  it("tracks subagent lifecycle", () => {
    const s = make();
    dispatch(s, { type: EventType.SUBAGENT_STARTED, subagentId: "sa1", name: "researcher" });
    dispatch(s, { type: EventType.SUBAGENT_FINISHED, subagentId: "sa1" });
    const entry = s.entries.find((item) => item.kind === "subagent");
    expect(entry && entry.kind === "subagent" ? entry.name : "").toBe("researcher");
    expect(entry && entry.kind === "subagent" ? entry.status : "").toBe("done");
  });

  it("attaches an encrypted reasoning value", () => {
    const s = make();
    dispatch(s, { type: EventType.REASONING_START, messageId: "r1" });
    dispatch(s, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: "r1", delta: "summary" });
    dispatch(s, { type: EventType.REASONING_ENCRYPTED_VALUE, messageId: "r1", value: "enc-blob" });
    const entry = s.entries.find((item) => item.kind === "reasoning");
    expect(entry && entry.kind === "reasoning" ? entry.encryptedValue : "").toBe("enc-blob");
  });

  it("keeps raw content for non-PLAN activity types", () => {
    const s = make();
    dispatch(s, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "a1",
      activityType: "SEARCH",
      content: { query: "fixture", hits: 3 },
    });
    const entry = s.entries.find((item) => item.kind === "plan");
    expect(entry && entry.kind === "plan" ? entry.activityType : "").toBe("SEARCH");
    expect(entry && entry.kind === "plan" ? entry.content : null).toEqual({ query: "fixture", hits: 3 });
  });
});

describe("STEP and CUSTOM view model", () => {
  it("records STEP start/finish as one step entry", () => {
    const s = make();
    dispatch(s, { type: EventType.STEP_STARTED, stepName: "gather facts" });
    dispatch(s, { type: EventType.STEP_FINISHED, stepName: "gather facts" });
    const step = s.entries.find((entry) => entry.kind === "step");
    expect(step && step.kind === "step" ? step.name : "").toBe("gather facts");
    expect(step && step.kind === "step" ? step.status : "").toBe("done");
    expect(step && step.kind === "step" ? Boolean(step.finishedAt) : false).toBe(true);
  });

  it("keeps unknown CUSTOM payloads as entries, suggestions/usage stay special", () => {
    const s = make();
    dispatch(s, { type: EventType.CUSTOM, name: "handoff", value: { to: "human" } });
    dispatch(s, { type: EventType.CUSTOM, name: "suggestions", value: ["a"] });
    dispatch(s, { type: EventType.CUSTOM, name: "usage", value: { totalTokens: 42 } });
    const custom = s.entries.filter((entry) => entry.kind === "custom");
    expect(custom).toHaveLength(1);
    expect(custom[0].kind === "custom" ? custom[0].name : "").toBe("handoff");
    expect(s.suggestions).toEqual(["a"]);
    expect(s.tokens).toBe(42);
  });
});
