import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { makeFixture, makeFoldStore, makeStore } from "./fixture";
import { EventType } from "../src/core/events";

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

function renderParticle() {
  const Page = skins.find((skin) => skin.id === "particle")!.ChatPage;
  return render(
    <SkinHostProvider conversation={makeFixture()} lang="zh" branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

describe("Particle skin is event-first", () => {
  it("has a compact protocol header instead of a decorative hero", () => {
    const { container } = renderParticle();
    expect(container.querySelector(".pt-topbar")).toBeTruthy();
    expect(container.querySelector(".sk-particle-text")).toBeNull();
    expect(container.textContent).toContain("Fixture Agent");
  });

  it("renders tool calls as first-class protocol cards with args and result", () => {
    const { container } = renderParticle();
    fireEvent.click(container.querySelector(".pt-fold-head") as HTMLButtonElement); // unfold the tool card first
    const cards = container.querySelectorAll(".pt-tool");
    expect(cards.length).toBeGreaterThan(0);
    expect(container.textContent?.toLowerCase()).toContain("web.search");
    const head = container.querySelector(".pt-tool-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    expect(container.querySelector(".pt-tool-body")).toBeTruthy();
    expect(container.querySelector(".pt-tool-kicker")?.textContent).toBe("tool");
  });

  it("keeps interrupt approval and plan distinct from message bubbles", () => {
    const { container } = renderParticle();
    expect(container.querySelector(".pt-interrupt")).toBeTruthy();
    expect(container.querySelector(".pt-plan-card")).toBeTruthy();
    expect(container.querySelector(".pt-btn--primary")).toBeTruthy();
  });
});

describe("particle fold groups (consecutive reasoning + tools)", () => {
  function renderConversation(conversation: SkinConversation) {
    const Page = skins.find((skin) => skin.id === "particle")!.ChatPage;
    return render(
      <SkinHostProvider conversation={conversation} lang="en" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
  }

  it("collapses a settled run into one protocol fold card by default", () => {
    const { container } = renderConversation(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".pt-fold-head") as HTMLButtonElement;
    expect(head).toBeTruthy();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("false"); // all terminal → folded
    expect(head.textContent).toContain("booking.hold"); // tool names surface in the summary
    expect(container.querySelector(".pt-tool")).toBeNull(); // members stay in the body
    expect(container.querySelector(".pt-reason-toggle")).toBeNull();
  });

  it("clicking the head toggles aria-expanded and mounts the original rows", () => {
    const { container } = renderConversation(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".pt-fold-head") as HTMLButtonElement;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".pt-reason-toggle")).toBeTruthy(); // reused reasoning pill
    expect(container.querySelector(".pt-tool")).toBeTruthy(); // reused tool card
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".pt-tool")).toBeNull();
  });

  it("fold head is keyboard-operable (focus + explicit Enter/Space keydown)", () => {
    const { container } = renderConversation(makeFoldStore() as unknown as SkinConversation);
    const head = container.querySelector(".pt-fold-head") as HTMLButtonElement;
    head.focus();
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: "Enter" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(head, { key: " " });
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("an in-flight run derives an open group with the live flag", () => {
    const { container } = renderConversation(makeFoldStore({ leaveRunning: true }) as unknown as SkinConversation);
    const head = container.querySelector(".pt-fold-head") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(head.querySelector(".pt-fold-flag--live")?.textContent).toContain("running");
  });

  it("a failed tool inside the group surfaces the failure flag", () => {
    const { container } = renderConversation(makeFoldStore({ failLastTool: true }) as unknown as SkinConversation);
    const head = container.querySelector(".pt-fold-head") as HTMLButtonElement;
    const flag = head.querySelector(".pt-fold-flag--error");
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
      const { container } = renderConversation(store as unknown as SkinConversation);
      expect(container.querySelector(".pt-fold-head")).toBeNull(); // one reasoning pill → no group
      expect(container.querySelector(".pt-error-row")).toBeTruthy();
    } finally {
      store.stop();
    }
  });
});
