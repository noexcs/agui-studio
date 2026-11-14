import { describe, expect, it } from "vitest";
import {
  AA_NORMAL_TEXT,
  DARK_INK,
  accentGuard,
  safeAccent,
} from "agui-skins";


/* ── Fix E: accent → foreground judgment tool (color2k-backed WCAG math) ── */

// the eight swatches shipped in the customize panel
const PANEL_ACCENTS = [
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#db2777",
  "#0f172a",
];

describe("Fix E: accentGuard tiers", () => {
  it("light accent #facc15: dark-fg on the accent + darkened ink for text + tooLight hint", () => {
    const guard = accentGuard("#facc15");
    expect(guard.tier).toBe("dark-fg");
    expect(guard.onAccentFg).toBe(DARK_INK);
    expect(guard.onAccentRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    // the audit case: yellow as link text on white is far below AA
    expect(guard.asTextRatio).toBeLessThan(AA_NORMAL_TEXT);
    expect(guard.tooLight).toBe(true);
    expect(guard.tooDark).toBe(false);
    expect(guard.inkOnLight).toMatch(/^#[0-9a-f]{6}$/);
    expect(guard.inkOnLightRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("dark accent #0f172a: light-fg (deep bg → light text), no ink, tooDark hint", () => {
    const guard = accentGuard("#0f172a");
    expect(guard.tier).toBe("light-fg");
    expect(guard.onAccentFg).toBe("#ffffff");
    expect(guard.onAccentRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(guard.inkOnLight).toBeNull();
    expect(guard.inkOnLightRatio).toBeNull();
    expect(guard.tooDark).toBe(true);
    expect(guard.tooLight).toBe(false);
  });

  it("boundary: #767676 (4.54:1) stays as-is, #777777 (4.48:1) gets inked", () => {
    const passes = accentGuard("#767676");
    expect(passes.asTextRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(passes.inkOnLight).toBeNull();
    expect(passes.tooLight).toBe(false);

    const fails = accentGuard("#777777");
    expect(fails.asTextRatio).toBeLessThan(AA_NORMAL_TEXT);
    expect(fails.inkOnLight).toBeTruthy();
    expect(fails.inkOnLightRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(fails.tooLight).toBe(true);
  });

  it("every panel swatch keeps an AA foreground on its own background", () => {
    for (const hex of PANEL_ACCENTS) {
      const guard = accentGuard(hex);
      expect(guard.onAccentRatio, hex).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it("default blue keeps white text and needs no ink (legacy rendering preserved)", () => {
    const guard = accentGuard("#2563eb");
    expect(guard.tier).toBe("light-fg");
    expect(guard.onAccentFg).toBe("#ffffff");
    expect(guard.inkOnLight).toBeNull();
    expect(guard.tooLight).toBe(false);
  });

  it("degenerate accents terminate: pure white and pure black", () => {
    const white = accentGuard("#ffffff");
    expect(white.tier).toBe("dark-fg");
    expect(white.inkOnLightRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);

    const black = accentGuard("#000000");
    expect(black.tier).toBe("light-fg");
    expect(black.onAccentRatio).toBe(21);
    expect(black.inkOnLight).toBeNull();
  });

  it("mid gray passes on white and stays above the dark-skin component floor", () => {
    const guard = accentGuard("#6b7280");
    // 4.8:1 as text on white, 4.0:1 on the dark reference — quiet everywhere
    expect(guard.asTextRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(guard.tooLight).toBe(false);
    expect(guard.tooDark).toBe(false);
  });

  it("only genuinely dark accents (below the 3:1 component floor) flag tooDark", () => {
    // shipped palette colors sit above the floor on dark skins — no noise
    for (const hex of ["#2563eb", "#dc2626", "#db2777", "#0891b2", "#d97706"]) {
      expect(accentGuard(hex).tooDark, hex).toBe(false);
    }
    // near-black ink is unreadable as highlight on dark glass
    expect(accentGuard("#0f172a").onDarkRatio).toBeLessThan(3);
    expect(accentGuard("#0f172a").tooDark).toBe(true);
  });
});

describe("Fix E: fixed dark-skin colors clear AA on their reference surfaces", () => {
  it("aurora --text-3 replacement reads ≥4.5:1 on the darkest panel it renders on", () => {
    // #0c0e14 is the lightest dark surface --text-3 sits on (worst case)
    expect(accentGuard("#7b8496").onDarkRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("terminal placeholder replacement reads ≥4.5:1 on the composer background", () => {
    expect(accentGuard("#63826e").onDarkRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe("Fix E: safeAccent", () => {
  it("normalizes css colors to lowercase hex", () => {
    expect(safeAccent("#FACC15")).toBe("#facc15");
    expect(safeAccent("rgb(250, 204, 21)")).toBe("#facc15");
    expect(safeAccent("yellow")).toBe("#ffff00");
  });

  it("returns null for garbage so the host can fall back to legacy rendering", () => {
    expect(safeAccent("not-a-color")).toBeNull();
    expect(safeAccent("rgb(")).toBeNull();
    expect(safeAccent("")).toBeNull();
  });
});
