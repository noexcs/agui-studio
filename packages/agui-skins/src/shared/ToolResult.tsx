import type { ToolEntry } from "../contract";
import { t } from "../i18n";
import { formatDuration, plainText } from "../utils";
import { Icon } from "./Icon";
import { displayText, isRecord, safeHref, safeJson } from "./safe";

/**
 * Shared, total renderer for a normalized ToolEntry result.
 *
 * The demo fixtures return `{results:[{title,url}]}` or `{reservation}` and the
 * old skins cast the unknown result straight to that shape. Third-party agents
 * return strings, arbitrary JSON, ContentPart arrays, `null` items, or no
 * result at all; every one of those must render (or visibly fall back) instead
 * of throwing. Each skin keeps its own visual language via its existing
 * classes; only the data-shape decisions live here.
 */
export type ToolResultVariant = "aurora" | "paper" | "terminal" | "brutalist" | "classic";

export interface ToolSource {
  title: string;
  href?: string;
  detail?: string;
}

export interface ToolResultModel {
  error?: string;
  sources?: ToolSource[];
  reservation?: string;
  text?: string;
  json?: string;
  empty: boolean;
}

/** ContentPart[] → plain text, or undefined when the array is not text parts. */
function contentPartsText(value: unknown[]): string | undefined {
  if (value.length === 0) return undefined;
  const parts: string[] = [];
  for (const part of value) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (!isRecord(part)) return undefined;
    const type = typeof part.type === "string" ? part.type : undefined;
    // Only text-ish parts become text; images/files/tool calls fall back to
    // JSON so their URLs/payloads are not hidden behind a placeholder.
    if (type !== undefined && type !== "text") return undefined;
    if (typeof part.text === "string") {
      parts.push(part.text);
      continue;
    }
    if (typeof part.content === "string") {
      parts.push(part.content);
      continue;
    }
    // A recognised-ish part without text: fall back to JSON rather than hide it.
    return undefined;
  }
  return parts.join("\n");
}

function sourceItem(item: unknown, index: number): ToolSource {
  const fallback = `#${index + 1}`;
  if (isRecord(item)) {
    const titleValue = item.title ?? item.name ?? item.label ?? item.text ?? item.url ?? item.href;
    const title = plainText(displayText(titleValue), 160).trim() || fallback;
    const href = safeHref(item.url ?? item.href);
    const detailValue = item.detail ?? item.description;
    return {
      title,
      ...(href ? { href } : {}),
      ...(detailValue === undefined ? {} : { detail: plainText(displayText(detailValue), 160) }),
    };
  }
  if (typeof item === "string") {
    return { title: plainText(item, 160).trim() || fallback, ...(safeHref(item) ? { href: item } : {}) };
  }
  return { title: plainText(displayText(item), 160).trim() || fallback };
}

/** Turn an entry's untyped `result`/`error` into a safe render model. */
export function toolResultModel(entry: ToolEntry): ToolResultModel {
  const model: ToolResultModel = { empty: true };

  if (entry.error !== undefined && entry.error !== null) {
    const error = displayText(entry.error).trim();
    if (error) model.error = error;
  }

  const result = entry.result;
  if (result !== undefined) {
    if (typeof result === "string") {
      model.text = result;
    } else if (result === null) {
      model.json = "null";
    } else if (Array.isArray(result)) {
      const text = contentPartsText(result);
      if (text === undefined) model.json = safeJson(result);
      else model.text = text;
    } else if (isRecord(result)) {
      const results = result.results;
      if (Array.isArray(results)) model.sources = results.map(sourceItem);
      if (
        Object.prototype.hasOwnProperty.call(result, "reservation") &&
        result.reservation !== undefined &&
        result.reservation !== null
      ) {
        model.reservation = displayText(result.reservation) || safeJson(result.reservation);
      }
      if (!model.error && typeof result.error === "string" && result.error.trim()) {
        model.error = result.error.trim();
      }
      // A result object that is neither a source list nor a reservation is
      // still data: pretty-print it instead of silently dropping it (also when
      // an error field is present alongside the payload).
      if (!Array.isArray(results) && model.reservation === undefined) {
        model.json = safeJson(result);
      }
    } else {
      model.text = displayText(result);
    }
  }

  if (
    model.error === undefined &&
    model.sources === undefined &&
    model.reservation === undefined &&
    model.text === undefined &&
    model.json === undefined
  ) {
    if (entry.status === "error") model.error = t("chat.failed");
    return model;
  }

  model.empty = false;
  return model;
}

/** Does this entry have anything for a tool result area to render? */
export function hasToolResultContent(entry: ToolEntry): boolean {
  return !toolResultModel(entry).empty;
}

function label(source: ToolSource): string {
  return source.title;
}

function SourcesAurora({ sources }: { sources: ToolSource[] }) {
  return (
    <div className="tool-result">
      <div className="tool-result-head">
        <Icon name="globe" />
        {sources.length} {t("chat.sources")}
      </div>
      <div className="tool-result-list">
        {sources.map((source, index) => {
          const title = label(source);
          const body = (
            <>
              <span className="tool-source-num">{String(index + 1).padStart(2, "0")}</span>
              <span className="tool-source-title">{title}</span>
              <Icon name="arrow-up-right" />
            </>
          );
          return source.href ? (
            <a key={`source-${index}`} className="tool-source" href={source.href} target="_blank" rel="noreferrer">
              {body}
            </a>
          ) : (
            <div key={`source-${index}`} className="tool-source">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourcesClassic({ sources }: { sources: ToolSource[] }) {
  return (
    <ul className="cl-sources">
      {sources.map((source, index) => (
        <li key={`source-${index}`}>
          <span className="mono">{String(index + 1).padStart(2, "0")}</span>
          {source.href ? (
            <a href={source.href} target="_blank" rel="noreferrer">
              {label(source)}
            </a>
          ) : (
            <span>{label(source)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SourcesPaper({ sources }: { sources: ToolSource[] }) {
  return (
    <ol className="pap-sources">
      {sources.map((source, index) => (
        <li key={`source-${index}`}>
          {source.href ? (
            <a href={source.href} target="_blank" rel="noreferrer">
              {label(source)}
            </a>
          ) : (
            <span>{label(source)}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function SourcesTerminal({ sources }: { sources: ToolSource[] }) {
  return (
    <div className="term-tool-result">
      {sources.map((source, index) => (
        <div key={`source-${index}`} className="term-tree">
          <span className="term-dim">{index === sources.length - 1 ? "└" : "├"}</span>{" "}
          {source.href ? (
            <a href={source.href} target="_blank" rel="noreferrer">
              {label(source)}
            </a>
          ) : (
            <span>{label(source)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function SourcesBrutalist({ sources }: { sources: ToolSource[] }) {
  return (
    <div className="bru-tool-results">
      {sources.map((source, index) => {
        const title = `${String(index + 1).padStart(2, "0")} ${label(source)} ↗`;
        return source.href ? (
          <a key={`source-${index}`} href={source.href} target="_blank" rel="noreferrer">
            {title}
          </a>
        ) : (
          <span key={`source-${index}`}>{title}</span>
        );
      })}
    </div>
  );
}

function duration(entry: ToolEntry): string {
  return entry.durationMs ? formatDuration(entry.durationMs) : "";
}

function ToolResultAurora({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  return (
    <>
      {model.error !== undefined && (
        <div className="tool-result">
          <div className="tool-result-head">
            <Icon name="x" />
            {t("chat.failed")}
          </div>
          <div className="tool-args" data-skin-text="">
            {model.error}
          </div>
        </div>
      )}
      {model.sources && <SourcesAurora sources={model.sources} />}
      {model.reservation !== undefined && (
        <div className="tool-result">
          <div className="tool-result-head">
            <Icon name="check" />
            {t("chat.held")}
          </div>
          <div className="tool-args" data-skin-text="">
            {model.reservation}
          </div>
        </div>
      )}
      {model.text !== undefined && (
        <div className="tool-result">
          <div className="tool-result-head">
            <Icon name="check" />
            {t("chat.result")}
          </div>
          <div className="tool-args" data-skin-text="">
            {model.text}
          </div>
        </div>
      )}
      {model.json !== undefined && (
        <div className="tool-result">
          <div className="tool-result-head">
            <Icon name="braces" />
            {t("chat.result")}
          </div>
          <div className="tool-args" data-skin-text="">
            {model.json}
          </div>
        </div>
      )}
    </>
  );
}

function ToolResultClassic({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  return (
    <>
      {model.error !== undefined && (
        <p className="cl-tool-error" role="alert">
          {model.error}
        </p>
      )}
      {model.sources && <SourcesClassic sources={model.sources} />}
      {model.reservation !== undefined && (
        <p className="cl-tool-note mono">
          {t("chat.held")} · {model.reservation}
        </p>
      )}
      {model.text !== undefined && (
        <pre className="cl-tool-result" data-skin-text="">
          {model.text}
        </pre>
      )}
      {model.json !== undefined && (
        <pre className="cl-tool-result" data-skin-text="">
          {model.json}
        </pre>
      )}
    </>
  );
}

function ToolResultPaper({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  return (
    <>
      {model.error !== undefined && (
        <div className="pap-note-meta pap-note-meta--error">
          <span className="pap-fail">✗</span> {model.error}
        </div>
      )}
      {model.sources && (
        <>
          <div className="pap-result">
            <span className="pap-check">✓</span>
            {model.sources.length} {t("chat.sources")}
            <span className="pap-note-meta">{duration(entry)}</span>
          </div>
          <SourcesPaper sources={model.sources} />
        </>
      )}
      {model.reservation !== undefined && (
        <div className="pap-result">
          <span className="pap-check">✓</span>
          {t("chat.held")} · {model.reservation}
          <span className="pap-note-meta">{duration(entry)}</span>
        </div>
      )}
      {model.text !== undefined && (
        <>
          <div className="pap-result">
            <span className="pap-check">✓</span>
            {t("chat.result")}
            <span className="pap-note-meta">{duration(entry)}</span>
          </div>
          <pre className="pap-args" data-skin-text="">
            {model.text}
          </pre>
        </>
      )}
      {model.json !== undefined && (
        <>
          <div className="pap-result">
            <span className="pap-check">✓</span>
            {t("chat.result")}
            <span className="pap-note-meta">{duration(entry)}</span>
          </div>
          <pre className="pap-args" data-skin-text="">
            {model.json}
          </pre>
        </>
      )}
    </>
  );
}

function ToolResultTerminal({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  return (
    <>
      {model.error !== undefined && (
        <div className="term-tool-result">
          <span className="term-dim">└</span> {model.error}
        </div>
      )}
      {model.sources && <SourcesTerminal sources={model.sources} />}
      {model.reservation !== undefined && (
        <div className="term-tool-result">
          <span className="term-dim">└</span> {t("chat.held")} · {model.reservation}
        </div>
      )}
      {model.text !== undefined && <pre className="term-tool-json">{model.text}</pre>}
      {model.json !== undefined && <pre className="term-tool-json">{model.json}</pre>}
    </>
  );
}

function ToolResultBrutalist({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  return (
    <>
      {model.error !== undefined && (
        <div className="bru-tool-results">
          <span>{t("chat.failed")} · </span>
          {model.error}
        </div>
      )}
      {model.sources && <SourcesBrutalist sources={model.sources} />}
      {model.reservation !== undefined && (
        <div className="bru-tool-results">
          {t("bru.held")} · {model.reservation}
        </div>
      )}
      {model.text !== undefined && (
        <pre className="bru-tool-args" data-skin-text="">
          {model.text}
        </pre>
      )}
      {model.json !== undefined && (
        <pre className="bru-tool-args" data-skin-text="">
          {model.json}
        </pre>
      )}
    </>
  );
}

export function ToolResult({ entry, variant }: { entry: ToolEntry; variant: ToolResultVariant }) {
  const model = toolResultModel(entry);
  if (model.empty) return null;
  switch (variant) {
    case "aurora":
      return <ToolResultAurora entry={entry} model={model} />;
    case "classic":
      return <ToolResultClassic entry={entry} model={model} />;
    case "paper":
      return <ToolResultPaper entry={entry} model={model} />;
    case "terminal":
      return <ToolResultTerminal entry={entry} model={model} />;
    case "brutalist":
      return <ToolResultBrutalist entry={entry} model={model} />;
    default:
      return null;
  }
}
