/**
 * Rehype transform used by the universal text-output effect.
 *
 * Markdown renders to HTML; to animate *new* text while it streams we wrap the
 * individual words (or characters for typewriter) in spans. React reuses the
 * existing spans when more text arrives, so only the appended tokens mount and
 * run their CSS animation — that is the streaming effect.
 */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export function createTextTokenRehype(by: "word" | "char") {
  const split = (text: string): HastNode[] => {
    const parts = by === "char" ? Array.from(text) : text.match(/\s+|\S+/g) ?? [text];
    return parts.map((part) =>
      /^\s+$/.test(part)
        ? { type: "text", value: part }
        : {
            type: "element",
            tagName: "span",
            properties: { className: ["sk-text-token"] },
            children: [{ type: "text", value: part }],
          }
    );
  };

  const walk = (node: HastNode) => {
    if (!node.children) return;
    if (node.tagName === "pre" || node.tagName === "code") return;
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string") {
        next.push(...split(child.value));
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };

  return () => (tree: HastNode) => walk(tree);
}
