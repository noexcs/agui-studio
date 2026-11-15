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
export type ToolResultVariant = "aurora" | "paper" | "terminal" | "brutalist" | "classic" | "particle";

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
    <div className="tool-result mt-2 border-t border-(--border) [border-top-style:dashed] pt-2">
      <div className="tool-result-head mb-[5px] flex items-center gap-[6px] text-[10px] text-(--text-3)">
        <Icon name="globe" />
        {sources.length} {t("chat.sources")}
      </div>
      <div className="tool-result-list flex flex-col gap-[5px]">
        {sources.map((source, index) => {
          const title = label(source);
          const body = (
            <>
              <span className="tool-source-num [font-family:var(--mono)] text-[9.5px] text-(--text-3)">{String(index + 1).padStart(2, "0")}</span>
              <span className="tool-source-title min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis text-[11px] text-(--text) group-hover:text-(--cyan)">{title}</span>
              <Icon name="arrow-up-right" />
            </>
          );
          return source.href ? (
            <a key={`source-${index}`} className="tool-source group flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.045)] bg-[rgba(255,255,255,0.03)] px-[9px] py-[6px] no-underline [transition:background_0.2s] hover:bg-[rgba(255,255,255,0.06)]" href={source.href} target="_blank" rel="noreferrer">
              {body}
            </a>
          ) : (
            <div key={`source-${index}`} className="tool-source group flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.045)] bg-[rgba(255,255,255,0.03)] px-[9px] py-[6px] [transition:background_0.2s] hover:bg-[rgba(255,255,255,0.06)]">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourcesClassic({ sources }: { sources: ToolSource[] }) {
  /* former classic.css rules for these classes, converted (task-13 Phase 2b):
     the accent color on links stays in the residual .cl-sources a rule
     (accent-guard test anchor). */
  const LIST = "cl-sources m-0 px-[12px] py-[8px] list-none border-t border-(--border)";
  const LI = "flex items-baseline gap-[8px] text-[11.5px] py-[2px] [&>span]:text-[10px] [&>span]:text-(--faint) [&>a:hover]:underline";
  return (
    <ul className={LIST}>
      {sources.map((source, index) => (
        <li key={`source-${index}`} className={LI}>
          <span className="mono">{String(index + 1).padStart(2, "0")}</span>
          {source.href ? (
            <a className="no-underline" href={source.href} target="_blank" rel="noreferrer">
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
    <ol className="pap-sources [margin:6px_0_0] p-0 list-none flex flex-col gap-[2px]">
      {sources.map((source, index) => (
        <li key={`source-${index}`} className="text-[10px] text-(--ink-3) before:content-['→_'] before:text-(--ink-3)">
          {source.href ? (
            <a href={source.href} target="_blank" rel="noreferrer" className="text-(--ink-2) border-b border-(--rule) hover:text-[var(--accent-text,var(--vermilion))]">
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
    <div className="term-tool-result mt-[5px] ml-[20px] text-[11px] text-[#a8c7b6]">
      {sources.map((source, index) => (
        <div key={`source-${index}`} className="term-tree">
          <span className="term-dim text-(--dim)">{index === sources.length - 1 ? "└" : "├"}</span>{" "}
          {source.href ? (
            <a href={source.href} target="_blank" rel="noreferrer" className="text-[#cfe9dc] border-b border-[rgba(140,255,176,0.26)] [border-bottom-style:dotted] hover:text-(--cyan)">
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
  /* former brutalist.css rules for these classes, converted (task-13 Phase 2a) */
  const LIST = "bru-tool-results flex flex-col gap-[3px] border-t-[1.5px] border-(--ink) [border-top-style:dashed] px-[12px] py-[7px]";
  const LINK =
    "[font-family:IBM_Plex_Mono,monospace] text-[10px] text-[#33302a] border-b-[1.5px] border-b-transparent hover:bg-(--yellow) hover:border-b-(--ink)";
  return (
    <div className={LIST}>
      {sources.map((source, index) => {
        const title = `${String(index + 1).padStart(2, "0")} ${label(source)} ↗`;
        return source.href ? (
          <a key={`source-${index}`} href={source.href} target="_blank" rel="noreferrer" className={LINK}>
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
  /* aurora + particle share this renderer. Values were aurora.css top-level
     rules (never .skin-aurora-scoped), so they applied to particle too;
     particle's unlayered .pt-tool rules still win over every utility they
     override, and undefined aurora tokens (--border/--mono/…) degrade to
     inherit exactly as the var() calls did before the migration. The old
     `.tool-result-head .icon` / `.tool-source .icon` sizing rules are dead
     (svgs carry no .icon class) and are deliberately NOT reproduced.
     max-height: base 132px, aurora-scoped 148px (the original
     .skin-aurora .tool-args override, kept via the arbitrary variant). */
  const RESULT = "tool-result mt-2 border-t border-(--border) [border-top-style:dashed] pt-2";
  const HEAD = "tool-result-head mb-[5px] flex items-center gap-[6px] text-[10px] text-(--text-3)";
  const ARGS =
    "tool-args max-h-[132px] [.skin-aurora_&]:max-h-[148px] overflow-auto whitespace-pre-wrap break-words rounded-[9px] border border-[rgba(255,255,255,0.05)] bg-[rgba(0,0,0,0.3)] px-[10px] py-2 [font-family:var(--mono)] text-[11px] leading-[1.62] text-[#a9b8cc]";
  return (
    <>
      {model.error !== undefined && (
        <div className={RESULT}>
          <div className={HEAD}>
            <Icon name="x" />
            {t("chat.failed")}
          </div>
          <div className={ARGS} data-skin-text="">
            {model.error}
          </div>
        </div>
      )}
      {model.sources && <SourcesAurora sources={model.sources} />}
      {model.reservation !== undefined && (
        <div className={RESULT}>
          <div className={HEAD}>
            <Icon name="check" />
            {t("chat.held")}
          </div>
          <div className={ARGS} data-skin-text="">
            {model.reservation}
          </div>
        </div>
      )}
      {model.text !== undefined && (
        <div className={RESULT}>
          <div className={HEAD}>
            <Icon name="check" />
            {t("chat.result")}
          </div>
          <div className={ARGS} data-skin-text="">
            {model.text}
          </div>
        </div>
      )}
      {model.json !== undefined && (
        <div className={RESULT}>
          <div className={HEAD}>
            <Icon name="braces" />
            {t("chat.result")}
          </div>
          <div className={ARGS} data-skin-text="">
            {model.json}
          </div>
        </div>
      )}
    </>
  );
}

function ToolResultClassic({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  /* former classic.css rules for these classes, converted (task-13 Phase 2b) */
  const ERROR =
    "cl-tool-error mt-0 mb-[8px] mx-[12px] px-[9px] py-[6px] border border-[#fecaca] rounded-[6px] bg-[#fef2f2] text-(--danger) text-[11.5px] leading-[1.5]";
  const NOTE =
    "cl-tool-note mono m-0 px-[12px] py-[8px] border-t border-(--border) text-[11px] text-(--success)";
  const RESULT =
    "cl-tool-result m-0 px-[12px] py-[10px] border-t border-(--border) bg-[#f9fafb] [font-family:var(--mono)] text-[11px] leading-[1.55] text-(--text-2) whitespace-pre-wrap break-words";
  return (
    <>
      {model.error !== undefined && (
        <p className={ERROR} role="alert">
          {model.error}
        </p>
      )}
      {model.sources && <SourcesClassic sources={model.sources} />}
      {model.reservation !== undefined && (
        <p className={NOTE}>
          {t("chat.held")} · {model.reservation}
        </p>
      )}
      {model.text !== undefined && (
        <pre className={RESULT} data-skin-text="">
          {model.text}
        </pre>
      )}
      {model.json !== undefined && (
        <pre className={RESULT} data-skin-text="">
          {model.json}
        </pre>
      )}
    </>
  );
}

function ToolResultPaper({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  /* former paper.css rules for these classes, converted (task-13 Phase 2a):
     .pap-result / .pap-check / .pap-args / .pap-note-meta(--error) live here
     and in paper's ToolNote; .pap-note-meta--error is a vermilion variant of
     the meta line (mono bold ✗ mark). */
  const P_RESULT = "pap-result flex items-center gap-[6px] mt-[6px] [font-family:var(--mono)] text-[9.5px] text-(--green)";
  const P_META = "pap-note-meta ml-auto [font-family:var(--mono)] text-[8.5px] tracking-normal normal-case text-(--ink-3)";
  const P_ARGS =
    "pap-args m-0 [font-family:var(--mono)] text-[9.5px] leading-[1.6] text-(--ink-2) bg-[rgba(29,27,23,0.04)] border border-(--rule) px-[8px] py-[6px] max-h-[92px] overflow-auto whitespace-pre-wrap break-words";
  return (
    <>
      {model.error !== undefined && (
        <div className="pap-note-meta pap-note-meta--error ml-auto [font-family:var(--mono)] text-[8.5px] tracking-normal normal-case text-[var(--accent-text,var(--vermilion))]">
          <span className="pap-fail [font-family:var(--mono)] font-bold mr-[2px]">✗</span> {model.error}
        </div>
      )}
      {model.sources && (
        <>
          <div className={P_RESULT}>
            <span className="pap-check text-[10px]">✓</span>
            {model.sources.length} {t("chat.sources")}
            <span className={P_META}>{duration(entry)}</span>
          </div>
          <SourcesPaper sources={model.sources} />
        </>
      )}
      {model.reservation !== undefined && (
        <div className={P_RESULT}>
          <span className="pap-check text-[10px]">✓</span>
          {t("chat.held")} · {model.reservation}
          <span className={P_META}>{duration(entry)}</span>
        </div>
      )}
      {model.text !== undefined && (
        <>
          <div className={P_RESULT}>
            <span className="pap-check text-[10px]">✓</span>
            {t("chat.result")}
            <span className={P_META}>{duration(entry)}</span>
          </div>
          <pre className={P_ARGS} data-skin-text="">
            {model.text}
          </pre>
        </>
      )}
      {model.json !== undefined && (
        <>
          <div className={P_RESULT}>
            <span className="pap-check text-[10px]">✓</span>
            {t("chat.result")}
            <span className={P_META}>{duration(entry)}</span>
          </div>
          <pre className={P_ARGS} data-skin-text="">
            {model.json}
          </pre>
        </>
      )}
    </>
  );
}

function ToolResultTerminal({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  /* former terminal.css rules for these classes, converted (task-13 Phase 2a) */
  const T_RESULT = "term-tool-result mt-[5px] ml-[20px] text-[11px] text-[#a8c7b6]";
  const T_JSON =
    "term-tool-json mt-[6px] mb-0 ml-[20px] px-[11px] py-[8px] border border-dashed border-(--line) text-[#8fb3a1] text-[10.5px] leading-[1.55] max-h-[120px] overflow-auto whitespace-pre-wrap";
  return (
    <>
      {model.error !== undefined && (
        <div className={T_RESULT}>
          <span className="term-dim text-(--dim)">└</span> {model.error}
        </div>
      )}
      {model.sources && <SourcesTerminal sources={model.sources} />}
      {model.reservation !== undefined && (
        <div className={T_RESULT}>
          <span className="term-dim text-(--dim)">└</span> {t("chat.held")} · {model.reservation}
        </div>
      )}
      {model.text !== undefined && <pre className={T_JSON}>{model.text}</pre>}
      {model.json !== undefined && <pre className={T_JSON}>{model.json}</pre>}
    </>
  );
}

function ToolResultBrutalist({ entry, model }: { entry: ToolEntry; model: ToolResultModel }) {
  /* former brutalist.css rules for these classes, converted (task-13 Phase 2a) */
  const LIST = "bru-tool-results flex flex-col gap-[3px] border-t-[1.5px] border-(--ink) [border-top-style:dashed] px-[12px] py-[7px]";
  const ARGS =
    "bru-tool-args m-0 max-h-[130px] overflow-auto whitespace-pre-wrap px-[12px] py-[10px] [font-family:IBM_Plex_Mono,monospace] text-[10.5px] leading-[1.55] text-[#33302a]";
  return (
    <>
      {model.error !== undefined && (
        <div className={LIST}>
          <span>{t("chat.failed")} · </span>
          {model.error}
        </div>
      )}
      {model.sources && <SourcesBrutalist sources={model.sources} />}
      {model.reservation !== undefined && (
        <div className={LIST}>
          {t("bru.held")} · {model.reservation}
        </div>
      )}
      {model.text !== undefined && (
        <pre className={ARGS} data-skin-text="">
          {model.text}
        </pre>
      )}
      {model.json !== undefined && (
        <pre className={ARGS} data-skin-text="">
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
    case "particle":
      return <ToolResultAurora entry={entry} model={model} />;
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
