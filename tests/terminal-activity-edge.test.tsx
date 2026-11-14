import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore, type InterruptEntry, type ToolEntry } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFixture, makeStore } from "./fixture";
import { Home, skinCountWord, type HomeSkin } from "../src/shell/Home";

/* ── Fix C: presentation & copy batch. One test file per brief item group:
   terminal NaN%/done-status/edit-entry, brutalist subagent+empty state,
   classic multi-plan + dead buttons, suggestions (P.S. card + chips),
   Home count copy, and zh i18n leak assertions. ─────────────────────── */

afterEach(() => {
  cleanup();
  currentStore?.stop();
  currentStore = null;
});

let currentStore: ConversationStore | null = null;
const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const skinById = (id: string) => skins.find((s) => s.id === id)!;

function track(store: ConversationStore) {
  currentStore = store;
  return store;
}

function renderSkin(id: string, conversation: SkinConversation, lang: "zh" | "en" = "zh") {
  const Page = skinById(id).ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

const dispatch = (store: ConversationStore, event: Record<string, unknown>) => store.dispatch(event as never);
const buttonByText = (root: HTMLElement, text: string): HTMLButtonElement => {
  const buttons = Array.from(root.querySelectorAll("button")) as HTMLButtonElement[];
  const button =
    buttons.find((b) => (b.textContent ?? "").trim() === text) ?? buttons.find((b) => (b.textContent ?? "").includes(text));
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
};

const addSuggestions = (store: ConversationStore, value: string[]) => {
  dispatch(store, { type: EventType.CUSTOM, name: "suggestions", value });
};

/** Two tool calls with distinct args, both held open by a pending interrupt. */
function makeTwoPendingStore(): ConversationStore {
  const store = track(makeStore());
  dispatch(store, { type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" });
  const calls: [string, Record<string, unknown>][] = [
    ["tc_a", { hotel: "Hotel Atlantico", nights: 2 }],
    ["tc_b", { hotel: "Hotel Bairro", nights: 3 }],
  ];
  for (const [id, args] of calls) {
    dispatch(store, { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: "booking.hold" });
    dispatch(store, { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(args) });
    dispatch(store, { type: EventType.TOOL_CALL_END, toolCallId: id });
  }
  dispatch(store, {
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

/* ── item 1: terminal NaN% ─────────────────────────────────────────── */

describe("Fix C: terminal zero-step activity (NaN% bug)", () => {
  it("renders entry.content instead of a NaN meter for a stepless activity", () => {
    const store = track(makeStore());
    dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    dispatch(store, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "act1",
      activityType: "PROGRESS",
      content: { note: "fixture activity payload" },
    });
    const { container } = renderSkin("terminal", store, "en");
    const text = container.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).toContain("fixture activity payload");
  });

  it("keeps the meter for real stepped plans", () => {
    const store = track(makeStore());
    dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    dispatch(store, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "act2",
      activityType: "PLAN",
      content: { title: "fixture plan", steps: [{ id: "s1", label: "only step", state: "done" }] },
    });
    const { container } = renderSkin("terminal", store, "en");
    expect(container.textContent).toContain("100%");
    expect(container.textContent).not.toContain("NaN");
  });
});

/* ── item 10: terminal done status bar ─────────────────────────────── */

describe("Fix C: terminal status bar on done", () => {
  it("shows the finished state instead of IDLE when the run is done", () => {
    const store = track(makeStore());
    dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    dispatch(store, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
    const { container } = renderSkin("terminal", store, "en");
    const status = container.querySelector(".term-status")!;
    expect(status.textContent).toContain("done");
    expect(status.textContent?.toLowerCase()).not.toContain("idle");
  });

  it("shows 已完成 in zh, never 空闲", () => {
    const store = track(makeStore());
    dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    dispatch(store, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
    const { container } = renderSkin("terminal", store, "zh");
    const status = container.querySelector(".term-status")!;
    expect(status.textContent).toContain("已完成");
    expect(status.textContent).not.toContain("空闲");
  });
});

/* ── item 11: terminal edit-args entry ─────────────────────────────── */

describe("Fix C: terminal interrupt edit entry", () => {
  it("opens a per-card editor and submits the edited args to the right interrupt", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderSkin("terminal", store, "zh");

    // no editor before the user asks for one
    expect(container.querySelectorAll(".term-edit")).toHaveLength(0);

    const cardA = Array.from(container.querySelectorAll(".term-box")).find((el) =>
      el.textContent?.includes("approval one")
    ) as HTMLElement;
    fireEvent.click(buttonByText(cardA, t("term.edit")));

    const boxes = container.querySelectorAll(".term-edit");
    expect(boxes).toHaveLength(1);
    const textarea = boxes[0].querySelector("textarea") as HTMLTextAreaElement;
    expect(JSON.parse(textarea.value)).toEqual({ hotel: "Hotel Atlantico", nights: 2 });

    fireEvent.change(textarea, { target: { value: '{"hotel":"A was edited"}' } });
    fireEvent.click(buttonByText(cardA, t("term.approveEdited")));
    expect(spy).toHaveBeenCalledWith(true, { hotel: "A was edited" }, "i1");
    // card B untouched and still pending
    const cardB = Array.from(container.querySelectorAll(".term-box")).find((el) =>
      el.textContent?.includes("approval two")
    ) as HTMLElement;
    expect(cardB.querySelector("textarea")).toBeNull();
    expect(store.pendingInterrupts().map((i) => i.id)).toEqual(["i2"]);
    spy.mockRestore();
  });

  it("falls back to a plain approve when the draft is not valid JSON", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderSkin("terminal", store, "zh");
    const cardA = Array.from(container.querySelectorAll(".term-box")).find((el) =>
      el.textContent?.includes("approval one")
    ) as HTMLElement;
    fireEvent.click(buttonByText(cardA, t("term.edit")));
    const textarea = container.querySelector(".term-edit textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "not json" } });
    fireEvent.click(buttonByText(cardA, t("term.approveEdited")));
    expect(spy).toHaveBeenCalledWith(true, undefined, "i1");
    spy.mockRestore();
  });
});

/* ── item 2: brutalist subagent row ────────────────────────────────── */

describe("Fix C: brutalist subagent entries", () => {
  it("renders the fixture subagent instead of dropping it", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    const { container } = renderSkin("brutalist", store, "en");
    const row = container.querySelector(".bru-subagent");
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain("fixture subagent");
    expect(row?.textContent).toContain("DONE"); // brutalist renders statuses uppercase
  });
});

/* ── item 8: brutalist empty-session state ─────────────────────────── */

describe("Fix C: brutalist empty thread", () => {
  it("shows the awaiting block on an empty thread (en + zh)", () => {
    const store = track(makeStore());
    const en = renderSkin("brutalist", store, "en");
    expect(en.container.querySelector(".bru-empty")).toBeTruthy();
    expect(en.container.textContent).toContain("AWAITING RUN_STARTED");
    cleanup();
    const zh = renderSkin("brutalist", store, "zh");
    expect(zh.container.textContent).toContain("等待 RUN_STARTED");
    expect(zh.container.querySelector(".bru-empty-big")).toBeTruthy();
  });
});

/* ── item 9: classic multi-plan sidebar ────────────────────────────── */

describe("Fix C: classic sidebar lists every plan", () => {
  it("renders both plans, not only the first", () => {
    const store = track(makeStore());
    dispatch(store, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "plan1",
      activityType: "PLAN",
      content: { title: "fixture plan one", steps: [{ id: "s1", label: "one step", state: "done" }] },
    });
    dispatch(store, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "plan2",
      activityType: "PLAN",
      content: { title: "fixture plan two", steps: [{ id: "s2", label: "two step", state: "active" }] },
    });
    const { container } = renderSkin("classic", store, "en");
    const details = container.querySelector(".cl-details")!;
    expect(details.textContent).toContain("fixture plan one");
    expect(details.textContent).toContain("fixture plan two");
    expect(details.textContent).toContain("two step");
    expect(container.querySelectorAll(".cl-plan-block")).toHaveLength(2);
  });
});

/* ── item 7: dead buttons ──────────────────────────────────────────── */

describe("Fix C: dead buttons", () => {
  it("classic: removed decorative buttons are gone", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    const { container } = renderSkin("classic", store, "en");
    expect(container.querySelector('button[title="Collapse"]')).toBeNull();
    expect(container.querySelector('button[title="More"]')).toBeNull();
    expect(container.querySelector('button[title="Attach"]')).toBeNull();
    expect(container.querySelector('button[title="Close"]')).toBeNull();
  });

  it("aurora: replay/retry is owned by the outer shell, not the skin", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    const { container } = renderSkin("aurora", store, "en");
    const retryButtons = Array.from(container.querySelectorAll("button")).filter((button) =>
      (button.textContent ?? "").includes(t("chat.retry"))
    );
    expect(retryButtons).toHaveLength(0);
    expect(container.querySelector('[title="Replay run"]')).toBeNull();
  });
});

/* ── item 6: suggestions ───────────────────────────────────────────── */

describe("Fix C: suggestions presentation", () => {
  const SUGGESTIONS = ["Swap Sintra for Cascais", "Find a room under €150/night"];

  it("paper: P.S. card is rendered after the letters and sends on click", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    addSuggestions(store, SUGGESTIONS);
    const spy = vi.spyOn(store, "send").mockImplementation(() => {});
    const { container } = renderSkin("paper", store, "en");
    const cards = container.querySelectorAll(".pap-ps-card");
    expect(cards).toHaveLength(2);
    // the degenerate footer echo is gone
    expect(container.querySelector(".pap-composer-hint")?.textContent ?? "").not.toContain("Swap Sintra");
    fireEvent.click(cards[0]);
    expect(spy).toHaveBeenCalledWith("Swap Sintra for Cascais");
    spy.mockRestore();
  });

  it.each(["classic", "terminal", "brutalist"] as const)("%s: chips above the composer fill the draft", (skinId) => {
    const store = track(makeFixture() as unknown as ConversationStore);
    addSuggestions(store, SUGGESTIONS);
    const { container } = renderSkin(skinId, store, "en");
    const chips = Array.from(container.querySelectorAll(".cl-suggestion, .term-suggest-chip, .bru-suggest-chip"));
    expect(chips.length).toBeGreaterThanOrEqual(2);
    const first = chips[0] as HTMLButtonElement;
    expect(first.textContent).toContain("Swap Sintra for Cascais");
    fireEvent.click(first);
    const textarea = container.querySelector(
      ".cl-composer textarea, .term-input-line textarea, .bru-composer textarea"
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Swap Sintra for Cascais");
  });
});

/* ── item 13: paper in-progress presentation ───────────────────────── */

describe("Fix C: paper main column in-progress annotation", () => {
  it("names the tool running in the main column while letters are empty", () => {
    const store = track(makeStore());
    dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    dispatch(store, { type: EventType.TOOL_CALL_START, toolCallId: "tc9", toolCallName: "web.search" });
    const { container } = renderSkin("paper", store, "en");
    const progress = container.querySelector(".pap-progress");
    expect(progress).toBeTruthy();
    expect(progress?.textContent).toContain("in progress");
    expect(progress?.textContent).toContain("web.search");
  });

  it("shows the thinking label for a streaming reasoning note", () => {
    const store = track(makeStore());
    dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    dispatch(store, { type: EventType.REASONING_START, messageId: "r1" });
    dispatch(store, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: "r1", delta: "…" });
    const { container } = renderSkin("paper", store, "zh");
    const progress = container.querySelector(".pap-progress");
    expect(progress).toBeTruthy();
    expect(progress?.textContent).toContain("进行中");
    expect(progress?.textContent).toContain("思考");
  });

  it("keeps naming the last artefact in the gap between two activities", () => {
    const store = track(makeStore());
    dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    dispatch(store, { type: EventType.TOOL_CALL_START, toolCallId: "tc8", toolCallName: "booking.hold" });
    dispatch(store, { type: EventType.TOOL_CALL_END, toolCallId: "tc8" });
    dispatch(store, { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc8", content: '{"ok":true}' });
    const { container } = renderSkin("paper", store, "en");
    const progress = container.querySelector(".pap-progress");
    expect(progress).toBeTruthy();
    expect(progress?.textContent).toContain("booking.hold");
  });

  it("stays hidden when the run is not in flight", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    const { container } = renderSkin("paper", store, "en");
    expect(container.querySelector(".pap-progress")).toBeNull();
  });
});

/* ── item 5 regression: zh leaks in paper / terminal / brutalist ───── */

describe("Fix C: zh i18n leak regression", () => {
  it("paper: known hardcoded strings are gone in zh", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    // a held reservation so the held branch is exercised in zh
    dispatch(store, { type: EventType.TOOL_CALL_START, toolCallId: "tc_h", toolCallName: "booking.hold" });
    dispatch(store, { type: EventType.TOOL_CALL_END, toolCallId: "tc_h" });
    dispatch(store, { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc_h", content: '{"reservation":"LIS-2481"}' });
    const { container } = renderSkin("paper", store, "zh");
    const text = container.textContent ?? "";
    expect(text).toContain("回车发送");
    expect(text).toContain("已预留");
    expect(text).toContain("条来源");
    expect(text).not.toContain("⏎ to send");
    expect(text).not.toContain("in progress");
    expect(text).not.toContain("held ·");

    // amend flow is fully zh
    fireEvent.click(buttonByText(container, t("paper.amend")));
    const amend = container.querySelector(".pap-amend")!;
    expect(amend.textContent).toContain("恢复运行时提交的条款");
    expect(amend.textContent).not.toContain("Terms, as submitted on resume");
    expect(buttonByText(amend, t("intr.cancel")).textContent).toBe(t("intr.cancel"));
  });

  it("terminal: trace, reasoning and approval copy are zh", () => {
    const store = track(makeStore());
    const { container } = renderSkin("terminal", store, "zh");
    const text = container.textContent ?? "";
    expect(text).toContain("暂无事件");
    expect(text).toContain("+ 增量");
    expect(text).not.toContain("no events");
    expect(text).not.toContain("+ deltas");
  });

  it("terminal: pending card and resolved chip are zh", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    const { container } = renderSkin("terminal", store, "zh");
    const text = container.textContent ?? "";
    expect(text).toContain("[E] 编辑参数");
    expect(text).toContain("[Y] 同意");
    expect(text).toContain("运行已暂停");
    expect(text).not.toContain("resume[] required");

    // resolve the interrupt, then the chip must read ✓ 已同意 (never the raw
    // "approved" status word — the trace panel's protocol JSON is exempt)
    const intr = store.entries.find((e): e is InterruptEntry => e.kind === "interrupt")!;
    intr.status = "approved";
    intr.resolvedAt = Date.now();
    const { container: rerendered } = renderSkin("terminal", store, "zh");
    const chip = rerendered.querySelector(".term-box-resolved")!;
    expect(chip.textContent).toContain("已同意");
    expect(chip.textContent).not.toContain("approved");
  });

  it("terminal: reasoning label and thinking copy are zh", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    const { container } = renderSkin("terminal", store, "zh");
    expect(container.textContent).toContain("思考中");
    expect(container.textContent).not.toContain("thinking");
  });

  it("brutalist: approval and held copy are zh, USER stays a style word", () => {
    const store = track(makeFixture() as unknown as ConversationStore);
    dispatch(store, { type: EventType.TOOL_CALL_START, toolCallId: "tc_h", toolCallName: "booking.hold" });
    dispatch(store, { type: EventType.TOOL_CALL_END, toolCallId: "tc_h" });
    dispatch(store, { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc_h", content: '{"reservation":"LIS-2481"}' });
    const { container } = renderSkin("brutalist", store, "zh");
    const text = container.textContent ?? "";
    expect(text).toContain("需要批准");
    expect(text).toContain("等待你的决定");
    expect(text).toContain("已预留");
    expect(text).not.toContain("HELD");
    // the approve note itself must not leak the english "interrupt" fallback
    const note = container.querySelector(".bru-approve-note")!;
    expect(note.textContent).not.toContain("interrupt");
    expect(text).toContain("USER"); // deliberate style word, kept per brief

    // resolved card reads 你已批准, never "BY YOU"
    const intr = store.entries.find((e): e is InterruptEntry => e.kind === "interrupt")!;
    intr.status = "approved";
    intr.resolvedAt = Date.now();
    const { container: rerendered } = renderSkin("brutalist", store, "zh");
    expect(rerendered.textContent).toContain("你已批准");
    expect(rerendered.textContent).not.toContain("BY YOU");
  });

  it("aurora: empty-thread hint and plan step copy are zh", () => {
    const store = track(makeStore());
    dispatch(store, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "plan1",
      activityType: "PLAN",
      content: { title: "fixture plan", steps: [{ id: "s1", label: "only step", state: "active" }] },
    });
    const { container } = renderSkin("aurora", store, "zh");
    const text = container.textContent ?? "";
    expect(text).toContain("执行中");
    expect(text).not.toContain("waiting for RUN_STARTED");
  });
});

/* ── item 3: Home hero copy derived from skins.length ──────────────── */

vi.mock("../src/shell/GridMotion", () => ({ GridMotion: () => null }));

const mkSkins = (n: number): HomeSkin[] =>
  Array.from({ length: n }, (_, i) => ({ id: `skin-${i}`, name: `Skin ${i}`, tagline: `tag ${i}`, accent: "#fff" }));

const renderHome = (skins: HomeSkin[], lang: "zh" | "en") =>
  render(
    <Home
      skins={skins}
      lang={lang}
      backend="mock"
      piNote="pi fixture"
      activeSkin={skins[0].id}
      onSkin={() => {}}
      onPalette={() => {}}
      onLang={() => {}}
      onBackend={() => {}}
      onRunInfo={() => {}}
      onDocs={() => {}}
      onFullscreen={() => {}}
      onCustomize={() => {}}
    >
      <div />
    </Home>
  );

describe("Fix C: Home hero count copy", () => {
  it("skinCountWord maps counts to words in both languages", () => {
    expect(skinCountWord(5, false)).toBe("five");
    expect(skinCountWord(5, true)).toBe("五");
    expect(skinCountWord(4, true)).toBe("四");
    expect(skinCountWord(11, false)).toBe("11");
  });

  it("hero says multiple skins regardless of registry size", () => {
    const en = renderHome(mkSkins(6), "en");
    expect(en.container.querySelector("h1")?.textContent).toContain("Multiple skins");
    cleanup();
    const zh = renderHome(mkSkins(6), "zh");
    expect(zh.container.querySelector("h1")?.textContent).toContain("多套皮肤");
    cleanup();
    const three = renderHome(mkSkins(3), "en");
    expect(three.container.querySelector("h1")?.textContent).toContain("Multiple skins");
  });
});
