import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider, type SkinConversation } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeStore } from "./fixture";

/* ── Fix D: a11y alignment. aurora ev-rows become keyboard-activatable,
   the inspector event list stops stealing scrolls (useStickToBottom),
   and every skin carries its own :focus-visible + a prefers-reduced-
   motion fallback. CSS-layer behaviour is guarded by reading the skin
   stylesheets directly (jsdom does not compute styles from files). ─── */

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

function renderSkin(id: string, conversation: SkinConversation, lang: "zh" | "en" = "en") {
  const Page = skinById(id).ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang={lang} branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

const dispatch = (store: ConversationStore, event: Record<string, unknown>) => store.dispatch(event as never);

/** A short finished run — five protocol events in the inspector. */
function makeEventsStore(): ConversationStore {
  const store = track(makeStore());
  dispatch(store, { type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
  dispatch(store, { type: EventType.TOOL_CALL_START, toolCallId: "tc1", toolCallName: "web.search" });
  dispatch(store, { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc1", delta: '{"query":"fixture"}' });
  dispatch(store, { type: EventType.TOOL_CALL_END, toolCallId: "tc1" });
  dispatch(store, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
  return store;
}

/** Streams two more events; act() so the skin's effects flush synchronously. */
const moreEvents = (store: ConversationStore) => {
  act(() => {
    dispatch(store, { type: EventType.TEXT_MESSAGE_START, messageId: "m2" });
    dispatch(store, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m2", delta: "fixture delta" });
  });
};

/* ── item 3: aurora ev-row keyboard access ─────────────────────────── */

describe("Fix D: aurora ev-row keyboard access", () => {
  it("event rows are tabbable buttons whose Enter/Space toggles the JSON pane", () => {
    const store = makeEventsStore();
    const { container } = renderSkin("aurora", store, "en");
    // jsdom's viewport is frozen at 1024px, where aurora's ≤1080px media query
    // sets .inspector { display: none } — inline style restores it so rows are
    // focusable (inline rules beat the stylesheet, like a real wide window).
    (container.querySelector(".inspector") as HTMLElement).style.display = "flex";
    const rows = Array.from(container.querySelectorAll(".ev-row")) as HTMLElement[];
    expect(rows.length).toBeGreaterThanOrEqual(5);

    for (const row of rows) {
      expect(row.getAttribute("role")).toBe("button");
      expect(row.getAttribute("tabindex")).toBe("0");
    }

    const row = rows[0];
    // "Tab focuses": tabIndex=0 puts the row in the tab order; focus lands on it
    row.focus();
    expect(document.activeElement).toBe(row);

    expect(row.classList.contains("is-selected")).toBe(false);
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(row.classList.contains("is-selected")).toBe(true);
    expect(row.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(row.classList.contains("is-selected")).toBe(false);

    fireEvent.keyDown(row, { key: " " }); // Space activates a button too
    expect(row.classList.contains("is-selected")).toBe(true);
  });

  it("filter chips are native buttons, so they are keyboard-activatable for free", () => {
    const store = makeEventsStore();
    const { container } = renderSkin("aurora", store, "en");
    const filters = Array.from(container.querySelectorAll(".ev-filters > button"));
    expect(filters.length).toBe(7);
    for (const filter of filters) expect(filter.tagName).toBe("BUTTON");
  });
});

/* ── item 4: aurora inspector stick-to-bottom ──────────────────────── */

describe("Fix D: aurora inspector stick-to-bottom", () => {
  it("pins to the newest event while the reader sits at the bottom", () => {
    const store = makeEventsStore();
    const { container } = renderSkin("aurora", store, "en");
    const list = container.querySelector(".ev-list") as HTMLElement;
    expect(list).toBeTruthy();

    // jsdom has no layout, so pin the three metrics useStickToBottom reads
    const SCROLL_H = 1000;
    const CLIENT_H = 400;
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: SCROLL_H });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: CLIENT_H });

    // reader at the bottom: the next streamed batch keeps the pin
    Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: SCROLL_H - CLIENT_H });
    list.dispatchEvent(new Event("scroll"));
    moreEvents(store);
    expect(list.scrollTop).toBe(SCROLL_H);
  });

  it("releases the pin when the reader scrolls up to inspect history", () => {
    const store = makeEventsStore();
    const { container } = renderSkin("aurora", store, "en");
    const list = container.querySelector(".ev-list") as HTMLElement;
    const SCROLL_H = 1000;
    const CLIENT_H = 400;
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: SCROLL_H });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: CLIENT_H });

    // reader scrolls up, far from the bottom edge (>140px away)
    const UP = 100;
    Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: UP });
    list.dispatchEvent(new Event("scroll"));

    moreEvents(store);
    // streaming must NOT yank the reader back to the bottom
    expect(list.scrollTop).toBe(UP);

    // scrolling back down re-arms the pin
    Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: SCROLL_H - CLIENT_H });
    list.dispatchEvent(new Event("scroll"));
    moreEvents(store);
    expect(list.scrollTop).toBe(SCROLL_H);
  });
});

/* ── items 1+2: CSS-layer guards ───────────────────────────────────── */

const skinCss = (id: string): string => {
  const path = join(process.cwd(), "packages", "agui-skins", "src", "skins", id, `${id}.css`);
  if (!existsSync(path)) throw new Error(`missing stylesheet ${path}`);
  return readFileSync(path, "utf8");
};

/** The top-level prefers-reduced-motion block of a skin stylesheet. */
const reducedMotionBlock = (id: string): string => {
  const css = skinCss(id);
  const match = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
  if (!match) throw new Error(`no prefers-reduced-motion block in ${id}.css`);
  return match[0];
};

describe("Fix D: css focus-visible guards", () => {
  it.each(["aurora", "brutalist", "paper", "terminal"])("%s declares a :focus-visible style", (id) => {
    expect(skinCss(id)).toMatch(/:focus-visible/);
  });

  it("classic keeps its baseline :focus-visible (accent outline)", () => {
    expect(skinCss("classic")).toMatch(/\.skin-classic :focus-visible/);
  });

  it("terminal's composer textarea regains a keyboard focus indicator", () => {
    const css = skinCss("terminal");
    // base rule strips the UA outline…
    expect(css).toMatch(/\.term-input-line textarea \{[\s\S]*?outline: none/);
    // …so the focus-visible replacement must exist and be phosphor green
    expect(css).toMatch(/\.term-input-line textarea:focus-visible/);
    expect(css).toMatch(/outline: 1\.5px solid var\(--green\)/);
  });
});

describe("Fix D: css prefers-reduced-motion guards", () => {
  it.each(["aurora", "brutalist", "paper", "terminal", "classic"])("%s ships a reduced-motion fallback", (id) => {
    expect(skinCss(id)).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("each fallback names that skin's real animations, not a copied list", () => {
    expect(reducedMotionBlock("classic")).toMatch(/\.cl-row/);
    expect(reducedMotionBlock("classic")).toMatch(/\.cl-caret/);
    expect(reducedMotionBlock("paper")).toMatch(/\.pap-status--running::before/);
    expect(reducedMotionBlock("paper")).toMatch(/\.pap-blink/);
    expect(reducedMotionBlock("terminal")).toMatch(/\.term-led/);
    expect(reducedMotionBlock("terminal")).toMatch(/\.term-cursor/);
    expect(reducedMotionBlock("terminal")).toMatch(/\.term-trace-live i/);
    expect(reducedMotionBlock("brutalist")).toMatch(/\.bru-empty-cursor/);
    // the generic duration clamp is present in all of them
    for (const id of ["aurora", "brutalist", "paper", "terminal", "classic"]) {
      expect(reducedMotionBlock(id)).toContain("animation-duration: 0.01ms");
      expect(reducedMotionBlock(id)).toContain("transition-duration: 0.01ms");
    }
  });
});
