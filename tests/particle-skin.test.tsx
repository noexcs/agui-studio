import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import { makeFixture } from "./fixture";

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
