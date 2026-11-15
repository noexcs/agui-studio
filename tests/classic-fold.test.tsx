import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFoldStore, makeStore } from "./fixture";

/* Classic — fold groups in the neutral enterprise language: one dashed row
   with a chevron and a word summary; the original rows render inside when
   unfolded. The right-rail detail panel is untouched by folding. ── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

function renderClassic(conversation: SkinConversation, lang: "zh" | "en" = "zh") {
  const Page = skins.find((skin) => skin.id === "classic")!.ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

describe("classic fold groups (consecutive reasoning + tools)", () => {
  it("collapses a settled run into one dashed fold row by default", () => {
    const { container } = renderClassic(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".cl-fold-head") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all terminal → folded
    expect(head.textContent).toContain(t("fold.thinking")); // word summary
    expect(head.textContent).toContain(`4 ${t("fold.steps")}`);
    expect(container.querySelector(".cl-reason")).toBeNull(); // original rows stay in the body
    expect(container.querySelector(".cl-tool")).toBeNull();
  });

  it("clicking the head toggles aria-expanded and mounts the original rows", () => {
    const { container } = renderClassic(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".cl-fold-head") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".cl-reason")).toBeTruthy(); // reused reasoning row
    expect(container.querySelector(".cl-tool")).toBeTruthy(); // reused tool row
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".cl-reason")).toBeNull();
  });

  it("fold head is keyboard-operable (focus + explicit Enter/Space keydown)", () => {
    const { container } = renderClassic(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".cl-fold-head") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open group with the live flag", () => {
    const { container } = renderClassic(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector(".cl-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true"); // tool executing → open
    expect(head.querySelector(".cl-fold-flag--live")?.textContent).toContain(t("chat.executing"));
  });

  it("a failed tool inside the group surfaces the failure flag on the row", () => {
    const { container } = renderClassic(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector(".cl-fold-head") as HTMLButtonElement;
    const flag = head.querySelector(".cl-fold-flag--error");
    expect(flag).toBeTruthy();
    expect(flag?.textContent).toContain(t("fold.hasFailures"));
  });

  it("the right-rail detail panel is unaffected by folding", () => {
    const { container } = renderClassic(makeFoldStore() as unknown as SkinConversation);
    const rail = container.querySelector(".cl-details");
    expect(rail).toBeTruthy();
    // the rail still lists run metadata while the transcript row is folded
    expect(rail?.textContent).toContain(t("chat.context") === "Context" ? "Run" : "运行");
  });

  it("singletons stay ungrouped and error rows remain independent", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_START, messageId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r1" } as never);
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderClassic(store as unknown as SkinConversation);
      expect(container.querySelector(".cl-fold-head")).toBeNull(); // one reasoning row → no group
      expect(container.querySelector(".cl-error")).toBeTruthy();
    } finally {
      store.stop();
    }
  });
});
