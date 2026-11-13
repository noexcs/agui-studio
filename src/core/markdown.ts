/** Plain-text extraction for compact previews (search results, tool titles). */
export function plainText(src: string, max = 120): string {
  const text = src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`|]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}
