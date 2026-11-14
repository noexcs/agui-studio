/**
 * Per-skin palette dots for the shell's skin cards (gradientdeck-style
 * swatch rows). Values are hand-extracted from each skin's own CSS in
 * packages/agui-skins (which stays frozen): aurora's glass-dark/green/cyan/violet,
 * paper's vermilion/green, terminal's phosphor trio, brutalist's ink/yellow/red,
 * classic's blue.
 *
 * IMPORTANT: these hexes are CONTENT DATA — each skin's real brand colors,
 * shown as swatch dots so the cards honestly preview the skin below. They are
 * NOT the shell's chrome accent (the shell chrome accent is violet only, see
 * shell.css :root). Any grep hit here is expected and by design.
 */
export const SKIN_SWATCHES: Record<string, string[]> = {
  aurora: ["#06070a", "#161b26", "#5ef0c2", "#5ac8ff", "#a78bfa"],
  paper: ["#f4efe4", "#1d1b17", "#b4472c", "#2f5d4e"],
  terminal: ["#05070a", "#0c1310", "#8cffb0", "#ffd479", "#7fd8ff"],
  brutalist: ["#f2efe6", "#111111", "#ffe14d", "#ff4d2e", "#fffdf7"],
  classic: ["#f7f8fa", "#ffffff", "#2563eb", "#111827"],
};

/** Swatch list for a skin id; falls back to the skin accent (unknown/test ids). */
export function skinSwatches(id: string, accent?: string): string[] {
  return SKIN_SWATCHES[id] ?? [accent ?? "#a855f7"];
}
