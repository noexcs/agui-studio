import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SkinHostProvider, skins, setLang, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { CustomizePanel } from "../src/app/CustomizePanel";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { makeStore } from "./fixture";

/* ── Fix E: accent contrast guard wiring.
   jsdom cannot resolve stylesheet custom properties, so the computed-color
   assertion runs against the values the host injects inline on .sk-tune
   (the brief allows inline-style/data-attr assertions) + css source checks. ── */

afterEach(() => {
  cleanup();
  setLang("en");
});

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const skinById = (id: string) => skins.find((s) => s.id === id)!.ChatPage;

function pendingInterruptStore(): ConversationStore {
  const store = makeStore();
  store.dispatch({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as never);
  store.dispatch({
    type: EventType.RUN_FINISHED,
    outcome: {
      type: "interrupt",
      interrupts: [{ id: "i1", reason: "tool_call", toolCallId: "tc1", message: "fixture approval", details: [] }],
    },
  } as never);
  return store;
}

function renderClassic(conversation: SkinConversation, tuning: { accent?: string }) {
  const Page = skinById("classic");
  return render(
    <SkinHostProvider conversation={conversation} lang="en" branding={BRANDING} skin="classic" tuning={tuning}>
      <Page />
    </SkinHostProvider>
  );
}

const wrapperOf = (container: HTMLElement) => {
  const wrapper = container.querySelector(".sk-tune") as HTMLElement;
  expect(wrapper).toBeTruthy();
  return wrapper;
};

describe("Fix E: host injects the guarded foregrounds", () => {
  it("accent=#facc15: classic Approve gets the dark ink foreground injected", () => {
    const { container } = renderClassic(pendingInterruptStore(), { accent: "#facc15" });
    const wrapper = wrapperOf(container);
    // raw pick preserved for the css layer…
    expect(wrapper.style.getPropertyValue("--sk-accent")).toBe("#facc15");
    expect(wrapper.hasAttribute("data-sk-accent")).toBe(true);
    // …while the Approve button's foreground flips to the dark ink (11.6:1 on yellow)
    expect(wrapper.style.getPropertyValue("--sk-accent-fg")).toBe("#111827");
    // links/meta get the AA-darkened accent instead of raw #facc15 (1.5:1)
    expect(wrapper.style.getPropertyValue("--sk-accent-ink")).toBe("#8c720c");

    // the button the brief names is actually on screen
    const approve = container.querySelector(".cl-btn--primary")!;
    expect(approve.textContent).toContain(t("intr.approve"));
  });

  it("accent=#2563eb: white foreground, no ink (legacy look)", () => {
    const { container } = renderClassic(pendingInterruptStore(), { accent: "#2563eb" });
    const wrapper = wrapperOf(container);
    expect(wrapper.style.getPropertyValue("--sk-accent-fg")).toBe("#ffffff");
    expect(wrapper.style.getPropertyValue("--sk-accent-ink")).toBe("");
  });

  it("without tuning nothing is injected", () => {
    const { container } = renderClassic(pendingInterruptStore(), {});
    const wrapper = wrapperOf(container);
    expect(wrapper.hasAttribute("data-sk-accent")).toBe(false);
    expect(wrapper.style.getPropertyValue("--sk-accent-fg")).toBe("");
    expect(wrapper.style.getPropertyValue("--sk-accent-ink")).toBe("");
  });

  it("an unparseable accent keeps legacy rendering instead of crashing", () => {
    const { container } = renderClassic(pendingInterruptStore(), { accent: "rgb(" });
    const wrapper = wrapperOf(container);
    // no guard values are injected for a color the library cannot parse
    expect(wrapper.style.getPropertyValue("--sk-accent-fg")).toBe("");
    expect(wrapper.style.getPropertyValue("--sk-accent-ink")).toBe("");
  });
});

/* ── CustomizePanel readability hint (non-blocking) ─────────────────── */

const renderPanel = (tuning: { accent?: string }, lang: "en" | "zh" = "en") => {
  setLang(lang);
  return render(<CustomizePanel open variant="inline" skinName="Classic" tuning={tuning} onChange={() => {}} />);
};

const noteHint = (container: HTMLElement) => container.querySelector('p.customize-hint[role="note"]');

describe("Fix E: customize panel contrast hint", () => {
  it("warns in english for a too-light accent, with the measured ratio", () => {
    const { container } = renderPanel({ accent: "#facc15" });
    const hint = noteHint(container)!;
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain("Low contrast on light skins (1.5:1)");
    expect(hint.textContent).toContain("dark foreground");
  });

  it("warns in chinese for a too-light accent (已自动改用深色前景)", () => {
    const { container } = renderPanel({ accent: "#facc15" }, "zh");
    const hint = noteHint(container)!;
    expect(hint.textContent).toContain("对比度偏低");
    expect(hint.textContent).toContain("1.5:1");
    expect(hint.textContent).toContain("已自动改用深色前景");
  });

  it("warns for a too-dark accent and names the dark skins", () => {
    const { container } = renderPanel({ accent: "#0f172a" });
    const hint = noteHint(container)!;
    expect(hint.textContent).toContain("dark skins");
    expect(hint.textContent).toContain("Aurora / Terminal");
  });

  it("stays quiet for readable picks", () => {
    for (const accent of ["#2563eb", "#dc2626", "#db2777", undefined]) {
      const { container } = renderPanel({ accent });
      expect(noteHint(container)).toBeNull();
      cleanup();
    }
  });
});

/* ── css wiring (source-level, fix-d pattern) ───────────────────────── */

const pkgSrc = (...parts: string[]) => join(process.cwd(), "packages", "agui-skins", "src", ...parts);
const read = (path: string): string => {
  if (!existsSync(path)) throw new Error(`missing file ${path}`);
  return readFileSync(path, "utf8");
};

describe("Fix E: css consumes the guarded variables", () => {
  it("tuning.css maps the guards without requiring a skin prop", () => {
    const css = read(pkgSrc("tuning.css"));
    expect(css).not.toContain('data-skin="classic"');
    expect(css).toMatch(/\.sk-tune\[data-sk-accent\] \.skin-classic \{[\s\S]*--accent-fg: var\(--sk-accent-fg/);
    expect(css).toMatch(/--accent-ink: var\(--sk-accent-ink/);
    expect(css).toMatch(/--accent-2: color-mix\(in srgb, var\(--sk-accent\)/);
  });

  it("all skins map --sk-accent in their own CSS (open-closed theming)", () => {
    for (const skin of ["aurora", "paper", "terminal", "brutalist", "classic"]) {
      expect(read(pkgSrc("skins", skin, `${skin}.css`))).toContain("var(--sk-accent");
    }
  });

  it("dark-skin text consumes the brightened on-dark variant", () => {
    const css = read(pkgSrc("tuning.css"));
    expect(css).toMatch(/--accent-text: var\(--sk-accent-on-dark/);
    expect(css).toMatch(/\.skin-paper \{\s*--accent-text: var\(--sk-accent-ink/);
  });
  it("classic puts the guarded fg on accent backgrounds and the ink on accent text", () => {
    const css = read(pkgSrc("skins", "classic", "classic.css"));
    expect(css).toMatch(/\.cl-btn--primary \{[^}]*color: var\(--accent-fg, #fff\)/);
    expect(css).toMatch(/\.cl-md a \{ color: var\(--accent-ink/);
    expect(css).toMatch(/\.cl-sources a \{ color: var\(--accent-ink/);
    expect(css).toMatch(/\.cl-link \{[^}]*color: var\(--accent-ink/);
  });

  it("aurora --text-3 and the terminal placeholder use the AA-tuned fixed colors", () => {
    expect(read(pkgSrc("skins", "aurora", "aurora.css"))).toContain("--text-3: #7b8496");
    expect(read(pkgSrc("skins", "terminal", "terminal.css"))).toMatch(/term-input-line textarea::placeholder \{ color: #63826e/);
  });
});
