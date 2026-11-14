import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import { EventType } from "../src/core/events";
import { ConversationStore } from "../src/core/store";

afterEach(cleanup);

const BRANDING = { agentName: "Generic Agent", modelLabel: "third-party" };

function storeWithToolResult(content: string) {
  const store = new ConversationStore(false);
  store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
  store.dispatch({ type: EventType.TOOL_CALL_START, toolCallId: "t1", toolCallName: "search" } as never);
  store.dispatch({ type: EventType.TOOL_CALL_ARGS, toolCallId: "t1", delta: '{"q":"x"}' } as never);
  store.dispatch({ type: EventType.TOOL_CALL_END, toolCallId: "t1" } as never);
  store.dispatch({ type: EventType.TOOL_CALL_RESULT, toolCallId: "t1", content } as never);
  store.dispatch({ type: EventType.RUN_FINISHED, outcome: { type: "success" } } as never);
  return store;
}

const PAYLOADS = ['{"results":"3 hits"}', '{"results":[{"title":null}]}', '"plain text result"', '{"ok":true}'];

describe("generic tool results do not crash any skin", () => {
  for (const skin of skins) {
    it(`renders arbitrary results in ${skin.id}`, () => {
      for (const content of PAYLOADS) {
        const store = storeWithToolResult(content);
        const Page = skin.ChatPage;
        const { container, unmount } = render(
          <SkinHostProvider conversation={store} lang="en" branding={BRANDING}>
            <Page />
          </SkinHostProvider>
        );
        expect(container.innerHTML.length).toBeGreaterThan(0);
        unmount();
      }
    });
  }
});

describe("generic activity content does not crash", () => {
  for (const skin of skins) {
    it(`renders a step without label in ${skin.id}`, () => {
      const store = new ConversationStore(false);
      store.dispatch({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "act",
        activityType: "PLAN",
        content: { steps: [{ description: "only-description" }, null] },
      } as never);
      const Page = skin.ChatPage;
      expect(() =>
        render(
          <SkinHostProvider conversation={store} lang="en" branding={BRANDING}>
            <Page />
          </SkinHostProvider>
        )
      ).not.toThrow();
    });
  }
});
