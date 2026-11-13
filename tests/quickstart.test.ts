import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins } from "agui-skins";
import { buildAiPrompt, copyText, INSTALL_COMMAND, prefillUrl, QuickStart } from "../src/app/QuickStart";

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
    expect(skins.length).toBe(5);
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
    expect(prompt).toContain("HttpAgentTransport({ url, headers? }).run(input, signal?)");
    expect(prompt).toContain("Aurora.ChatPage");
    expect(prompt).toContain('import Aurora from "agui-skins/skins/aurora"');
  });

  it("covers the known pitfalls (interrupt resume, JSON Patch state)", () => {
    expect(prompt).toContain("expiresAt");
    expect(prompt).toContain("JSON Patch");
    expect(prompt).toContain("outcome.type === \"interrupt\"");
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
    const { container } = render(createElement(QuickStart, { lang: "zh" }));
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

  it("opens the Copy for AI dropdown and copies the prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(createElement(QuickStart, { lang: "zh" }));

    const trigger = screen.getByText("Copy for AI");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("复制接入提示词");
    expect(menu.textContent).toContain("复制安装命令");
    expect(menu.textContent).toContain("在 ChatGPT 打开");
    expect(menu.textContent).toContain("在 Claude 打开");
    expect(menu.textContent).toContain("在 v0 打开");

    fireEvent.click(screen.getByText("复制接入提示词"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining(INSTALL_COMMAND));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("SkinHostProvider"));
    });
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.getByText("已复制")).toBeTruthy();
    });
  });

  it("copies the install command from the dropdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(createElement(QuickStart, { lang: "zh" }));
    fireEvent.click(screen.getByText("Copy for AI"));
    fireEvent.click(screen.getByText("复制安装命令"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("pnpm add agui-skins");
    });
  });

  it("builds prefill deep links for ChatGPT / Claude / v0", () => {
    render(createElement(QuickStart, { lang: "zh" }));
    fireEvent.click(screen.getByText("Copy for AI"));
    const links = screen.getAllByRole("menuitem") as HTMLAnchorElement[];
    const hrefs = links.map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.startsWith("https://chatgpt.com/?q="))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("https://claude.ai/new?q="))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("https://v0.dev/chat?q="))).toBe(true);
    for (const href of hrefs.filter((h) => h.startsWith("http"))) {
      expect(href.length).toBeLessThanOrEqual(8000);
    }
  });

  it("closes the dropdown on Escape and on outside click", () => {
    render(createElement(QuickStart, { lang: "zh" }));
    fireEvent.click(screen.getByText("Copy for AI"));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByText("Copy for AI"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("toggles open/closed on repeated trigger clicks", () => {
    render(createElement(QuickStart, { lang: "zh" }));
    const trigger = screen.getByText("Copy for AI");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders the English variant", () => {
    const { container } = render(createElement(QuickStart, { lang: "en" }));
    expect(container.textContent).toContain("Get started");
    expect(container.textContent).toContain("Use them in your own app");
    expect(container.textContent).toContain("Connect a real agent");
  });
});
