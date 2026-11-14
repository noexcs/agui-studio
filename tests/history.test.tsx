import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, windowEntries } from "agui-skins";
import { EventType } from "../src/core/events";
import { makeStore } from "./fixture";

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

describe("windowEntries", () => {
  it("keeps only the newest entries and reports the hidden count", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ kind: "user", id: `u${i}`, at: i, text: `m${i}` })) as never[];
    const { visible, hidden } = windowEntries(entries, 4);
    expect(hidden).toBe(6);
    expect(visible.map((entry) => (entry as { id: string }).id)).toEqual(["u6", "u7", "u8", "u9"]);
  });

  it("is a no-op when the transcript fits", () => {
    const entries = [{ kind: "user", id: "u0", at: 0, text: "m" }] as never[];
    expect(windowEntries(entries, 60)).toEqual({ visible: entries, hidden: 0 });
  });
});

function longStore(count = 80) {
  const store = makeStore();
  const messages = Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: "user",
    content: `early-${String(i).padStart(3, "0")}`,
  }));
  store.dispatch({ type: EventType.MESSAGES_SNAPSHOT, messages } as never);
  return store;
}

describe("long transcript windowing in a real skin", () => {
  it("renders a bounded tail with a show-earlier control that reveals history", () => {
    const ClassicPage = skins.find((skin) => skin.id === "classic")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={longStore()} lang="en" branding={BRANDING}>
        <ClassicPage />
      </SkinHostProvider>
    );

    const text = container.textContent ?? "";
    expect(text).toContain("early-079"); // newest is rendered
    expect(text).not.toContain("early-000"); // oldest is windowed out
    const more = container.querySelector(".sk-history-more") as HTMLButtonElement;
    expect(more).toBeTruthy();
    expect(more.textContent).toContain("20");

    act(() => {
      fireEvent.click(more);
    });
    expect(container.textContent).toContain("early-000");
  });

  it("does not render the control for short transcripts", () => {
    const Page = skins[0].ChatPage;
    const store = makeStore();
    store.dispatch({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: "m0", role: "user", content: "only" }],
    } as never);
    const { container } = render(
      <SkinHostProvider conversation={store} lang="en" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    expect(container.querySelector(".sk-history-more")).toBeNull();
  });
});
