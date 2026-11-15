import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeFoldStore, makeStore } from "./fixture";

/* Brutalist — fold groups as a hard-edged box with a loud mono head.
   Failures stay loud on the head; members render inside when unfolded. ── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

function renderBrutalist(conversation: SkinConversation, lang: "zh" | "en" = "en") {
  const Page = skins.find((skin) => skin.id === "brutalist")!.ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

describe("brutalist fold groups (consecutive reasoning + tools)", () => {
  it("collapses a settled run into one hard-edged fold box by default", () => {
    const { container } = renderBrutalist(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".bru-fold-head") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all terminal → folded
    expect(head.textContent).toContain("TOOLS ×2");
    expect(container.querySelector(".bru-think")).toBeNull(); // members stay in the body
    expect(container.querySelector(".bru-tool")).toBeNull();
  });

  it("clicking the head toggles aria-expanded and mounts the original blocks", () => {
    const { container } = renderBrutalist(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".bru-fold-head") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".bru-think")).toBeTruthy(); // reused thinking block
    expect(container.querySelector(".bru-tool")).toBeTruthy(); // reused tool block
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".bru-think")).toBeNull();
  });

  it("fold head is keyboard-operable (focus + explicit Enter/Space keydown)", () => {
    const { container } = renderBrutalist(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".bru-fold-head") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open group with the live flag", () => {
    const { container } = renderBrutalist(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector(".bru-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(head.querySelector(".bru-fold-flag--live")?.textContent).toContain("RUNNING");
  });

  it("a failed tool inside the group keeps the failure loud on the head", () => {
    const { container } = renderBrutalist(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector(".bru-fold-head") as HTMLButtonElement;
    const flag = head.querySelector(".bru-fold-flag--error");
    expect(flag).toBeTruthy();
    expect(flag?.textContent).toContain(t("fold.hasFailures").toUpperCase());
  });

  it("singletons stay ungrouped and error rows remain independent", () => {
    const store = makeStore();
    try {
      store.dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_START, messageId: "r1" } as never);
      store.dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r1" } as never);
      store.dispatch({ type: EventType.RUN_ERROR, message: "fixture run error message" } as never);
      const { container } = renderBrutalist(store as unknown as SkinConversation);
      expect(container.querySelector(".bru-fold-head")).toBeNull(); // one thinking block → no group
      expect(container.querySelector(".bru-error")).toBeTruthy();
    } finally {
      store.stop();
    }
  });
});
