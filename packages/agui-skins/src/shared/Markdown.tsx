import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Assistant markdown, rendered by react-markdown + remark-gfm instead of a
 * hand-written parser (which is where the half-streamed-table infinite loop
 * used to live). Skins only style the `.md` wrapper and its elements.
 */
export function Markdown({ text, className = "md" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const timeOf = (ms?: number) =>
  new Date(ms || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
};
