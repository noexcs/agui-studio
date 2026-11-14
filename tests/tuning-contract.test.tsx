import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import type { Entry, SkinConversation } from "agui-skins";
import { makeFixture } from "./fixture";

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

function wrapper(container: HTMLElement) {
  return container.querySelector(".sk-tune") as HTMLElement;
}

describe("accent tuning contract", () => {
  it("applies an accent without requiring the skin prop", () => {
    const Page = skins.find((s) => s.id === "aurora")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING} tuning={{ accent: "#DB2777" }}>
        <Page />
      </SkinHostProvider>
    );
    const el = wrapper(container);
    expect(el.hasAttribute("data-sk-accent")).toBe(true);
    // normalized to lowercase hex, independent of the (optional) skin prop
    expect(el.style.getPropertyValue("--sk-accent")).toBe("#db2777");
  });

  it("ignores an unparseable accent instead of injecting broken CSS", () => {
    const Page = skins[0].ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} branding={BRANDING} tuning={{ accent: "not-a-color" }}>
        <Page />
      </SkinHostProvider>
    );
    const el = wrapper(container);
    expect(el.hasAttribute("data-sk-accent")).toBe(false);
    expect(el.style.getPropertyValue("--sk-accent")).toBe("");
  });

  it("injects the guarded variants for extreme accents", () => {
    const Page = skins.find((s) => s.id === "classic")!.ChatPage;
    const { container, unmount } = render(
      <SkinHostProvider conversation={makeFixture()} branding={BRANDING} tuning={{ accent: "#0f172a" }}>
        <Page />
      </SkinHostProvider>
    );
    // dark accent on dark skins needs a brightened text variant
    expect(wrapper(container).style.getPropertyValue("--sk-accent-on-dark")).not.toBe("");
    unmount();

    const light = render(
      <SkinHostProvider conversation={makeFixture()} branding={BRANDING} tuning={{ accent: "#facc15" }}>
        <Page />
      </SkinHostProvider>
    );
    // light accent on light skins needs a dark ink variant
    expect(wrapper(light.container).style.getPropertyValue("--sk-accent-ink")).not.toBe("");
  });

  it("every skin consumes --sk-accent from its own CSS (no data-skin switch)", () => {
    const root = join(process.cwd(), "packages", "agui-skins", "src", "skins");
    for (const skin of skins) {
      const css = readFileSync(join(root, skin.id, `${skin.id}.css`), "utf8");
      expect(css).toContain("var(--sk-accent");
    }
  });
});

describe("forward compatibility", () => {
  it("ignores an unknown entry kind instead of rendering it as assistant text", () => {
    const ghost = { kind: "ghost", id: "ghost-1", at: Date.now(), text: "GHOST MARKER" } as unknown as Entry;
    for (const skin of skins) {
      const conversation = makeFixture();
      (conversation as SkinConversation & { entries: Entry[] }).entries.push(ghost);
      const Page = skin.ChatPage;
      const { container, unmount } = render(
        <SkinHostProvider conversation={conversation} lang="zh" branding={BRANDING}>
          <Page />
        </SkinHostProvider>
      );
      expect(container.textContent).not.toContain("GHOST MARKER");
      unmount();
    }
  });
});

describe("skin registry", () => {
  it("exposes the ids the tuning CSS relies on", () => {
    expect(skins.map((skin) => skin.id).sort()).toEqual(["aurora", "brutalist", "classic", "paper", "terminal"]);
  });
});
