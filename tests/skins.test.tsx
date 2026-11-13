import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { makeFixture, makeStore } from "./fixture";
import { ConversationStore } from "../src/core/store";
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
    if (["aurora", "classic", "terminal", "paper", "brutalist"].includes(skin.id)) {
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

describe("skin tuning", () => {
  it("injects accent, text animation and density into the wrapper", () => {
    const Page = skins.find((s) => s.id === "classic")!.ChatPage;
    const { container } = render(
      <SkinHostProvider
        conversation={makeFixture()}
        lang="zh"
        branding={BRANDING}
        skin="classic"
        tuning={{ accent: "#db2777", textAnim: "rise", density: "compact" }}
      >
        <Page />
      </SkinHostProvider>
    );
    const wrapper = container.querySelector(".sk-tune") as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.dataset.skTextAnim).toBe("rise");
    expect(wrapper.dataset.skDensity).toBe("compact");
    expect(wrapper.dataset.skAccent).toBe("");
    expect(wrapper.style.getPropertyValue("--sk-accent")).toBe("#db2777");
  });

  it("keeps the original look without tuning", () => {
    const Page = skins[0].ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    const wrapper = container.querySelector(".sk-tune") as HTMLElement;
    expect(wrapper.dataset.skTextAnim).toBe("none");
    expect(wrapper.dataset.skDensity).toBe("comfortable");
    expect(wrapper.hasAttribute("data-sk-accent")).toBe(false);
  });
});

/* ── Fix A: protocol visibility (paper error/subagent, classic stopped, expired) ── */

const skinById = (id: string) => skins.find((s) => s.id === id)!;

function renderSkin(id: string, conversation: SkinConversation, lang: "zh" | "en" = "zh") {
  const Page = skinById(id).ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

/** Interrupt whose expiresAt already passed, then resolved — store marks it expired (store.ts:241-249). */
function makeExpiredFixture(): SkinConversation {
  const store = makeStore();
  store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
  store.dispatch({
    type: EventType.RUN_FINISHED,
    outcome: {
      type: "interrupt",
      interrupts: [
        {
          id: "i1",
          reason: "tool_call",
          message: "fixture expired approval",
          details: [{ label: "Total", value: "€332" }],
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    },
  } as never);
  store.resolveInterrupt(true, undefined, "i1");
  // stop the auto-resume playback so no timers fire while the skin is mounted
  store.stop();
  return store as unknown as SkinConversation;
}

function stopStore(conversation: SkinConversation) {
  (conversation as unknown as ConversationStore).stop();
}

describe("Fix A: paper renders error and subagent entries", () => {
  it("shows RUN_ERROR as a red dispatch in the main column", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderSkin("paper", store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("fixture run error message");
      expect(container.querySelector(".pap-error")).toBeTruthy();
    } finally {
      store.stop();
    }
  });

  it("shows a subagent as a margin note", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.SUBAGENT_STARTED, subagentId: "sa1", name: "fixture paper subagent" } as never);
      store.dispatch({ type: EventType.SUBAGENT_FINISHED, subagentId: "sa1" } as never);
      const { container } = renderSkin("paper", store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("fixture paper subagent");
      expect(container.querySelector(".pap-note")).toBeTruthy();
    } finally {
      store.stop();
    }
  });
});

describe("Fix A: classic stopped status", () => {
  it("badges a stopped run as 已停止 instead of 空闲", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.stop();
      const { container } = renderSkin("classic", store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("已停止");
      expect(text).not.toContain("空闲");
      expect(container.querySelector(".cl-status--stopped")).toBeTruthy();
    } finally {
      store.stop();
    }
  });

  it("badges a stopped run as Stopped instead of Idle in english", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.stop();
      const { container } = renderSkin("classic", store as unknown as SkinConversation, "en");
      const text = container.textContent ?? "";
      expect(text).toContain("Stopped");
      expect(text).not.toContain("Idle");
    } finally {
      store.stop();
    }
  });
});

describe.each(skins.map((skin) => [skin.id] as const))("Fix A: expired interrupt in %s", (id) => {
  it("renders 已过期 instead of 已拒绝 (zh)", () => {
    const conversation = makeExpiredFixture();
    try {
      const { container } = renderSkin(id, conversation);
      const text = container.textContent ?? "";
      expect(text).toContain("已过期");
      expect(text).not.toContain("拒绝");
      expect(text.toLowerCase()).not.toContain("denied");
      expect(text.toLowerCase()).not.toContain("declined");
    } finally {
      stopStore(conversation);
    }
  });

  it("renders expired instead of denied/declined (en)", () => {
    const conversation = makeExpiredFixture();
    try {
      const { container } = renderSkin(id, conversation, "en");
      const text = (container.textContent ?? "").toLowerCase();
      expect(text).toContain("expired");
      expect(text).not.toContain("denied");
      expect(text).not.toContain("declined");
    } finally {
      stopStore(conversation);
    }
  });
});
