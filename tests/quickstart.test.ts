import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins } from "agui-skins";
import {
  buildAiPrompt,
  copyText,
  highlightCode,
  INSTALL_COMMAND,
  prefillUrl,
  QuickStart,
  skinComponentName,
} from "../src/shell/quickstart/QuickStart";

afterEach(() => {
  cleanup();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("buildAiPrompt", () => {
  const prompt = buildAiPrompt();

  it("includes the install command with its peer dependencies", () => {
    expect(prompt).toContain(INSTALL_COMMAND);
    expect(prompt).toContain("pnpm add agui-skins");
    expect(prompt).toContain("react-markdown >=9");
    expect(prompt).toContain("lucide-react >=0.4");
  });

  it("lists every skin from the registry (name + tagline), not hard-coded copies", () => {
    expect(skins.length).toBe(10);
    for (const skin of skins) {
      expect(prompt).toContain(skin.name);
      expect(prompt).toContain(skin.tagline);
      expect(prompt).toContain(`共 ${skins.length} 套`);
    }
  });

  it("spells out the key contract APIs", () => {
    expect(prompt).toContain("SkinHostProvider");
    expect(prompt).toContain("useConversation()");
    expect(prompt).toContain("SkinConversation");
    expect(prompt).toContain("SkinTuning");
    expect(prompt).toContain("ConversationStore");
    expect(prompt).toContain("HttpAgentTransport");
    expect(prompt).toContain("src/core/transport.ts");
  });

  it("documents the explicit CSS import (CSS is not auto-injected)", () => {
    expect(prompt).toContain('import "agui-skins/index.css"');
    expect(prompt).toContain("CSS 随包分发但不会自动注入");
  });

  it("covers the known pitfalls (interrupt resume, JSON Patch state)", () => {
    expect(prompt).toContain("expiresAt");
    expect(prompt).toContain("JSON Patch");
    expect(prompt).toContain("outcome.type === \"interrupt\"");
  });

  it("parameterizes the minimal example by the given skin (import path + component name)", () => {
    const paper = buildAiPrompt("paper");
    expect(paper).toContain('import Paper from "agui-skins/skins/paper"');
    expect(paper).toContain("Paper.ChatPage");
    expect(paper).not.toContain("skins/aurora");
    expect(paper).not.toContain("Aurora.ChatPage");

    const brutalist = buildAiPrompt("brutalist");
    expect(brutalist).toContain('import Brutalist from "agui-skins/skins/brutalist"');
    expect(brutalist).toContain("Brutalist.ChatPage");
  });

  it("uses the selected skin's registry accent in the example tuning", () => {
    for (const skin of skins) {
      expect(buildAiPrompt(skin.id)).toContain(`tuning={{ accent: "${skin.swatch[2]}"`);
    }
  });
});

describe("highlightCode", () => {
  it("marks tokens with hljs-* classes (highlight.js, not a hand-rolled tokenizer)", () => {
    const html = highlightCode(
      'import Aurora from "agui-skins/skins/aurora";\n// comment\nconst n = 1;',
      "tsx"
    );
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-string");
    expect(html).toContain("hljs-comment");
    expect(html).toContain("hljs-title");
    expect(html).toContain("hljs-number");
  });

  it("keeps the escaped code text intact", () => {
    const html = highlightCode('const s = "hello";', "tsx");
    expect(html).toContain("hello");
  });

  it("returns an empty string for unknown languages so callers fall back to plain text", () => {
    expect(highlightCode("anything", "brainfuck")).toBe("");
  });
});

describe("skinComponentName", () => {
  it("derives the PascalCase component identifier from a skin id", () => {
    expect(skinComponentName("aurora")).toBe("Aurora");
    expect(skinComponentName("brutalist")).toBe("Brutalist");
    expect(skinComponentName("dark-glass")).toBe("DarkGlass");
  });
});

describe("prefillUrl", () => {
  it("appends the encoded prompt", () => {
    expect(prefillUrl("https://claude.ai/new?q=", "hello world")).toBe("https://claude.ai/new?q=hello%20world");
    expect(prefillUrl("https://chatgpt.com/?q=", "a&b=c")).toBe("https://chatgpt.com/?q=a%26b%3Dc");
  });

  it("truncates the prompt so the URL stays under the limit", () => {
    const huge = "接入指南".repeat(4000);
    const url = prefillUrl("https://chatgpt.com/?q=", huge);
    expect(url.length).toBeLessThanOrEqual(8000);
    expect(url.startsWith("https://chatgpt.com/?q=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://chatgpt.com/?q=".length))).toContain("prompt truncated");
  });

  it("never exceeds a custom limit", () => {
    const url = prefillUrl("https://claude.ai/new?q=", "x".repeat(500), 200);
    expect(url.length).toBeLessThanOrEqual(200);
  });
});

describe("copyText", () => {
  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("returns false instead of throwing when no clipboard is available", async () => {
    await expect(copyText("hello")).resolves.toBe(false);
  });
});

describe("QuickStart section", () => {
  it("renders three code cards and one registry-driven row per skin", () => {
    const { container } = render(createElement(QuickStart, { lang: "zh", activeSkin: "aurora" }));
    const cards = container.querySelectorAll(".qs-card");
    expect(cards.length).toBe(3);
    const rows = container.querySelectorAll(".qs-skin-row");
    expect(rows.length).toBe(skins.length);
    for (const skin of skins) {
      expect(container.textContent).toContain(skin.name);
      expect(container.textContent).toContain(skin.tagline);
      const row = container.querySelector(`a[href*="skin=${skin.id}"]`);
      expect(row).toBeTruthy();
      expect(row?.getAttribute("href")).toContain(`skin=${skin.id}`);
      expect(row?.getAttribute("href")).toContain("lang=zh");
    }
    expect(container.textContent).toContain("快速上手");
    expect(container.textContent).toContain(INSTALL_COMMAND);
    expect(container.textContent).toContain("SkinHostProvider");
    expect(container.textContent).toContain("HttpAgentTransport");
  });

  it("generates the minimal-setup card and highlighted tokens for the active skin", () => {
    const { container } = render(createElement(QuickStart, { lang: "zh", activeSkin: "paper" }));
    expect(container.textContent).toContain('import Paper from "agui-skins/skins/paper"');
    expect(container.textContent).toContain('import "agui-skins/index.css"');
    expect(container.textContent).toContain("Paper.ChatPage");
    expect(container.textContent).not.toContain("skins/aurora");
    // library-driven highlighting lands in the DOM as hljs-* spans
    expect(container.querySelectorAll(".qs-code .hljs-keyword").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".qs-code .hljs-string").length).toBeGreaterThan(0);
  });

  it("marks exactly the active skin's row as current", () => {
    const { container } = render(createElement(QuickStart, { lang: "zh", activeSkin: "terminal" }));
    const current = container.querySelectorAll(".qs-skin-row.is-current");
    expect(current.length).toBe(1);
    expect(current[0].getAttribute("href")).toContain("skin=terminal");
    expect(current[0].getAttribute("aria-current")).toBe("true");
    expect(current[0].textContent).toContain("当前");
  });

  const openMenu = () => {
    // jsdom lacks PointerEvent; Radix menus open through their keyboard path too
    fireEvent.keyDown(screen.getByText("Copy for AI"), { key: "Enter" });
  };

  it("opens the Copy for AI dropdown and copies the prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(createElement(QuickStart, { lang: "zh", activeSkin: "paper" }));

    openMenu();
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("复制接入提示词");
    expect(menu.textContent).toContain("复制安装命令");
    expect(menu.textContent).toContain("在 ChatGPT 打开");
    expect(menu.textContent).toContain("在 Claude 打开");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /复制接入提示词/ }), { key: "Enter" });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining(INSTALL_COMMAND));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("SkinHostProvider"));
      // the copied prompt follows the selected skin
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('import Paper from "agui-skins/skins/paper"'));
    });
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.getAllByText("已复制").length).toBeGreaterThan(0);
    });
  });

  it("copies the install command from the dropdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(createElement(QuickStart, { lang: "zh", activeSkin: "aurora" }));
    openMenu();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /复制安装命令/ }), { key: "Enter" });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(INSTALL_COMMAND);
    });
  });

  it("builds prefill deep links for ChatGPT / Claude", () => {
    render(createElement(QuickStart, { lang: "zh", activeSkin: "aurora" }));
    openMenu();
    const links = (screen.getAllByRole("menuitem") as HTMLElement[]).filter(
      (el) => el.tagName === "A"
    ) as HTMLAnchorElement[];
    const hrefs = links.map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.startsWith("https://chatgpt.com/?q="))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("https://claude.ai/new?q="))).toBe(true);
    for (const href of hrefs) expect(href.length).toBeLessThanOrEqual(8000);
  });

  it("closes the dropdown with Escape", async () => {
    render(createElement(QuickStart, { lang: "zh", activeSkin: "aurora" }));
    openMenu();
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("renders the English variant", () => {
    const { container } = render(createElement(QuickStart, { lang: "en", activeSkin: "aurora" }));
    expect(container.textContent).toContain("Get started");
    expect(container.textContent).toContain("Use them in your own app");
    expect(container.textContent).toContain("Connect a real agent");
  });
});
