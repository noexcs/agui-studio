import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import { makeFixture, makeStore } from "./fixture";
import { EventType } from "../src/core/events";

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

describe("run metadata", () => {
  it("aggregates metadata from dispatched events (latest key wins)", () => {
    const store = makeStore();
    store.dispatch({ type: EventType.RUN_STARTED, metadata: { traceId: "t1", region: "eu" } } as never);
    store.dispatch({ type: EventType.CUSTOM, name: "usage", value: {}, metadata: { traceId: "t2" } } as never);
    expect(store.metadata).toEqual({ traceId: "t2", region: "eu" });
  });

  it("Classic shows metadata in the details panel", () => {
    const Page = skins.find((skin) => skin.id === "classic")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Metadata");
    expect(text).toContain("traceId");
    expect(text).toContain("fixture-trace");
  });

  it("Aurora's inspector exposes metadata chips", () => {
    const Page = skins.find((skin) => skin.id === "aurora")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    expect(container.querySelector(".insp-meta")?.textContent).toContain("fixture-trace");
  });
});

describe("custom entry renderer plugin", () => {
  const Page = skins.find((skin) => skin.id === "aurora")!.ChatPage;

  it("lets the host replace the default CUSTOM rendering", () => {
    const plugins = {
      custom: (entry: { name: string }) => <div data-testid="plugin">PLUGIN:{entry.name}</div>,
    };
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING} plugins={plugins}>
        <Page />
      </SkinHostProvider>
    );
    expect(container.textContent).toContain("PLUGIN:handoff");
  });

  it("falls back to the skin's JSON view without a plugin", () => {
    const { container } = render(
      <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING}>
        <Page />
      </SkinHostProvider>
    );
    expect(container.textContent).toContain("handoff");
    expect(container.textContent).toContain("fixture");
    expect(container.textContent).not.toContain("PLUGIN:");
  });

  it("Classic and Terminal honour the plugin too", () => {
    const plugins = {
      custom: (entry: { name: string }) => <span>OVERRIDE:{entry.name}</span>,
    };
    for (const id of ["classic", "terminal"]) {
      const SkinPage = skins.find((skin) => skin.id === id)!.ChatPage;
      const { container, unmount } = render(
        <SkinHostProvider conversation={makeFixture()} lang="en" branding={BRANDING} plugins={plugins}>
          <SkinPage />
        </SkinHostProvider>
      );
      expect(container.textContent).toContain("OVERRIDE:handoff");
      unmount();
    }
  });
});
