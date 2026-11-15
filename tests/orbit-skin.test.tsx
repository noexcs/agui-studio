import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFixture, makeFoldStore, makeStore } from "./fixture";

/* Orbit — deep-space 3D skin. Contract: every entry renders from the same
   fixture as the other nine skins; the Three canvas + CSS starfield are both
   present; the depth layers, fold panels, per-id approval edits, expired
   interrupts and all six statuses have explicit presentations. The Three
   internals are intentionally not mocked: jsdom has no WebGL, so the real
   component takes its built-in fallback path. */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const skinById = (id: string) => skins.find((skin) => skin.id === id)!;

function renderOrbit(
  conversation: SkinConversation,
  lang: "zh" | "en" = "zh",
  messages?: Record<string, string>
) {
  const Page = skinById("orbit").ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING} messages={messages}>
      <Page />
    </SkinHostProvider>
  );
}

describe("orbit contract", () => {
  it("renders every entry kind from the fixture", () => {
    const { container } = renderOrbit(makeFixture());
    let text = container.textContent ?? "";
    expect(text).toContain("fixture user prompt");
    expect(text).toContain("fixture answer");
    expect(text).toContain("fixture approval needed");
    expect(text.toLowerCase()).toContain("fixture step one");
    expect(text.toLowerCase()).toContain("fixture subagent");
    expect(text).toContain("handoff"); // inline CUSTOM stays visible

    // the fixture's adjacent tool+thinking run is a folded holo panel
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    expect(head).toBeTruthy();
    fireEvent.click(head);
    expect(container.querySelector(".or-reason")).toBeTruthy();
    expect(container.querySelector(".or-tool")).toBeTruthy();
    expect((container.textContent ?? "").toLowerCase()).toContain("web.search");
    // plan entry from the fixture
    expect(container.querySelector(".or-plan")?.textContent).toContain("fixture plan");
  });

  it("picks up injected branding in the HUD header", () => {
    const { container } = renderOrbit(makeFixture());
    expect(container.querySelector(".or-hud")?.textContent).toContain("Fixture Agent");
  });

  it("applies dictionary overrides to the empty state", () => {
    const { container } = renderOrbit(makeStore() as unknown as SkinConversation, "zh", {
      "or.emptyTitle": "EMPTY-FIXTURE",
    });
    expect(container.textContent).toContain("EMPTY-FIXTURE");
  });

  it("rejects a skin rendered without a host", () => {
    const Page = skinById("orbit").ChatPage;
    expect(() => render(<Page />)).toThrow(/SkinHostProvider/);
  });
});

describe("orbit sky and 3D structure", () => {
  it("mounts the lazy Three canvas and the CSS starfield fallback", async () => {
    const { container } = renderOrbit(makeFixture());
    expect(container.querySelector(".or-sky")).toBeTruthy();
    expect(container.querySelector(".or-sky-fallback")).toBeTruthy();
    // the canvas element is rendered by the lazily imported module; WebGL is
    // absent in jsdom, so the component immediately takes onFail
    await waitFor(() => {
      expect(container.querySelector("canvas.or-sky-canvas")).toBeTruthy();
    });
  });

  it("lays the transcript out in perspective with the documented depth table", () => {
    const { container } = renderOrbit(makeFixture());
    const feed = container.querySelector(".or-feed") as HTMLElement;
    expect(feed.className).toContain("perspective:1200px");
    expect(container.querySelector('[data-kind="user"]')?.getAttribute("data-depth")).toBe("far");
    expect(container.querySelector('[data-kind="assistant"]')?.getAttribute("data-depth")).toBe("near");
    expect(container.querySelector('[data-kind="fold"]')?.getAttribute("data-depth")).toBe("holo");
    expect(container.querySelector('[data-kind="interrupt"]')?.getAttribute("data-depth")).toBe("front");
    expect(container.querySelector('.or-feed [data-kind="user"]')?.className).toContain("translateZ(-120px)");
    expect(container.querySelector('[data-kind="interrupt"]')?.className).toContain("translateZ(80px)");
  });

  it("tilts the composer tray but keeps its content facing the lens", () => {
    const { container } = renderOrbit(makeFixture());
    const dock = container.querySelector(".or-dock") as HTMLElement;
    expect(dock.className).toContain("rotateX(18deg)");
    const face = dock.firstElementChild as HTMLElement;
    expect(face.className).toContain("rotateX(-18deg)");
  });

  it("anchors reduced motion, focus and accent guarding in orbit.css", () => {
    const css = readFileSync(
      join(process.cwd(), "packages", "agui-skins", "src", "skins", "orbit", "orbit.css"),
      "utf8"
    );
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline-offset");
    expect(css).toContain("var(--sk-accent");
    expect(css).toContain("@keyframes or-blink");
    expect(css).toContain(".or-sky-fallback");
  });

  it("skips the Three module under prefers-reduced-motion and shows CSS stars", () => {
    const listeners = new Set<() => void>();
    const mql = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(mql as unknown as MediaQueryList);

    const { container } = renderOrbit(makeFixture(), "en");
    expect(container.querySelector(".or-sky-fallback")).toBeTruthy();
    expect(container.querySelector("canvas.or-sky-canvas")).toBeNull();
  });
});

describe("orbit fold groups (holo panels)", () => {
  it("collapses a settled run into one panel by default", () => {
    const { container } = renderOrbit(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all members terminal
    expect(head.textContent).toContain("booking.hold");
    expect(head.textContent).toContain("web.search");
    expect(head.textContent).toContain(t("fold.thinking"));
    expect(container.querySelector(".or-tool")).toBeNull(); // members unmounted
    expect(container.querySelector(".or-reason")).toBeNull();
  });

  it("clicking the head mounts the original rows and toggles aria-expanded", () => {
    const { container } = renderOrbit(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".or-reason")).toBeTruthy();
    expect(container.querySelector(".or-tool")).toBeTruthy();
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".or-tool")).toBeNull();
  });

  it("is keyboard-operable (focus + explicit Enter/Space)", () => {
    const { container } = renderOrbit(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open panel with the live marker", () => {
    const { container } = renderOrbit(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(head.textContent).toContain(t("chat.executing"));
  });

  it("a failed tool inside the panel surfaces the failure flag", () => {
    const { container } = renderOrbit(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    const flag = head.querySelector('[data-failure="error"]');
    expect(flag).toBeTruthy();
    expect(flag?.textContent).toContain(t("fold.hasFailures"));
  });

  it("singletons stay ungrouped and error rows remain independent", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_START, messageId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r1" } as never);
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderOrbit(store as unknown as SkinConversation);
      expect(container.querySelector("[data-fold-head]")).toBeNull();
      expect(container.querySelector(".or-error-row")).toBeTruthy();
    } finally {
      store.stop();
    }
  });
});

describe("orbit approvals", () => {
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
    const card = Array.from(container.querySelectorAll(".or-approval")).find((el) =>
      el.textContent?.includes(message)
    );
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
    const { container } = renderOrbit(store as unknown as SkinConversation);
    expect(container.querySelectorAll(".or-approval textarea")).toHaveLength(0);

    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.edit")));
    expect(container.querySelectorAll(".or-approval textarea")).toHaveLength(1);
    expect(cardByMessage(container, "approval one").querySelector("textarea")).toBeTruthy();
    expect(cardByMessage(container, "approval two").querySelector("textarea")).toBeNull();

    const editor = cardByMessage(container, "approval one").querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"hotel":"A was edited"}' } });
    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.approveEdited")));
    expect(spy).toHaveBeenLastCalledWith(true, { hotel: "A was edited" }, "i1");

    // card B submits its own args and never reuses A's draft
    fireEvent.click(buttonByText(cardByMessage(container, "approval two"), t("intr.approve")));
    expect(spy).toHaveBeenLastCalledWith(true, undefined, "i2");
    expect(spy).toHaveBeenCalledTimes(2);
    store.stop();
    spy.mockRestore();
  });

  it("seeds card B with its own tool args", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderOrbit(store as unknown as SkinConversation);
    fireEvent.click(buttonByText(cardByMessage(container, "approval two"), t("intr.edit")));
    const textarea = cardByMessage(container, "approval two").querySelector("textarea") as HTMLTextAreaElement;
    expect(JSON.parse(textarea.value)).toEqual(ARGS_B);
    fireEvent.click(buttonByText(cardByMessage(container, "approval two"), t("intr.approveEdited")));
    expect(spy).toHaveBeenCalledWith(true, ARGS_B, "i2");
    store.stop();
    spy.mockRestore();
  });

  it("Y/N answer the oldest pending card but never while typing", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderOrbit(store as unknown as SkinConversation);

    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.edit")));
    const editor = cardByMessage(container, "approval one").querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: "y" });
    fireEvent.keyDown(editor, { key: "n" });
    expect(spy).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "y" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(true, undefined, "i1");
    store.stop();
    spy.mockRestore();
  });

  it("renders an expired interrupt as expired, never as denied", () => {
    for (const lang of ["zh", "en"] as const) {
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
        const { container, unmount } = renderOrbit(store as unknown as SkinConversation, lang);
        const text = container.textContent ?? "";
        if (lang === "zh") {
          expect(text).toContain("已过期");
          expect(text).not.toContain("拒绝");
        } else {
          expect(text.toLowerCase()).toContain("expired");
          expect(text.toLowerCase()).not.toContain("denied");
          expect(text.toLowerCase()).not.toContain("declined");
        }
        expect(container.querySelector('[data-state="expired"]')).toBeTruthy();
        unmount();
      } finally {
        store.stop();
      }
    }
  });
});

describe("orbit statuses and edges", () => {
  it("renders a stopped run as stopped, never idle", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.stop();
      const { container } = renderOrbit(store as unknown as SkinConversation);
      expect(container.querySelector(".or-status")?.getAttribute("data-status")).toBe("stopped");
      expect(container.textContent).toContain("已停止");
      expect(container.textContent).not.toContain("空闲");
    } finally {
      store.stop();
    }
  });

  it("renders RUN_ERROR as an alert row and an error status", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderOrbit(store as unknown as SkinConversation);
      expect(container.querySelector(".or-error-row")?.getAttribute("role")).toBe("alert");
      expect(container.textContent).toContain("fixture run error message");
      expect(container.querySelector(".or-status")?.getAttribute("data-status")).toBe("error");
    } finally {
      store.stop();
    }
  });

  it("keeps an empty session readable: empty state, no NaN, dash tokens", () => {
    const { container } = renderOrbit(makeStore() as unknown as SkinConversation);
    const text = container.textContent ?? "";
    expect(container.querySelector(".or-empty")).toBeTruthy();
    expect(text).not.toMatch(/NaN/);
    expect(text).toContain("—");
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
      const { container } = renderOrbit(store as unknown as SkinConversation);
      expect(container.textContent).toContain("raw-content-note");
      expect(container.textContent).not.toMatch(/NaN/);
    } finally {
      store.stop();
    }
  });

  it("suggestions fill the composer instead of dead-ending", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.CUSTOM, name: "suggestions", value: ["suggestion-one"] } as never);
      const { container } = renderOrbit(store as unknown as SkinConversation);
      const chip = Array.from(container.querySelectorAll(".or-suggestions button")).find((el) =>
        el.textContent?.includes("suggestion-one")
      ) as HTMLButtonElement;
      expect(chip).toBeTruthy();
      fireEvent.click(chip);
      expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("suggestion-one");
    } finally {
      store.stop();
    }
  });

  it("keeps debug-class CUSTOM in the protocol drawer, not the transcript", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.CUSTOM, name: "mystery.telemetry", value: { payload: true } } as never);
      const { container } = renderOrbit(store as unknown as SkinConversation);
      expect(container.textContent).not.toContain("mystery.telemetry");
      expect(container.querySelector(".sk-proto-trigger")?.textContent).toContain(String(store.events.length));
    } finally {
      store.stop();
    }
  });

  it("streams assistant tokens into the near panel", () => {
    const store = new ConversationStore(false);
    try {
      store.dispatch({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [{ id: "a1", role: "assistant", content: "start" }],
      } as never);
      const { container } = renderOrbit(store as unknown as SkinConversation);
      act(() => {
        store.dispatch({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "a1",
          delta: " streaming token appeared",
        } as never);
      });
      expect(container.textContent).toContain("streaming token appeared");
    } finally {
      store.stop();
    }
  });
});
