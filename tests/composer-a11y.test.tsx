import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import { EventType } from "../src/core/events";
import { ConversationStore } from "../src/core/store";

afterEach(cleanup);

const BRANDING = { agentName: "A11y Agent", modelLabel: "third-party" };

function storeWithInterrupt() {
  const store = new ConversationStore(false);
  store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
  store.dispatch({
    type: EventType.RUN_FINISHED,
    outcome: { type: "interrupt", interrupts: [{ id: "i1", reason: "confirm", message: "ok?" }] },
  } as never);
  return store;
}

describe("composer accessibility", () => {
  for (const skin of skins) {
    it(`labels the composer in ${skin.id}`, () => {
      const store = new ConversationStore(false);
      const Page = skin.ChatPage;
      const { container } = render(
        <SkinHostProvider conversation={store} lang="en" branding={BRANDING}>
          <Page />
        </SkinHostProvider>
      );
      const textarea = container.querySelector("textarea");
      expect(textarea?.getAttribute("aria-label")).toBeTruthy();
    });
  }

  it("terminal hotkeys ignore modifier keys while an interrupt is pending", () => {
    const store = storeWithInterrupt();
    const TerminalPage = skins.find((skin) => skin.id === "terminal")!.ChatPage;
    render(
      <SkinHostProvider conversation={store} lang="en" branding={BRANDING}>
        <TerminalPage />
      </SkinHostProvider>
    );

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(store.pendingInterrupts()).toHaveLength(1);
    fireEvent.keyDown(window, { key: "y" });
    expect(store.pendingInterrupts()).toHaveLength(0);
  });
});
