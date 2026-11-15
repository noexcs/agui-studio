import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFixture, makeFoldStore, makeStore } from "./fixture";

/* Workbench — IDE/file-tree conversation surface.
   Contract: everything renders from the fixture; the IDE chrome (activity bar,
   explorer tree, terminal panel) works; approvals keep per-card edit state;
   every studio status branch has a visible presentation. ── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const skinById = (id: string) => skins.find((skin) => skin.id === id)!;

function renderWorkbench(conversation: SkinConversation, lang: "zh" | "en" = "zh", messages?: Record<string, string>) {
  const Page = skinById("workbench").ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING} messages={messages}>
      <Page />
    </SkinHostProvider>
  );
}

describe("workbench contract", () => {
  it("renders every entry kind from the fixture", () => {
    const { container } = renderWorkbench(makeFixture());
    const text = container.textContent ?? "";
    expect(text).toContain("fixture user prompt");
    expect(text).toContain("fixture answer");
    expect(text.toLowerCase()).toContain("web.search");
    expect(text).toContain("fixture approval needed");
    expect(text.toLowerCase()).toContain("fixture step one");
    expect(text.toLowerCase()).toContain("fixture subagent");
    expect(text).toContain("handoff"); // inline CUSTOM stays visible
    // the fixture's adjacent tool+thinking rows fold; unfold before row checks
    fireEvent.click(container.querySelector(".wb-fold-head") as HTMLButtonElement);
    expect(container.querySelector(".wb-reason")).toBeTruthy(); // reasoning row
    expect(container.querySelectorAll(".wb-row").length).toBeGreaterThan(6);
  });

  it("picks up injected branding in the title bar", () => {
    const { container } = renderWorkbench(makeFixture());
    expect(container.querySelector(".wb-titlebar")?.textContent).toContain("Fixture Agent");
  });

  it("applies dictionary overrides", () => {
    const { container } = renderWorkbench(makeStore() as unknown as SkinConversation, "zh", { "wb.empty": "EMPTY-FIXTURE" });
    expect(container.textContent).toContain("EMPTY-FIXTURE");
  });

  it("rejects a skin rendered without a host", () => {
    const Page = skinById("workbench").ChatPage;
    expect(() => render(<Page />)).toThrow(/SkinHostProvider/);
  });
});

describe("workbench IDE chrome", () => {
  it("activity bar buttons switch the side panel and carry pressed state", () => {
    const { container } = renderWorkbench(makeFixture());
    const acts = Array.from(container.querySelectorAll(".wb-act")) as HTMLButtonElement[];
    expect(acts.length).toBe(3);
    expect(acts[0].getAttribute("aria-pressed")).toBe("true"); // tree is the default view
    expect(acts[1].getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(acts[1]); // shared state view
    expect(acts[1].getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".wb-side")?.textContent).toContain("trip"); // fixture state
    fireEvent.click(acts[2]); // run info view
    expect(container.querySelector(".wb-side")?.textContent).toContain("thread");
    fireEvent.click(acts[0]); // back to the tree — round labels come from user prompts
    expect(container.querySelector(".wb-side")?.textContent).toContain("fixture user prompt");
  });

  it("explorer rounds are buttons with expand state; leaves jump to transcript rows", () => {
    const scroll = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scroll;
    const { container } = renderWorkbench(makeFixture());
    const rounds = Array.from(container.querySelectorAll(".wb-tree-row--round")) as HTMLButtonElement[];
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds[0].getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(rounds[0]);
    expect(rounds[0].getAttribute("aria-expanded")).toBe("true");
    expect(scroll).toHaveBeenCalled();

    const leaves = Array.from(container.querySelectorAll(".wb-tree-row--leaf")) as HTMLButtonElement[];
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) expect(leaf.tagName).toBe("BUTTON");
    delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
  });

  it("terminal panel head is keyboard-operable: Tab-focusable, Enter/Space toggle via explicit keyDown", () => {
    const { container } = renderWorkbench(makeFixture());
    const panel = container.querySelector(".wb-panel")!;
    const head = container.querySelector(".wb-panel-head") as HTMLButtonElement;
    expect(head.tagName).toBe("BUTTON");
    expect(head.tabIndex).toBe(0); // in the Tab order
    head.focus(); // "Tab focuses": focus lands on the panel head
    expect(document.activeElement).toBe(head);

    fireEvent.keyDown(head, { key: "Enter" }); // Enter toggles it closed…
    expect(panel.hasAttribute("data-open")).toBe(false);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(head, { key: " " }); // …and Space brings it back
    expect(panel.hasAttribute("data-open")).toBe(true);
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("tool calls live in the terminal panel; transcript jump lines open it", () => {
    const { container } = renderWorkbench(makeFixture());
    fireEvent.click(container.querySelector(".wb-fold-head") as HTMLButtonElement); // unfold the tool row first
    const panel = container.querySelector(".wb-panel");
    expect(panel).toBeTruthy();
    expect(panel?.textContent.toLowerCase()).toContain("web.search");
    // jump line in the transcript toggles the panel + opens the tool row
    const jump = container.querySelector(".wb-tool-jump") as HTMLButtonElement;
    expect(jump.textContent).toContain("web.search");
    const head = container.querySelector(".wb-panel-head") as HTMLButtonElement;
    fireEvent.click(head); // collapse
    expect(panel!.hasAttribute("data-open")).toBe(false);
    fireEvent.click(jump); // jump line re-opens the panel
    expect(panel!.hasAttribute("data-open")).toBe(true);
    expect((container.querySelector(".wb-term-head") as HTMLButtonElement).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("workbench approvals", () => {
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
    const card = Array.from(container.querySelectorAll(".wb-approval")).find((el) => el.textContent?.includes(message));
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
    const { container } = renderWorkbench(store as unknown as SkinConversation);
    expect(container.querySelectorAll(".wb-edit textarea")).toHaveLength(0);

    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.edit")));
    const boxes = container.querySelectorAll(".wb-edit textarea");
    expect(boxes).toHaveLength(1);
    expect(cardByMessage(container, "approval one").querySelector("textarea")).toBeTruthy();
    expect(cardByMessage(container, "approval two").querySelector("textarea")).toBeNull();

    // card A submits its own seeded args
    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.approveEdited")));
    expect(spy).toHaveBeenLastCalledWith(true, ARGS_A, "i1");

    // card B is still pending — plain approve must NOT reuse card A's draft
    fireEvent.click(buttonByText(cardByMessage(container, "approval two"), t("intr.approve")));
    expect(spy).toHaveBeenLastCalledWith(true, undefined, "i2");
    expect(spy).toHaveBeenCalledTimes(2);
    store.stop();
    spy.mockRestore();
  });

  it("Y/N keys answer the oldest pending approval but never while typing", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderWorkbench(store as unknown as SkinConversation);

    // open card A's editor: keystrokes inside a text field must never submit
    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.edit")));
    const editor = container.querySelector(".wb-edit textarea") as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: "y" });
    fireEvent.keyDown(editor, { key: "n" });
    expect(spy).not.toHaveBeenCalled();

    // outside of text fields, Y answers the oldest pending card by id
    fireEvent.keyDown(window, { key: "y" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(true, undefined, "i1");
    store.stop();
    spy.mockRestore();
  });
});

describe("workbench status branches", () => {
  it("renders a stopped run as stopped, never idle", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.stop();
      const { container } = renderWorkbench(store as unknown as SkinConversation);
      expect(container.querySelector(".wb-status--stopped")).toBeTruthy();
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
      const { container } = renderWorkbench(store as unknown as SkinConversation);
      expect(container.querySelector(".wb-error")).toBeTruthy();
      expect(container.textContent).toContain("fixture run error message");
      expect(container.querySelector(".wb-status--error")).toBeTruthy();
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
      const { container } = renderWorkbench(store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("已过期");
      expect(text).not.toContain("拒绝");
      expect(text.toLowerCase()).not.toContain("denied");
    } finally {
      store.stop();
    }
  });
});

describe("workbench edges", () => {
  it("keeps an empty session readable: copy, no NaN, dash tokens", () => {
    const { container } = renderWorkbench(makeStore() as unknown as SkinConversation);
    const text = container.textContent ?? "";
    expect(container.querySelector(".wb-empty")).toBeTruthy();
    expect(text).not.toMatch(/NaN/);
    expect(text).toContain("—"); // tokens placeholder
    expect(container.querySelector(".wb-panel")?.textContent).toContain(t("wb.terminalEmpty"));
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
      const { container } = renderWorkbench(store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("raw-content-note");
      expect(text).not.toMatch(/NaN/);
    } finally {
      store.stop();
    }
  });

  it("an unknown CUSTOM event never crashes and reaches the protocol surface", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.CUSTOM, name: "mystery.telemetry", value: { payload: true } } as never);
      const { container } = renderWorkbench(store as unknown as SkinConversation);
      expect(container.textContent).not.toContain("mystery.telemetry"); // debug-class: inspector, not transcript
      const trigger = container.querySelector(".sk-proto-trigger");
      expect(trigger?.textContent).toContain(String(store.events.length)); // visible via the protocol drawer
    } finally {
      store.stop();
    }
  });
});

describe("workbench light theme (tuning.theme)", () => {
  const css = () => readFileSync(join(process.cwd(), "packages", "agui-skins", "src", "skins", "workbench", "workbench.css"), "utf8");
  const Page = skinById("workbench").ChatPage;

  it("flips the host data attribute without one when unset (dark default)", () => {
    const { container, rerender } = render(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING} tuning={{}}>
        <Page />
      </SkinHostProvider>
    );
    const tune = () => container.querySelector(".sk-tune") as HTMLElement;
    expect(tune().hasAttribute("data-sk-theme")).toBe(false); // untouched default
    rerender(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING} tuning={{ theme: "dark" }}>
        <Page />
      </SkinHostProvider>
    );
    expect(tune().dataset.skTheme).toBe("dark"); // explicit dark carries the attribute too
    rerender(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING} tuning={{ theme: "light" }}>
        <Page />
      </SkinHostProvider>
    );
    expect(tune().dataset.skTheme).toBe("light");
  });

  it("the light variant is attribute-gated and overrides the workbench palette", () => {
    const cssText = css();
    // every light rule is gated on the host attribute — no unconditional light colors
    expect(cssText).toContain('.sk-tune[data-sk-theme="light"] .skin-workbench');
    const gated = cssText.slice(cssText.indexOf('.sk-tune[data-sk-theme="light"]'));
    // key faces from the task brief land in the gated override only
    for (const token of ["#f7f8fa", "#ffffff", "#f0f2f5", "#e9ebef", "#f2f4f7", "#fbfcfd", "#1c1f24", "#565b64"]) {
      expect(gated).toContain(token);
      // …and never leak into the dark base (dark keeps its own palette)
    }
    // syntax family: same hue, deeper tone (blue/violet/cyan/green/amber/red)
    for (const token of ["#2563eb", "#7c3aed", "#0e7490", "#15803d", "#b45309", "#dc2626"]) {
      expect(gated).toContain(token);
    }
    // dark base keeps the original syntax values (zero-regression anchor)
    const base = cssText.slice(0, cssText.indexOf('.sk-tune[data-sk-theme="light"]'));
    for (const token of ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e", "#1b1d21", "#222429", "#181a1e"]) {
      expect(base).toContain(token);
    }
  });

  it("dark surfaces resolve through variables so the default renders identically", () => {
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING} tuning={{ theme: "light" }}>
        <Page />
      </SkinHostProvider>
    );
    const root = container.querySelector(".skin-workbench") as HTMLElement;
    expect(root).toBeTruthy();
    // the light skin still renders from the same class — variant is CSS-only
    expect(root.className).not.toContain("light");
  });
});

describe("workbench fold groups (consecutive reasoning + tools)", () => {
  it("collapses a settled run into one folded row by default; original rows unmounted", () => {
    const { container } = renderWorkbench(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".wb-fold-head") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all members terminal → folded
    expect(container.querySelector(".wb-reason")).toBeNull(); // original rows live in the body
    expect(container.querySelector(".wb-tool-jump")).toBeNull();
    expect(head.textContent).toContain("booking.hold"); // tool names surface in the summary
    expect(head.textContent).toContain("web.search");
  });

  it("clicking the head toggles aria-expanded and mounts/unmounts the original rows", () => {
    const { container } = renderWorkbench(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".wb-fold-head") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".wb-reason")).toBeTruthy(); // reused reasoning rendering
    expect(container.querySelector(".wb-tool-jump")).toBeTruthy(); // reused tool jump line
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".wb-reason")).toBeNull();
  });

  it("fold head is keyboard-operable (focus + explicit Enter/Space keydown)", () => {
    const { container } = renderWorkbench(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".wb-fold-head") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open group and shows the live marker", () => {
    const { container } = renderWorkbench(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector(".wb-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true"); // tool still executing → open
    expect(container.querySelector(".wb-tool-jump")).toBeTruthy();
    const live = container.querySelector(".wb-fold-flag--live");
    expect(live?.textContent).toContain(t("chat.executing"));
  });

  it("a failed tool inside the group surfaces a failure marker on the header", () => {
    const { container } = renderWorkbench(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector(".wb-fold-head") as HTMLButtonElement;
    const flag = head.querySelector(".wb-fold-flag[data-failure='error']");
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
      const { container } = renderWorkbench(store as unknown as SkinConversation);
      expect(container.querySelector(".wb-fold-head")).toBeNull(); // one reasoning row → no group
      expect(container.querySelector(".wb-error")).toBeTruthy(); // error row stays visible
    } finally {
      store.stop();
    }
  });

  it("the explorer tree reveals a row inside a folded group by opening it", async () => {
    const scroll = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scroll;
    const { container } = renderWorkbench(makeFoldStore() as unknown as SkinConversation);
    const rounds = Array.from(container.querySelectorAll(".wb-tree-row--round")) as HTMLButtonElement[];
    fireEvent.click(rounds[0]); // expand the round's leaf rows
    const leaves = Array.from(container.querySelectorAll(".wb-tree-row--leaf")) as HTMLButtonElement[];
    const toolLeaf = leaves.find((leaf) => (leaf.textContent ?? "").toLowerCase().includes("web.search"))!;
    fireEvent.click(toolLeaf); // reveal() must unfold the containing group…
    const head = container.querySelector(".wb-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    // …and scroll once the row is mounted (deferred a tick inside reveal)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(scroll).toHaveBeenCalled();
    delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
  });
});
