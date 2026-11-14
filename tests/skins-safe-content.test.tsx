import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { makeStore } from "./fixture";
import { plainText } from "../packages/agui-skins/src/utils";

/* P0: third-party AG-UI results/activities/state must never crash a skin and
   must never be silently dropped. These fixtures deliberately use shapes the
   demo never produces. */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const IDS = ["aurora", "paper", "terminal", "brutalist", "classic"] as const;

const skinById = (id: string) => skins.find((skin) => skin.id === id)!;

function conversationWith(entries: unknown[], sharedState: unknown = {}): SkinConversation {
  const store = makeStore();
  return Object.assign(store as unknown as SkinConversation, {
    entries,
    sharedState,
    status: "done",
    stateVersion: 1,
    touchedPaths: [],
  });
}

function toolEntry(result: unknown, error?: string) {
  return {
    kind: "tool",
    id: "tool_third_party",
    at: Date.now(),
    name: "third.party",
    argsRaw: "{}",
    args: {},
    status: error ? "error" : "done",
    result,
    ...(error ? { error } : {}),
  };
}

function planEntry(overrides: Record<string, unknown>) {
  return {
    kind: "plan",
    id: "plan_third_party",
    at: Date.now(),
    title: "Activity",
    activityType: "PLAN",
    steps: [],
    ...overrides,
  };
}

function renderSkin(id: string, conversation: SkinConversation) {
  const Page = skinById(id).ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang="en" branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

const textOf = (container: HTMLElement) => container.textContent ?? "";

describe("plainText is total", () => {
  it("never throws on non-strings", () => {
    expect(plainText(undefined)).toBe("");
    expect(plainText(null)).toBe("");
    expect(plainText({})).toBe("");
    expect(plainText([1, 2])).toBe("");
    expect(plainText(42)).toBe("42");
    expect(plainText(true)).toBe("true");
  });
});

describe.each(IDS)("third-party tool results: %s", (id) => {
  it("renders a non-array results field instead of calling .map", () => {
    const { container } = renderSkin(id, conversationWith([toolEntry({ results: "not-an-array" })]));
    expect(textOf(container)).toContain("not-an-array");
  });

  it("renders null source items with index fallback labels", () => {
    const { container } = renderSkin(id, conversationWith([toolEntry({ results: [null, { title: null, url: null }] })]));
    const sourceSelector: Record<string, string> = {
      aurora: ".tool-source",
      paper: ".pap-sources li",
      terminal: ".term-tree",
      brutalist: ".bru-tool-results span",
      classic: ".cl-sources li",
    };
    expect(container.querySelectorAll(sourceSelector[id])).toHaveLength(2);
  });

  it("renders arbitrary JSON, string and ContentPart[] results", () => {
    const one = renderSkin(id, conversationWith([toolEntry({ foo: "arbitrary-json-value" })]));
    expect(textOf(one.container)).toContain("arbitrary-json-value");
    cleanup();

    const two = renderSkin(id, conversationWith([toolEntry("plain-string-result")]));
    expect(textOf(two.container)).toContain("plain-string-result");
    cleanup();

    const three = renderSkin(
      id,
      conversationWith([toolEntry([{ type: "text", text: "content-part-text" }])])
    );
    expect(textOf(three.container)).toContain("content-part-text");
  });

  it("renders error text", () => {
    const { container } = renderSkin(id, conversationWith([toolEntry(null, "tool-exploded")]));
    expect(textOf(container)).toContain("tool-exploded");
  });
});

describe.each(IDS)("third-party activity steps: %s", (id) => {
  it("normalizes description/status and missing labels", () => {
    const { container } = renderSkin(
      id,
      conversationWith([
        planEntry({ steps: [{ description: "described-step", status: "done" }, null, { label: null }] }),
      ])
    );
    const text = textOf(container).toLowerCase();
    expect(text).toContain("described-step");
    expect(text).toContain("#2");
    expect(text).toContain("#3");
  });

  it("renders raw JSON when steps is not an array", () => {
    const { container } = renderSkin(id, conversationWith([planEntry({ steps: "not-a-list" })]));
    expect(textOf(container)).toContain("not-a-list");
  });

  it("renders raw content for a stepless activity", () => {
    const { container } = renderSkin(
      id,
      conversationWith([planEntry({ steps: [], content: { note: "raw-content-note" } })])
    );
    expect(textOf(container)).toContain("raw-content-note");
  });
});

describe.each(["aurora", "classic", "paper", "brutalist"] as const)("scalar/array shared state: %s", (id) => {
  it("does not throw on a scalar or array snapshot", () => {
    for (const state of ["scalar-state", [1, 2], 0, false] as unknown[]) {
      const { container } = renderSkin(id, conversationWith([], state));
      expect(container).toBeTruthy();
      cleanup();
    }
  });

  it("keeps scalar/array data visible where the skin renders state", () => {
    if (id === "aurora") return; // state lives in an inactive inspector tab
    const scalar = renderSkin(id, conversationWith([], "scalar-state"));
    expect(textOf(scalar.container)).toContain("scalar-state");
    cleanup();
    const array = renderSkin(id, conversationWith([], ["array-a", "array-b"]));
    expect(textOf(array.container)).toContain("array-a");
  });
});
