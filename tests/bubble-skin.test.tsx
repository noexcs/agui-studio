import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFixture, makeStore } from "./fixture";

/* Bubble — mobile chat surface.
   Left/right bubbles with tails, a three-dot typing indicator (with a
   reduced-motion fallback), card bubbles for approvals with per-id edit
   state, and honest status copy for all six studio statuses. ── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const skinById = (id: string) => skins.find((skin) => skin.id === id)!;

function renderBubble(conversation: SkinConversation, lang: "zh" | "en" = "zh", messages?: Record<string, string>) {
  const Page = skinById("bubble").ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING} messages={messages}>
      <Page />
    </SkinHostProvider>
  );
}

describe("bubble contract", () => {
  it("renders every entry kind from the fixture in the chat language", () => {
    const { container } = renderBubble(makeFixture());
    const text = container.textContent ?? "";
    expect(text).toContain("fixture user prompt");
    expect(container.querySelector(".bb-bubble--out")).toBeTruthy(); // user bubble, right side
    expect(container.querySelector(".bb-bubble--in")).toBeTruthy(); // assistant bubble, left side
    expect(text.toLowerCase()).toContain("web.search");
    expect(text).toContain("fixture approval needed");
    expect(container.querySelector(".bb-card--approval")).toBeTruthy();
    expect(container.querySelector(".bb-card--plan")).toBeTruthy();
    expect(container.querySelector(".bb-reason")).toBeTruthy();
    expect(text.toLowerCase()).toContain("fixture subagent");
    expect(text).toContain("handoff");
    expect(container.querySelector(".bb-topbar")?.textContent).toContain("Fixture Agent");
  });

  it("applies dictionary overrides", () => {
    const { container } = renderBubble(makeStore() as unknown as SkinConversation, "zh", { "bb.empty": "BUBBLE-EMPTY-FIXTURE" });
    expect(container.textContent).toContain("BUBBLE-EMPTY-FIXTURE");
  });

  it("rejects a skin rendered without a host", () => {
    const Page = skinById("bubble").ChatPage;
    expect(() => render(<Page />)).toThrow(/SkinHostProvider/);
  });
});

describe("bubble typing indicator", () => {
  it("shows the three-dot bubble while the agent has not said anything yet", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
      const { container } = renderBubble(store as unknown as SkinConversation);
      const typing = container.querySelector('[data-testid="bb-typing"]');
      expect(typing).toBeTruthy();
      const bubble = typing?.querySelector(".bb-typing");
      expect(bubble?.querySelectorAll("i")).toHaveLength(3);
      expect(bubble?.getAttribute("role")).toBe("status");
    } finally {
      store.stop();
    }
  });

  it("hides the indicator once streamed text fills the bubble", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
      store.dispatch({ type: EventType.TEXT_MESSAGE_START, messageId: "m1" } as never);
      store.dispatch({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "fixture streaming words" } as never);
      const { container } = renderBubble(store as unknown as SkinConversation);
      expect(container.querySelector('[data-testid="bb-typing"]')).toBeNull();
      expect(container.textContent).toContain("fixture streaming words");
    } finally {
      store.stop();
    }
  });

  it("ships a reduced-motion fallback that names the typing dots", () => {
    const cssPath = join(process.cwd(), "packages", "agui-skins", "src", "skins", "bubble", "bubble.css");
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, "utf8");
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/\.bb-typing i/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toContain("var(--sk-accent");
  });
});

describe("bubble approvals", () => {
  const ARGS_A = { hotel: "Hotel Atlantico", nights: 2 };
  const ARGS_B = { hotel: "Hotel Bairro", nights: 3 };

  function makeTwoPendingStore(): ConversationStore {
    const store = makeStore();
    const dispatch = (event: Record<string, unknown>) => store.dispatch(event as never);
    dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" });
    for (const [id, args] of [["tc_a", ARGS_A], ["tc_b", ARGS_B]] as const) {
      dispatch({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: "booking.hold" });
      dispatch({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(args) });
      dispatch({ type: EventType.TOOL_CALL_END, toolCallId: id });
    }
    dispatch({
      type: EventType.RUN_FINISHED,
      outcome: {
        type: "interrupt",
        interrupts: [
          { id: "i1", reason: "tool_call", toolCallId: "tc_a", message: "fixture approval one", details: [] },
          { id: "i2", reason: "tool_call", toolCallId: "tc_b", message: "fixture approval two", details: [] },
        ],
      },
    });
    return store;
  }

  const cardByMessage = (container: HTMLElement, message: string) => {
    const card = Array.from(container.querySelectorAll(".bb-card--approval")).find((el) => el.textContent?.includes(message));
    if (!card) throw new Error(`card "${message}" not found`);
    return card as HTMLElement;
  };
  const buttonByText = (root: HTMLElement, text: string) => {
    const button = (Array.from(root.querySelectorAll("button")) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? "").trim() === text
    );
    if (!button) throw new Error(`button "${text}" not found`);
    return button;
  };

  it("keeps edit state per interrupt id (Fix B shape)", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderBubble(store as unknown as SkinConversation);
    expect(container.querySelectorAll(".bb-edit textarea")).toHaveLength(0);

    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.edit")));
    expect(container.querySelectorAll(".bb-edit textarea")).toHaveLength(1);
    expect(cardByMessage(container, "approval two").querySelector("textarea")).toBeNull();

    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.approveEdited")));
    expect(spy).toHaveBeenLastCalledWith(true, ARGS_A, "i1");

    fireEvent.click(buttonByText(cardByMessage(container, "approval two"), t("intr.approve")));
    expect(spy).toHaveBeenLastCalledWith(true, undefined, "i2");
    expect(spy).toHaveBeenCalledTimes(2);
    store.stop();
    spy.mockRestore();
  });
});

describe("bubble status branches", () => {
  it("repaints streamed tokens end to end", () => {
    const store = makeStore();
    try {
      store.dispatch({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [{ id: "a1", role: "assistant", content: "start" }],
      } as never);
      const { container } = renderBubble(store as unknown as SkinConversation);
      act(() => {
        store.dispatch({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a1", delta: " streamed token appeared" } as never);
      });
      expect(container.textContent).toContain("streamed token appeared");
    } finally {
      store.stop();
    }
  });

  it("renders a stopped run as stopped, never idle", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.stop();
      const { container } = renderBubble(store as unknown as SkinConversation);
      const status = container.querySelector(".bb-topbar-status") as HTMLElement;
      expect(status.classList.contains("bb-topbar-status--stopped")).toBe(true);
      expect(status.textContent).toBe("已停止");
    } finally {
      store.stop();
    }
  });

  it("renders RUN_ERROR as an alert card with the error status", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderBubble(store as unknown as SkinConversation);
      expect(container.querySelector(".bb-card--error")).toBeTruthy();
      expect(container.querySelector(".bb-topbar-status--error")).toBeTruthy();
      expect(container.textContent).toContain("fixture run error message");
    } finally {
      store.stop();
    }
  });

  it("renders an expired interrupt as expired, not denied", () => {
    const store = makeStore();
    try {
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
      store.stop();
      const { container } = renderBubble(store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("已过期");
      expect(text).not.toContain("拒绝");
      expect(text.toLowerCase()).not.toContain("denied");
    } finally {
      store.stop();
    }
  });
});

describe("bubble edges", () => {
  it("keeps an empty session friendly and NaN-free", () => {
    const { container } = renderBubble(makeStore() as unknown as SkinConversation);
    expect(container.querySelector(".bb-empty")).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/NaN/);
  });

  it("renders raw content for a stepless activity instead of a NaN ratio", () => {
    const store = makeStore();
    try {
      store.dispatch({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "plan0",
        activityType: "TRACE",
        content: { note: "raw-content-note" },
      } as never);
      const { container } = renderBubble(store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("raw-content-note");
      expect(text).not.toMatch(/NaN/);
    } finally {
      store.stop();
    }
  });

  it("tool cards expand to args and results", () => {
    const { container } = renderBubble(makeFixture());
    const head = container.querySelector(".bb-tool-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    expect(container.querySelector(".bb-tool-body")?.textContent).toContain("fixture source one");
  });

  it("unknown CUSTOM reaches the protocol surface without crashing the chat", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.CUSTOM, name: "mystery.telemetry", value: { payload: true } } as never);
      const { container } = renderBubble(store as unknown as SkinConversation);
      expect(container.textContent).not.toContain("mystery.telemetry");
      expect(container.querySelector(".sk-proto-trigger")?.textContent).toContain(String(store.events.length));
    } finally {
      store.stop();
    }
  });
});
