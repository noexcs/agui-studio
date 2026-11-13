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

/** Markdown → plain text for compact previews (tool titles, alerts). */
export function plainText(src: string, max = 120): string {
  const text = src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`|]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

export const estimateTokens = (text: string) => Math.round((text || "").length / 4);
