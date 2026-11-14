import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import { EventType } from "../src/core/events";
import { ConversationStore } from "../src/core/store";

afterEach(cleanup);

describe("event inspector stays bounded on long streams", () => {
  it("renders a tail window and reveals earlier events on demand", () => {
    const store = new ConversationStore(false);
    for (let i = 0; i < 450; i += 1) {
      store.dispatch({ type: EventType.RAW, event: { i }, source: "test" } as never);
    }
    const AuroraPage = skins.find((skin) => skin.id === "aurora")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={store} lang="en" branding={{ agentName: "Inspector", modelLabel: "raw" }}>
        <AuroraPage />
      </SkinHostProvider>
    );

    expect(container.querySelectorAll(".ev-row")).toHaveLength(200);
    const more = container.querySelector(".ev-more");
    expect(more).toBeTruthy();
    fireEvent.click(more!);
    expect(container.querySelectorAll(".ev-row")).toHaveLength(400);
  });
});
