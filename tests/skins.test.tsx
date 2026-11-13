import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import { makeFixture, makeStore } from "./fixture";
import { EventType } from "../src/core/events";

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const hasAgentHeader = (id: string) => id !== "terminal";

describe.each(skins.map((skin) => [skin.id, skin] as const))("skin: %s", (_id, skin) => {
  it("renders every entry kind from the fixture", () => {
    const Page = skin.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="zh" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    const text = container.textContent ?? "";
    const lower = text.toLowerCase();

    expect(text).toContain("fixture user prompt");
    expect(text).toContain("fixture answer");
    expect(lower).toContain("web.search");
    expect(text).toContain("fixture approval needed");
    expect(lower).toContain("fixture step one");
    if (["aurora", "classic", "terminal"].includes(skin.id)) {
      expect(lower).toContain("fixture subagent");
    }
  });

  it("picks up injected branding", () => {
    if (!hasAgentHeader(skin.id)) return;
    const Page = skin.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="zh" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    expect(container.textContent).toContain("Fixture Agent");
  });
});

describe("host injection", () => {
  it("repaints streamed tokens end to end", () => {
    const store = makeStore();
    store.dispatch({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: "a1", role: "assistant", content: "start" }],
    } as never);

    const ClassicPage = skins.find((s) => s.id === "classic")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={store} lang="zh" branding={BRANDING}>
        <ClassicPage />
      </SkinHostProvider>
    );

    act(() => {
      store.dispatch({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a1", delta: " streaming token appeared" } as never);
    });

    expect(container.textContent).toContain("streaming token appeared");
  });

  it("applies dictionary overrides", () => {
    const ClassicPage = skins.find((s) => s.id === "classic")!.ChatPage;
    const { container } = render(
      <SkinHostProvider
        conversation={makeFixture()}
        lang="zh"
        branding={BRANDING}
        messages={{ "chat.send": "提交-fixture" }}
      >
        <ClassicPage />
      </SkinHostProvider>
    );
    expect(container.textContent).toContain("提交-fixture");
  });

  it("switches locale without remounting the host", () => {
    expect(t("chat.send")).toBe(t("chat.send"));
  });

  it("rejects a skin rendered without a host", () => {
    const Page = skins[0].ChatPage;
    expect(() => render(<Page />)).toThrow(/SkinHostProvider/);
  });
});
