import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFixture, makeFoldStore, makeStore } from "./fixture";

/* Orbit v2 — a fully 3D transcript. jsdom has no WebGL, so these tests
   exercise the real no-WebGL fallback path (the brief's acceptable 2D
   path); the 3D scene itself is covered by the pure model/camera tests and
   by source-level architecture assertions. three internals are never
   mocked. */

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

describe("orbit contract (v2)", () => {
  it("renders every entry kind from the fixture", () => {
    const { container } = renderOrbit(makeFixture());
    const text = container.textContent ?? "";
    expect(text).toContain("fixture user prompt");
    expect(text).toContain("fixture answer");
    expect(text).toContain("fixture approval needed");
    expect(text.toLowerCase()).toContain("fixture step one");
    expect(text.toLowerCase()).toContain("fixture subagent");
    expect(text).toContain("handoff"); // inline CUSTOM stays visible
    expect(text).toContain("web.search");
    expect(text).toContain("fixture plan");
  });

  it("picks up injected branding in the semantic header", () => {
    const { container } = renderOrbit(makeFixture());
    expect(container.querySelector(".or-hud")?.textContent).toContain("Fixture Agent");
    expect(container.querySelector(".or-hud")?.textContent).toContain("fixture-model");
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

describe("orbit no-WebGL fallback", () => {
  it("renders a readable DOM transcript and never mounts the scene canvas", () => {
    const { container } = renderOrbit(makeFixture());
    expect(container.querySelector(".skin-orbit")?.getAttribute("data-scene")).toBe("fallback");
    expect(container.querySelector(".or-fallback")).toBeTruthy();
    expect(container.querySelector(".or-sky-fallback")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("keeps the composer as the only interactive text surface with an aria-label", () => {
    const { container } = renderOrbit(makeFixture(), "en");
    const textarea = container.querySelector("textarea");
    expect(textarea?.getAttribute("aria-label")).toBe("Message composer");
    fireEvent.change(textarea as HTMLTextAreaElement, { target: { value: "hello orbit" } });
    expect((textarea as HTMLTextAreaElement).value).toBe("hello orbit");
  });

  it("exposes fold groups with counts, failure flags and keyboard operation", () => {
    const { container } = renderOrbit(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.getAttribute("aria-label")).toBeNull(); // content-derived name
    expect(head.getAttribute("aria-expanded")).toBe("false"); // settled group
    expect(head.textContent).toContain("booking.hold");
    expect(head.textContent).toContain("web.search");
    expect(head.textContent).toMatch(/\d/);
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    // members stay readable regardless of the fold override
    expect(container.textContent).toContain("thinking about the trip");
  });

  it("surfaces a failed tool inside a fold group", () => {
    const { container } = renderOrbit(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector("[data-fold-head]") as HTMLButtonElement;
    expect(head.textContent).toContain(t("fold.hasFailures"));
    expect(container.textContent).toContain("backend down");
  });
});

describe("orbit approvals (v2)", () => {
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

  it("resolves each pending card with its own id and never edits across cards", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderOrbit(store as unknown as SkinConversation);
    // v2 exemption: approvals are binary (approve/deny) — no JSON editor
    expect(container.querySelectorAll(".or-approval textarea")).toHaveLength(0);

    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.approve")));
    expect(spy).toHaveBeenLastCalledWith(true, undefined, "i1");
    fireEvent.click(buttonByText(cardByMessage(container, "approval two"), t("intr.deny")));
    expect(spy).toHaveBeenLastCalledWith(false, undefined, "i2");
    expect(spy).toHaveBeenCalledTimes(2);
    store.stop();
    spy.mockRestore();
  });

  it("Y/N answer the oldest pending card but never while typing", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderOrbit(store as unknown as SkinConversation);

    fireEvent.keyDown(container.querySelector("textarea") as HTMLTextAreaElement, { key: "y" });
    fireEvent.keyDown(container.querySelector("textarea") as HTMLTextAreaElement, { key: "n" });
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

  it("suggestions fill the composer in the fallback path", () => {
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

  it("keeps debug-class CUSTOM out of the transcript", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.CUSTOM, name: "mystery.telemetry", value: { payload: true } } as never);
      const { container } = renderOrbit(store as unknown as SkinConversation);
      expect(container.textContent).not.toContain("mystery.telemetry");
    } finally {
      store.stop();
    }
  });

  it("streams assistant tokens into the transcript", () => {
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

  it("honours reduced motion by flagging the page (fallback stays readable)", () => {
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
    expect(container.querySelector(".skin-orbit")?.getAttribute("data-reduced")).toBe("1");
    expect(container.querySelector(".or-fallback")).toBeTruthy();
  });
});

describe("orbit v2 architecture (source-level)", () => {
  const pkgSrc = (...parts: string[]) =>
    join(process.cwd(), "packages", "agui-skins", "src", ...parts);

  it("lazy-loads a three/troika scene and keeps the main entry free of them", () => {
    const index = readFileSync(pkgSrc("skins", "orbit", "index.tsx"), "utf8");
    expect(index).toContain('lazy(() => import("./OrbitScene"))');
    expect(index).not.toMatch(/from "three"/);
    expect(index).not.toMatch(/from "troika-three-text"/);
    const scene = readFileSync(pkgSrc("skins", "orbit", "OrbitScene.tsx"), "utf8");
    expect(scene).toContain('from "three"');
    expect(scene).toContain('from "troika-three-text"');
    // local error boundary + context-loss path + reduced reset hooks
    expect(index).toContain("componentDidCatch");
    expect(scene).toContain("webglcontextlost");
    expect(scene).toContain("webglcontextlost");
  });

  it("ships no Markdown parser, no protocol drawer and no DOM 3D transcript tricks", () => {
    const index = readFileSync(pkgSrc("skins", "orbit", "index.tsx"), "utf8");
    expect(index).not.toContain("shared/Markdown");
    expect(index).not.toContain("ProtocolDrawer");
    expect(index).not.toContain("perspective:");
    expect(index).toContain("sr-only");
    expect(index).toContain("data-scene-action");
  });

  it("declares troika as a dependency and keeps it external in tsup", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "packages", "agui-skins", "package.json"), "utf8"));
    expect(pkg.dependencies["troika-three-text"]).toBeTruthy();
    const tsup = readFileSync(join(process.cwd(), "packages", "agui-skins", "tsup.config.ts"), "utf8");
    expect(tsup).toMatch(/external:\s*\[[^\]]*"three"[^\]]*"troika-three-text"/s);
  });

  it("anchors the residual CSS contract (tokens, fallback sky, focus proxy, reduced motion)", () => {
    const css = readFileSync(pkgSrc("skins", "orbit", "orbit.css"), "utf8");
    expect(css).toContain("var(--sk-accent");
    expect(css).toContain(".or-sky-fallback");
    expect(css).toContain(".or-proxy:focus-visible");
    expect(css).toContain("outline-offset");
    expect(css).toContain("@keyframes or-holo-scan");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("wires the 0 key to the tenth skin without breaking the 1–9 mapping", () => {
    const app = readFileSync(join(process.cwd(), "src", "app", "App.tsx"), "utf8");
    expect(app).toContain("skinShortcutIndex(e.key)");
  });
});
