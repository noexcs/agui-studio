import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFoldStore, makeStore } from "./fixture";

/* Paper — fold groups live in the margin-notes rail: a run of consecutive
   thinking/tool notes becomes one numbered footnote with a letterpress
   (+/−) fold head. Failures surface in the meta line. ── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

function renderPaper(conversation: SkinConversation, lang: "zh" | "en" = "zh") {
  const Page = skins.find((skin) => skin.id === "paper")!.ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

describe("paper fold groups (consecutive reasoning + tools)", () => {
  it("collapses a settled run into one numbered footnote by default", () => {
    const { container } = renderPaper(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".pap-fold-head") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all terminal → folded
    expect(head.textContent).toContain(`4 ${t("fold.steps")}`);
    expect(head.textContent).toContain(`2 ${t("paper.toolCall")}`);
    // member notes stay in the body: no tool args pre while folded
    expect(container.querySelector(".pap-args")).toBeNull();
    // the group takes one margin-note slot
    expect(container.querySelectorAll(".pap-note").length).toBeGreaterThan(0);
  });

  it("clicking the head toggles aria-expanded and mounts the original notes", () => {
    const { container } = renderPaper(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".pap-fold-head") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".pap-quote")).toBeTruthy(); // reused thinking note
    expect(container.querySelector(".pap-args")).toBeTruthy(); // reused tool note
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".pap-quote")).toBeNull();
  });

  it("fold head is keyboard-operable (focus + explicit Enter/Space keydown)", () => {
    const { container } = renderPaper(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".pap-fold-head") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open group and names the progress", () => {
    const { container } = renderPaper(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector(".pap-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true"); // tool executing → open
    expect(head.textContent).toContain(t("paper.inProgress"));
  });

  it("a failed tool inside the group surfaces the failure in the meta line", () => {
    const { container } = renderPaper(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector(".pap-fold-head") as HTMLButtonElement;
    expect(head.dataset.failure).toBe("error");
    expect(head.textContent).toContain(t("fold.hasFailures"));
  });

  it("groups only truly adjacent entries: an assistant letter between runs cuts them", () => {
    // reasoning→tool | assistant text | reasoning→tool = two groups, not one run of four
    const store = makeStore();
    try {
      const dispatch = (event: Record<string, unknown>) => store.dispatch(event as never);
      dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" });
      dispatch({ type: EventType.REASONING_START, messageId: "r1" });
      dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r1" });
      dispatch({ type: EventType.TOOL_CALL_START, toolCallId: "tc1", toolCallName: "web.search" });
      dispatch({ type: EventType.TOOL_CALL_END, toolCallId: "tc1" });
      dispatch({ type: EventType.TEXT_MESSAGE_START, messageId: "a1", role: "assistant" });
      dispatch({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a1", delta: "in-between words" });
      dispatch({ type: EventType.TEXT_MESSAGE_END, messageId: "a1" });
      dispatch({ type: EventType.REASONING_START, messageId: "r2" });
      dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r2" });
      dispatch({ type: EventType.TOOL_CALL_START, toolCallId: "tc2", toolCallName: "booking.hold" });
      dispatch({ type: EventType.TOOL_CALL_END, toolCallId: "tc2" });
      const { container } = renderPaper(store as unknown as SkinConversation);
      expect(container.querySelectorAll(".pap-fold-head")).toHaveLength(2); // two runs of two
      // every margin note is a group — the assistant letter cut the run in half
      expect(container.querySelectorAll(".pap-note")).toHaveLength(2);
      expect(container.textContent).toContain("in-between words"); // the letter is untouched in the main column
    } finally {
      store.stop();
    }
  });
});
