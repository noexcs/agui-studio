/* Small helpers shared by skins (no app dependencies). */

export const formatDuration = (ms: number) => {
  if (!ms || ms < 0) return "0s";
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60_000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60_000) + "m " + Math.round((ms % 60_000) / 1000) + "s";
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const escapeText = escapeHtml;

/**
 * Markdown → plain text for compact previews (tool titles, alerts).
 *
 * Total by design: third-party streams put `null`, objects and numbers where
 * the demo contract promises strings, and the old `.replace` implementation
 * threw on every one of them. Non-text values fall back to "" (or a safe
 * coercion for scalar primitives) instead of crashing a skin.
 */
export function plainText(src: unknown, max = 120): string {
  let text: string;
  if (typeof src === "string") {
    text = src;
  } else if (typeof src === "number" || typeof src === "boolean" || typeof src === "bigint") {
    text = String(src);
  } else {
    return "";
  }
  const limit = typeof max === "number" && Number.isFinite(max) && max >= 0 ? Math.floor(max) : 120;
  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`|]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? text.slice(0, limit).trimEnd() + "…" : text;
}

export const estimateTokens = (text: string) => Math.round((text || "").length / 4);
