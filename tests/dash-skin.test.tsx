import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFixture, makeFoldStore, makeStore } from "./fixture";

/* Dash — light ops-dashboard surface.
   KPI strip reads the store without ever producing NaN; tools are data rows;
   approvals keep per-card edit state; all six statuses have presentations. ── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const skinById = (id: string) => skins.find((skin) => skin.id === id)!;

function renderDash(conversation: SkinConversation, lang: "zh" | "en" = "zh", messages?: Record<string, string>) {
  const Page = skinById("dash").ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING} messages={messages}>
      <Page />
    </SkinHostProvider>
  );
}

describe("dash contract", () => {
  it("renders every entry kind from the fixture", () => {
    const { container } = renderDash(makeFixture());
    const text = container.textContent ?? "";
    expect(text).toContain("fixture user prompt");
    expect(text).toContain("fixture answer");
    expect(text).toContain("fixture approval needed");
    expect(text.toLowerCase()).toContain("fixture step one");
    expect(text.toLowerCase()).toContain("fixture subagent");
    expect(text).toContain("handoff");
    fireEvent.click(container.querySelector(".ds-fold-head") as HTMLButtonElement); // unfold the tool+thinking run
    expect((container.textContent ?? "").toLowerCase()).toContain("web.search"); // tool name lives in its (unfurled) row
    expect(container.querySelector(".ds-reason")).toBeTruthy();
    // branding lands in the header
    expect(container.querySelector(".ds-header")?.textContent).toContain("Fixture Agent");
  });

  it("applies dictionary overrides", () => {
    const { container } = renderDash(makeStore() as unknown as SkinConversation, "zh", { "ds.empty": "DASH-EMPTY-FIXTURE" });
    expect(container.textContent).toContain("DASH-EMPTY-FIXTURE");
  });

  it("rejects a skin rendered without a host", () => {
    const Page = skinById("dash").ChatPage;
    expect(() => render(<Page />)).toThrow(/SkinHostProvider/);
  });
});

describe("dash KPI strip", () => {
  it("shows dashes and zero-safe values on an empty store, never NaN", () => {
    const { container } = renderDash(makeStore() as unknown as SkinConversation);
    const text = container.textContent ?? "";
    expect(container.querySelectorAll(".ds-kpi")).toHaveLength(4);
    expect(text).not.toMatch(/NaN/);
    expect(text).toContain("—"); // tokens / duration placeholders
    expect(container.querySelector(".ds-empty")).toBeTruthy();
  });

  it("populates the four tiles from a finished fixture", () => {
    const { container } = renderDash(makeFixture());
    const tiles = Array.from(container.querySelectorAll(".ds-kpi-value")).map((el) => el.textContent ?? "");
    expect(tiles[0]).toBe(t("status.interrupted"));
    expect(tiles[2]).toBe("1"); // one tool call in the fixture
    expect(tiles[3]).toBe("—"); // the fixture ships no usage event — dash, not NaN
    expect(container.querySelector('.ds-kpi[data-status="interrupted"]')).toBeTruthy();
  });

  it("reads the usage CUSTOM event into the tokens tile", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.CUSTOM, name: "usage", value: { totalTokens: 12345 } } as never);
      const { container } = renderDash(store as unknown as SkinConversation);
      const tiles = Array.from(container.querySelectorAll(".ds-kpi-value")).map((el) => el.textContent ?? "");
      expect(tiles[3]).toBe("12.3k");
    } finally {
      store.stop();
    }
  });

  it("flags failed tools in the tool tile", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
      store.dispatch({ type: EventType.TOOL_CALL_START, toolCallId: "tc", toolCallName: "weather.forecast" } as never);
      store.dispatch({ type: EventType.TOOL_CALL_ARGS, toolCallId: "tc", delta: "{}" } as never);
      store.dispatch({ type: EventType.TOOL_CALL_END, toolCallId: "tc" } as never);
      const tool = store.entries.find((e): e is ToolEntryLike => e.kind === "tool");
      if (tool) tool.status = "error";
      const { container } = renderDash(store as unknown as SkinConversation);
      const toolTile = container.querySelectorAll(".ds-kpi")[2] as HTMLElement;
      expect(toolTile.textContent).toContain("1");
      expect(toolTile.textContent).toContain(t("ds.failed"));
    } finally {
      store.stop();
    }
  });
});

type ToolEntryLike = { kind: "tool"; status: string };

describe("dash approvals", () => {
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
    const card = Array.from(container.querySelectorAll(".ds-approval")).find((el) => el.textContent?.includes(message));
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
    const { container } = renderDash(store as unknown as SkinConversation);
    expect(container.querySelectorAll(".ds-edit textarea")).toHaveLength(0);

    fireEvent.click(buttonByText(cardByMessage(container, "approval one"), t("intr.edit")));
    expect(container.querySelectorAll(".ds-edit textarea")).toHaveLength(1);
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

describe("dash status branches", () => {
  it("renders a stopped run as stopped, never idle", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.stop();
      const { container } = renderDash(store as unknown as SkinConversation);
      expect(container.querySelector(".ds-pill--stopped")).toBeTruthy();
      expect(container.textContent).toContain("已停止");
      expect(container.textContent).not.toContain("空闲");
    } finally {
      store.stop();
    }
  });

  it("renders RUN_ERROR as an alert row with the error status", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderDash(store as unknown as SkinConversation);
      expect(container.querySelector(".ds-error")).toBeTruthy();
      expect(container.textContent).toContain("fixture run error message");
      expect(container.querySelector(".ds-pill--error")).toBeTruthy();
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
      const { container } = renderDash(store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("已过期");
      expect(text).not.toContain("拒绝");
      expect(text.toLowerCase()).not.toContain("denied");
    } finally {
      store.stop();
    }
  });
});

describe("dash edges and chrome", () => {
  it("renders raw content for a stepless activity instead of a NaN ratio", () => {
    const store = makeStore();
    try {
      store.dispatch({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "plan0",
        activityType: "TRACE",
        content: { note: "raw-content-note" },
      } as never);
      const { container } = renderDash(store as unknown as SkinConversation);
      const text = container.textContent ?? "";
      expect(text).toContain("raw-content-note");
      expect(text).not.toMatch(/NaN/);
    } finally {
      store.stop();
    }
  });

  it("tool data rows expand to args and results", () => {
    const { container } = renderDash(makeFixture());
    fireEvent.click(container.querySelector(".ds-fold-head") as HTMLButtonElement); // unfold the tool row first
    const row = container.querySelector(".ds-tool-row") as HTMLButtonElement;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(container.querySelector(".ds-tool-body")).toBeTruthy();
    expect(container.querySelector(".ds-tool-body")?.textContent).toContain("fixture source one");
  });

  it("unknown CUSTOM reaches the protocol surface without crashing the feed", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.CUSTOM, name: "mystery.telemetry", value: { payload: true } } as never);
      const { container } = renderDash(store as unknown as SkinConversation);
      expect(container.textContent).not.toContain("mystery.telemetry");
      expect(container.querySelector(".sk-proto-trigger")?.textContent).toContain(String(store.events.length));
    } finally {
      store.stop();
    }
  });

  it("ships its own :focus-visible and prefers-reduced-motion guards", () => {
    const cssPath = join(process.cwd(), "packages", "agui-skins", "src", "skins", "dash", "dash.css");
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toContain("var(--sk-accent");
  });
});

describe("dash fold groups (consecutive reasoning + tools)", () => {
  it("collapses a settled run into one numeric fold row by default", () => {
    const { container } = renderDash(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".ds-fold-head") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all terminal → folded
    expect(head.textContent).toContain(`4 ${t("fold.steps")}`); // numeric summary: N steps
    expect(container.querySelector(".ds-reason")).toBeNull(); // original rows live in the body
    expect(container.querySelector(".ds-tool")).toBeNull();
  });

  it("clicking the head toggles aria-expanded and mounts/unmounts the original rows", () => {
    const { container } = renderDash(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".ds-fold-head") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".ds-reason")).toBeTruthy(); // reused thinking row
    expect(container.querySelector(".ds-tool")).toBeTruthy(); // reused tool data row
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".ds-reason")).toBeNull();
  });

  it("fold head is keyboard-operable (focus + explicit Enter/Space keydown)", () => {
    const { container } = renderDash(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".ds-fold-head") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open group with the live marker", () => {
    const { container } = renderDash(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector(".ds-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true"); // tool executing → open
    expect(container.querySelector(".ds-fold-head .ds-stage--running")).toBeTruthy();
  });

  it("a failed tool inside the group surfaces a failure chip on the row", () => {
    const { container } = renderDash(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector(".ds-fold-head") as HTMLButtonElement;
    const chip = head.querySelector(".ds-stage--error");
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain(t("fold.hasFailures"));
  });

  it("singletons stay ungrouped and error rows remain independent", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_START, messageId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r1" } as never);
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderDash(store as unknown as SkinConversation);
      expect(container.querySelector(".ds-fold-head")).toBeNull(); // one reasoning row → no group
      expect(container.querySelector(".ds-error")).toBeTruthy();
    } finally {
      store.stop();
    }
  });
});
