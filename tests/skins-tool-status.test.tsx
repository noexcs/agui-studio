import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, toolStage } from "agui-skins";
import { EventType } from "../src/core/events";
import { makeStore } from "./fixture";

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

/** Build a transcript containing a tool call that failed. */
function failedToolStore() {
  const store = makeStore();
  store.dispatch({
    type: EventType.MESSAGES_SNAPSHOT,
    messages: [
      {
        id: "a1",
        role: "assistant",
        content: "trying",
        toolCalls: [{ id: "tc1", type: "function", function: { name: "web.search", arguments: '{"q":"x"}' } }],
      },
    ],
  } as never);
  store.dispatch({ type: EventType.TOOL_CALL_END, toolCallId: "tc1" } as never);
  store.dispatch({
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: "tc1",
    content: '{"error":"search backend unavailable"}',
  } as never);
  return store;
}

describe("toolStage", () => {
  it("normalizes every lifecycle status and stays forward-compatible", () => {
    expect(toolStage("args")).toBe("streaming");
    expect(toolStage("executing")).toBe("running");
    expect(toolStage("interrupted")).toBe("interrupted");
    expect(toolStage("done")).toBe("done");
    expect(toolStage("error")).toBe("error");
    expect(toolStage("future-status" as never)).toBe("running");
  });
});

describe("tool error rendering", () => {
  it("Paper shows a failure instead of pretending the tool is executing", () => {
    const Page = skins.find((skin) => skin.id === "paper")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={failedToolStore()} lang="en" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    const text = container.textContent ?? "";
    expect(text).toContain("search backend unavailable");
    expect(text).not.toContain("executing");
  });

  it("Classic surfaces the error text too", () => {
    const Page = skins.find((skin) => skin.id === "classic")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={failedToolStore()} lang="en" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    expect(container.textContent).toContain("search backend unavailable");
  });
});
