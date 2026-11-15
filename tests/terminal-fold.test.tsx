import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFoldStore, makeStore } from "./fixture";

/* Terminal — fold groups in the phosphor trace language: one ▸ trace block
   with an N-steps mono summary; the original log lines render inside when
   unfolded. ── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

function renderTerminal(conversation: SkinConversation, lang: "zh" | "en" = "en") {
  const Page = skins.find((skin) => skin.id === "terminal")!.ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

describe("terminal fold groups (consecutive reasoning + tools)", () => {
  it("collapses a settled run into one ▸ trace block by default", () => {
    const { container } = renderTerminal(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".term-fold-head") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all terminal → folded
    expect(head.textContent).toContain(`4 ${t("fold.steps")}`);
    expect(container.querySelector(".term-tool")).toBeNull(); // log lines stay in the body
    expect(container.querySelector(".term-reason")).toBeNull();
  });

  it("clicking the head toggles aria-expanded and mounts the original log lines", () => {
    const { container } = renderTerminal(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".term-fold-head") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".term-reason")).toBeTruthy(); // reused thinking line
    expect(container.querySelector(".term-tool")).toBeTruthy(); // reused tool line
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".term-tool")).toBeNull();
  });

  it("fold head is keyboard-operable (focus + explicit Enter/Space keydown)", () => {
    const { container } = renderTerminal(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".term-fold-head") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open group with the live marker", () => {
    const { container } = renderTerminal(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector(".term-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(head.querySelector(".term-fold-flag--live")?.textContent).toContain("running");
  });

  it("a failed tool inside the group surfaces the failure marker", () => {
    const { container } = renderTerminal(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector(".term-fold-head") as HTMLButtonElement;
    const flag = head.querySelector(".term-fold-flag--error");
    expect(flag).toBeTruthy();
    expect(flag?.textContent).toContain(t("fold.hasFailures"));
  });

  it("singletons stay ungrouped and error lines remain independent", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_START, messageId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r1" } as never);
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderTerminal(store as unknown as SkinConversation);
      expect(container.querySelector(".term-fold-head")).toBeNull(); // one reasoning line → no group
      expect(container.querySelector(".term-error")).toBeTruthy();
    } finally {
      store.stop();
    }
  });
});
