import { describe, expect, it } from "vitest";
// @ts-expect-error server helper is plain ESM (not part of the TS build)
import { createDeepseekMapper } from "../server/deepseek-map.mjs";

const types = (events: { type: string }[]) => events.map((event) => event.type);

describe("DeepSeek chunk → AG-UI mapping", () => {
  it("streams reasoning, then text, closing each section once", () => {
    const mapper = createDeepseekMapper({ threadId: "t1", runId: "r1", idPrefix: "x" });
    const events = [
      ...mapper.mapChunk({ choices: [{ delta: { reasoning_content: "Thinking" } }] }),
      ...mapper.mapChunk({ choices: [{ delta: { reasoning_content: " harder" } }] }),
      ...mapper.mapChunk({ choices: [{ delta: { content: "Hello" } }] }),
      ...mapper.mapChunk({ choices: [{ delta: { content: " world" }, finish_reason: "stop" }], usage: { total_tokens: 12 } }),
      ...mapper.finish(),
    ];

    expect(types(events)).toEqual([
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "CUSTOM",
    ]);
    expect(mapper.text()).toBe("Hello world");
    expect(mapper.reasoning()).toBe("Thinking harder");
    expect(events.at(-1)).toMatchObject({ type: "CUSTOM", name: "usage" });
  });

  it("accumulates streamed tool-call deltas and closes the call", () => {
    const mapper = createDeepseekMapper({ threadId: "t1", runId: "r1", idPrefix: "x" });
    const events = [
      ...mapper.mapChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: "" } }] } }],
      }),
      ...mapper.mapChunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] }),
      ...mapper.mapChunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Lisbon"}' } }] } }] }),
      ...mapper.mapChunk({ choices: [{ finish_reason: "tool_calls" }] }),
    ];

    expect(types(events)).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
    ]);
    expect(mapper.toolCalls()).toEqual([{ id: "call_1", name: "get_weather", args: '{"city":"Lisbon"}' }]);
  });

  it("closes open text when a tool call starts in the same stream", () => {
    const mapper = createDeepseekMapper({ threadId: "t1", runId: "r1", idPrefix: "x" });
    const events = [
      ...mapper.mapChunk({ choices: [{ delta: { content: "Let me check." } }] }),
      ...mapper.mapChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "c2", function: { name: "search_web", arguments: "{}" } }] } }],
      }),
      ...mapper.finish(),
    ];
    expect(types(events)).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
  });
});
