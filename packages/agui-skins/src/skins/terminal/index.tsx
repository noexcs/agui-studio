import { useEffect, useMemo, useRef, useState } from "react";
import { useConversation, useSkinPlugins } from "../../host";
import type { AssistantEntry, CustomEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, StepEntry, ToolEntry } from "../../contract";
import { formatDuration } from "../../utils";
import { ToolResult } from "../../shared/ToolResult";
import { planView, planRawText } from "../../shared/plan";
import { displayText, safeJson } from "../../shared/safe";
import { t } from "../../i18n";
import { Markdown, timeOf } from "../../shared/Markdown";
import { pendingInterrupts } from "../../shared/interrupts";
import {
  conversationGroups,
  foldGroupDuration,
  foldGroupFailures,
  foldGroupOpen,
} from "../../shared/conversationGroups";
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { useStickToBottom } from "../../shared/useStickToBottom";
import "./terminal.css";

/* ═══ Tailwind migration (task-13 Phase 2a) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-term tokens via arbitrary var shorthand, so --sk-accent
   tuning and app.css's unlayered .lang-zh override keep working.
   terminal.css keeps only tokens/keyframes/the CRT scanlines/.term-md
   (generated markdown elements)/scrollbars/focus ring/reduced-motion.
   Residual notes:
   • same-property state branches are written branch-exclusive (full values
     per branch, base string keeps none of those properties) — Tailwind's
     fixed utility sort, not intent, would otherwise pick the winner;
   • per-side widths pair with per-side arbitrary styles where the original
     was a one-side border (all-side style utilities would expose the UA
     default medium width on the unset sides — see the paper commit);
   • the 1180px media query became max-[1180px]: variants (v4 emits
     width < 1180px vs the original ≤1180px — accepted repo-wide);
   • the trailing trace-control overrides (.term-trace-toggle placed after
     the pane rules) are folded into the same utilities. */

const catOf = (type: string) => {
  if (type.startsWith("RUN_") || type.startsWith("STEP_")) return "life";
  if (type.startsWith("TEXT_MESSAGE")) return "text";
  if (type.startsWith("TOOL_CALL")) return "tool";
  if (type.startsWith("STATE_") || type === "MESSAGES_SNAPSHOT") return "state";
  if (type.startsWith("REASONING")) return "reason";
  return "special";
};

const preview = (event: Record<string, unknown>) => {
  const s = (v: unknown) => (v === undefined ? "" : String(v));
  if (event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TOOL_CALL_ARGS" || event.type === "REASONING_MESSAGE_CONTENT")
    return JSON.stringify(s(event.delta));
  if (event.type === "TOOL_CALL_START") return s(event.toolCallName);
  if (event.type === "STATE_DELTA") return ((event.delta as { path: string }[]) || []).map((d) => d.path).join(" ");
  if (event.type === "CUSTOM") return s(event.name);
  if (event.type === "RUN_FINISHED") return JSON.stringify((event.outcome as object) || {});
  return "";
};

/* every status styles the same properties explicitly — base stays out of the
   unconditional string (§1.6-1); unknown statuses fall back to the base look */
const CHIP_BASE = "term-chip border px-[7px] py-[1px] text-[10px] tracking-[0.04em]";
const CHIP: Record<string, string> = {
  running: "text-[var(--accent-text,var(--green))] border-(--line-2)",
  interrupted: "text-(--amber) border-[rgba(255,212,121,0.4)]",
  done: "text-(--dim) border-(--line-2)",
};
const CHIP_IDLE = "text-[var(--accent-text,var(--green))] border-(--line-2)";
const CHIP_DIM = "text-(--dim) border-(--line)";

const TRACE_CAT: Record<string, string> = {
  life: "text-[var(--accent-text,var(--green))]",
  text: "text-[var(--accent-text,var(--green))]",
  tool: "text-(--cyan)",
  state: "text-(--violet)",
  reason: "text-[#9fc0ad]",
  special: "text-(--amber)",
};

const FOLD_FLAG: Record<string, string> = {
  error: "text-(--red)",
  interrupted: "text-(--amber)",
};
const FOLD_FLAG_LIVE = "text-(--green)";

const PLAN_STEP: Record<string, string> = {
  done: "text-[#9dbfab]",
  active: "text-[#e7fff2]",
};
const PLAN_STEP_IDLE = "text-[#7d9c8b]";

const STATUS_ITEM: Record<string, string> = {
  running: "text-[var(--accent-text,var(--green))]",
  interrupted: "text-(--amber)",
  done: "text-(--green-dim)",
  stopped: "text-(--red)",
  error: "text-(--red)",
};
const STATUS_ITEM_IDLE = "text-[#6f8d7b]";

const CURSOR =
  "term-cursor inline-block w-[7px] h-[12px] ml-[4px] align-[-2px] bg-(--green) shadow-[0_0_10px_rgba(140,255,176,0.6)] animate-[term-blink_1s_steps(2)_infinite] motion-reduce:animate-none";

const RULE =
  "term-rule flex items-center gap-[12px] text-(--green-dim) text-[10px] tracking-[0.08em] uppercase mt-[18px] mb-[10px] before:content-[''] before:flex-1 before:h-px before:bg-[linear-gradient(90deg,transparent,var(--line-2))] after:content-[''] after:flex-1 after:h-px after:bg-[linear-gradient(90deg,var(--line-2),transparent)]";

const TOOL_JSON =
  "term-tool-json mt-[6px] mb-0 ml-[20px] px-[11px] py-[8px] border border-dashed border-(--line) text-[#8fb3a1] text-[10.5px] leading-[1.55] max-h-[120px] overflow-auto whitespace-pre-wrap";

/* interrupt box: pending (amber alert) vs done (green quiet) — border-color,
   background and shadow are branch-exclusive (§1.6-1) */
const BOX = "term-box border px-[14px] py-[12px] mt-[12px] mb-[16px] max-w-[720px]";
const BOX_PENDING =
  "border-[rgba(255,212,121,0.42)] bg-[rgba(255,212,121,0.035)] shadow-[0_0_40px_-20px_rgba(255,212,121,0.5)]";
const BOX_DONE = "border-[rgba(140,255,176,0.3)] bg-[rgba(140,255,176,0.03)] shadow-none";
const BOX_HEAD =
  "term-box-head text-[10px] tracking-[0.16em] uppercase mb-[7px]";
const KEY =
  "term-key border px-[10px] py-[3px] text-[11px] [transition:all_0.15s]";
const KEY_YES =
  "border-[rgba(255,212,121,0.5)] text-(--amber) hover:bg-[rgba(140,255,176,0.14)] hover:border-[var(--accent-text,var(--green))] hover:text-[var(--accent-text,var(--green))]";
const KEY_NO =
  "border-[rgba(255,212,121,0.5)] text-(--amber) hover:bg-[rgba(255,139,139,0.12)] hover:border-(--red) hover:text-(--red)";
const KEY_EDIT =
  "border-[rgba(140,255,176,0.4)] text-(--green-dim) hover:bg-[rgba(140,255,176,0.14)] hover:border-[var(--accent-text,var(--green))] hover:text-[var(--accent-text,var(--green))]";

export function TerminalPage() {
  const c = useConversation();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const log = useStickToBottom<HTMLDivElement>();
  const trace = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [showDeltas, setShowDeltas] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const running = c.status === "running";
  const traceEvents = useMemo(
    () =>
      (showDeltas
        ? c.events
        : c.events.filter(({ event }) => !/CONTENT$|ARGS$/.test(event.type))
      ).slice(-400),
    [c.events.length, showDeltas, c.getVersion()]
  );
  const pending = pendingInterrupts(c.entries)[0];
  // Consecutive thinking/tool lines collapse into one trace fold block.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      if (e.key.toLowerCase() === "y") c.resolveInterrupt(true);
      if (e.key.toLowerCase() === "n") c.resolveInterrupt(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, c]);

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  return (
    <div className="skin-term relative h-full overflow-hidden text-(--text) text-[12px] bg-(--bg) bg-[radial-gradient(ellipse_70%_50%_at_10%_0%,rgba(40,120,80,0.16),transparent_60%)] [font-family:IBM_Plex_Mono,ui-monospace,Cascadia_Code,monospace]">
      <div className="term-scanlines" aria-hidden="true" />

      <div className="term-shell relative z-[1] flex h-full flex-col">
        <header className="term-bar flex-none flex h-[42px] items-center justify-between gap-[16px] px-[16px] border-b border-(--line) bg-[rgba(6,9,12,0.9)] text-[11px]">
          <div className="term-bar-left flex items-center gap-[10px] min-w-0">
            <span className="term-led h-[7px] w-[7px] rounded-full bg-(--green) shadow-[0_0_10px_rgba(140,255,176,0.9)] animate-[term-pulse_2s_ease-in-out_infinite] motion-reduce:animate-none" />
            <span className="term-brand text-[var(--accent-text,var(--green))] font-semibold tracking-[0.04em] [text-shadow:0_0_12px_rgba(140,255,176,0.5)]">agui</span>
            <span className="term-path text-(--dim) overflow-hidden text-ellipsis whitespace-nowrap">~/threads/{c.threadId.slice(-8)}</span>
          </div>
          <div className="term-bar-right flex items-center gap-[10px] min-w-0">
            <span className={`${CHIP_BASE} ${CHIP_IDLE}`}>[{c.transport.replace(" ", "-")}]</span>
            <span className={`${CHIP_BASE} ${CHIP_DIM}`}>{c.runId}</span>
            <span className={`${CHIP_BASE} ${CHIP[c.status] ?? CHIP_IDLE}`}>{c.status}{pendingInterrupts(c.entries).length > 1 ? ` ×${pendingInterrupts(c.entries).length}` : ""}</span>
          </div>
        </header>

        <div className="term-body grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_332px] max-[1180px]:grid-cols-[minmax(0,1fr)]">
          <main className="term-log overflow-y-auto px-[22px] pt-[16px] pb-[8px] text-[12px] leading-[1.66]" ref={log}>
            <div className="term-banner border border-dashed border-(--line-2) px-[11px] py-[8px] mb-[18px] bg-[rgba(140,255,176,0.02)]">
              <div className="term-banner-line text-[var(--accent-text,var(--green))] text-[10px] tracking-[0.12em] uppercase">AG–UI SESSION {c.threadId} · protocol 1.0</div>
              <div className="term-banner-line term-banner-line--dim text-(--dim) text-[10px] tracking-[0.02em] mt-[2px]">
                streaming events · {c.events.length} received · {c.tokens} tokens
              </div>
            </div>

            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            {foldItems.map((item) => {
              if (item.type === "entry") {
                return (
                  <LogEntry
                    key={item.entry.id}
                    entry={item.entry}
                    open={!!open[item.entry.id]}
                    onToggle={() => setOpen((p) => ({ ...p, [item.entry.id]: !p[item.entry.id] }))}
                    live={pending?.id === item.entry.id}
                    onResolve={(approved, id) => c.resolveInterrupt(approved, undefined, id)}
                  />
                );
              }
              const foldOpen = foldOverride[item.id] ?? foldGroupOpen(item.entries);
              const failures = foldGroupFailures(item.entries);
              const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
              const duration = foldGroupDuration(item.entries);
              return (
                <div key={item.id} className="term-fold mb-[12px] max-w-[880px]" data-fold-id={item.id}>
                  <button
                    type="button"
                    className="term-fold-head flex w-full min-w-0 items-baseline gap-[8px] cursor-pointer py-[2px] border-0 bg-none text-left text-(--dim) text-[11.5px] [font-family:inherit] hover:text-(--text) active:text-(--green)"
                    data-fold-head=""
                    aria-expanded={foldOpen}
                    onClick={() => setFoldOverride((p) => ({ ...p, [item.id]: !foldOpen }))}
                    onKeyDown={(e) => {
                      // explicit for the keydown contract test (jsdom runs no activation)
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setFoldOverride((p) => ({ ...p, [item.id]: !foldOpen }));
                      }
                    }}
                  >
                    <span className="term-caret text-(--green-dim) w-[10px] flex-none">{foldOpen ? "▾" : "▸"}</span>
                    <span className="term-fold-label text-(--cyan)">{t("fold.group")}</span>
                    <span className="term-dim text-(--dim)">
                      {`${item.entries.length} ${t("fold.steps")}`}
                      {duration !== undefined ? ` · ${formatDuration(duration)}` : ""}
                    </span>
                    {failure ? (
                      <span className={`term-fold-flag term-fold-flag--${failure} flex-none text-[10.5px] ${FOLD_FLAG[failure]}`}>
                        {failure === "error" ? `✕ ${t("fold.hasFailures")}` : `‖ ${t("chat.interrupted")}`}
                      </span>
                    ) : foldGroupOpen(item.entries) ? (
                      <span className={`term-fold-flag term-fold-flag--live flex-none text-[10.5px] ${FOLD_FLAG_LIVE}`}>⟳ {t("chat.executing")}</span>
                    ) : null}
                  </button>
                  {foldOpen &&
                    item.entries.map((entry) => (
                      <LogEntry
                        key={entry.id}
                        entry={entry}
                        open={!!open[entry.id]}
                        onToggle={() => setOpen((p) => ({ ...p, [entry.id]: !p[entry.id] }))}
                        live={pending?.id === entry.id}
                        onResolve={(approved, id) => c.resolveInterrupt(approved, undefined, id)}
                      />
                    ))}
                </div>
              );
            })}

            {c.status === "done" && c.entries.length > 0 && (
              <div className={RULE}>
                <span>{t("term.runFinished")} · {formatDuration(c.duration())} · {c.tokens} tokens · {c.events.length} events</span>
              </div>
            )}

            {c.entries.length === 0 && (
              <div className="term-line term-dim flex items-baseline gap-[9px] mb-[14px] max-w-[860px] text-(--dim)">
                <span className="term-prompt text-[var(--accent-text,var(--green))] [text-shadow:0_0_10px_rgba(140,255,176,0.45)] flex-none">❯</span> {t("term.awaiting")}<span className={CURSOR} />
              </div>
            )}
          </main>

          <aside className="term-trace flex min-h-0 flex-col border-l border-(--line) bg-[rgba(6,9,11,0.85)] max-[1180px]:hidden">
            <div className="term-trace-head flex-none flex items-center justify-between px-[12px] py-[9px] border-b border-(--line) text-(--green-dim) text-[9.5px] tracking-[0.22em] uppercase">
              <span>{t("term.trace")}</span>
              <button className="term-trace-toggle [font-family:inherit] text-[8.5px] tracking-[0.12em] uppercase text-(--dim) border border-(--line) px-[6px] py-[1px] ml-auto mr-[10px] hover:text-[var(--accent-text,var(--green))] hover:border-(--line-2)" onClick={() => setShowDeltas(!showDeltas)}>
                {showDeltas ? t("term.deltasOn") : t("term.deltasOff")}
              </button>
              <span className="term-trace-live inline-flex items-center gap-[5px] tracking-[0.1em] text-[var(--accent-text,var(--green))]"><i className="h-[5px] w-[5px] bg-(--green) rounded-full shadow-[0_0_8px_var(--green)] animate-[term-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none" /> {t("term.live")}</span>
            </div>
            <div className="term-trace-list min-h-0 flex-1 overflow-y-auto px-[10px] pt-[7px] pb-[10px]" ref={trace}>
              {traceEvents.map(({ seq, event }) => (
                <div key={seq} className="term-trace-row flex gap-[7px] py-[1.5px] text-[9.5px] leading-[1.5]" data-cat={catOf(event.type)}>
                  <span className={`term-trace-type flex-none w-[116px] overflow-hidden text-ellipsis whitespace-nowrap opacity-[0.85] ${TRACE_CAT[catOf(event.type)] ?? TRACE_CAT.life}`}>{event.type}</span>
                  <span className="term-trace-preview text-[#56705f] overflow-hidden text-ellipsis whitespace-nowrap">{preview(event as Record<string, unknown>)}</span>
                </div>
              ))}
              {c.events.length === 0 && <div className="term-trace-empty text-(--dim) text-[10px] px-[2px] py-[8px]">{t("term.noEvents")}</div>}
            </div>
            <div className="term-trace-foot flex-none flex justify-between px-[12px] py-[7px] border-t border-(--line) text-[9px] text-(--dim) tracking-[0.04em]">
              <span>{c.events.length} events</span>
              <span className="term-dim text-(--dim)">state v{c.stateVersion}</span>
            </div>
          </aside>
        </div>

        <footer className="term-composer flex-none border-t border-(--line) bg-[rgba(6,9,12,0.92)] px-[16px] pt-[6px] pb-0">
          {c.suggestions.length > 0 && (
            <div className="term-suggest flex items-center flex-wrap gap-[8px] pt-[6px]">
              {c.suggestions.map((text) => (
                <button
                  key={text}
                  className="term-suggest-chip [font-family:inherit] text-[10.5px] text-(--green-dim) bg-[rgba(140,255,176,0.05)] border border-(--line) px-[9px] py-[2px] cursor-pointer [transition:color_0.15s,border-color_0.15s,background_0.15s] hover:text-[var(--accent-text,var(--green))] hover:border-[rgba(140,255,176,0.5)] hover:bg-[rgba(140,255,176,0.12)] before:content-['$_'] before:text-(--dim)"
                  onClick={() => {
                    setDraft(text);
                    input.current?.focus();
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          <div className="term-input-line flex items-start gap-[10px] pt-[6px] pb-[8px]">
            <span className="term-prompt term-prompt--big text-[var(--accent-text,var(--green))] [text-shadow:0_0_10px_rgba(140,255,176,0.45)] flex-none text-[14px] translate-y-[1px]">❯</span>
            <textarea
              ref={input}
              rows={1}
              value={draft}
              spellCheck={false}
              aria-label={t("term.typeMessage")}
              placeholder={t("term.typeMessage")}
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 96) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                if (e.key === "Escape") c.stop();
              }}
            />
            <span className="term-enter flex-none text-(--green-dim) text-[11px] pt-[2px]">⏎</span>
          </div>
          <div className="term-status flex items-center gap-[16px] h-[26px] border-t border-(--line) text-[9.5px] tracking-[0.06em] uppercase text-[#6f8d7b]">
            <span className={`term-status-item term-status-item--${c.status} ${STATUS_ITEM[c.status] ?? STATUS_ITEM_IDLE}`}>
              {running
                ? "● " + t("term.recording")
                : c.status === "interrupted"
                ? "● " + t("term.paused")
                : c.status === "done"
                ? "● " + t("term.done")
                : c.status === "idle"
                ? "○ " + t("term.idle")
                : "○ " + t(("status." + c.status) as never)}
            </span>
            <span className="term-status-item">tok {c.tokens}</span>
            <span className="term-status-item">ev {c.events.length}</span>
            <span className="term-status-item term-dim text-(--dim)">state v{c.stateVersion}</span>
            <span className="term-status-item term-dim text-(--dim)">{formatDuration(c.duration())}</span>
            <span className="term-status-spacer flex-1" />
            <span className="term-status-item term-dim text-(--dim)">ag-ui/1.0 · mock sse</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function LogEntry({
  entry,
  open,
  onToggle,
  live,
  onResolve,
}: {
  entry: Entry;
  open: boolean;
  onToggle: () => void;
  live: boolean;
  onResolve: (approved: boolean, interruptId?: string) => void;
}) {
  const plugins = useSkinPlugins();
  if (entry.kind === "user") {
    return (
      <div className="term-line term-user flex items-baseline gap-[9px] mb-[14px] max-w-[860px]">
        <span className="term-prompt text-[var(--accent-text,var(--green))] [text-shadow:0_0_10px_rgba(140,255,176,0.45)] flex-none">❯</span>
        <span className="term-user-body text-[#e7fff2] flex-1 min-w-0 whitespace-pre-wrap">{entry.text}</span>
        <span className="term-stamp ml-auto flex-none text-(--dim) text-[9.5px] tracking-[0.04em]">{timeOf(entry.at)}</span>
      </div>
    );
  }

  if (entry.kind === "reasoning") {
    return (
      <div className={`term-reason mb-[12px] max-w-[880px] ${open ? "is-open" : ""}`}>
        <button className="term-reason-head flex w-full items-baseline gap-[8px] text-left text-(--dim) text-[11.5px] hover:text-(--text)" onClick={onToggle}>
          <span className="term-caret text-(--green-dim) w-[10px] flex-none">{open ? "▾" : "▸"}</span>
          <span className="term-reason-label text-(--violet)">{t("term.thinking")}</span>
          <span className="term-dim text-(--dim)">{entry.streaming ? t("term.streaming") : formatDuration(entry.durationMs ?? 0)}</span>
          <span className="term-dim text-(--dim)">· {entry.tokens} tok</span>
          {entry.streaming && <span className={CURSOR} />}
        </button>
        {open && (
          <div className="term-reason-body mt-[6px] ml-[22px] pl-[12px] border-l border-(--line-2) [border-left-style:dashed] text-[#7d9c8b] italic whitespace-pre-wrap text-[11.5px] leading-[1.7]" data-skin-text="">
            {entry.text}
            {entry.streaming && <span className={CURSOR} />}
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === "tool") return <ToolLine entry={entry} />;
  if (entry.kind === "plan") return <PlanLine entry={entry} />;

  if (entry.kind === "interrupt") {
    return <TermInterrupt entry={entry} live={live} onResolve={onResolve} />;
  }

  if (entry.kind === "error") {
    return <div className="term-line term-error flex items-baseline gap-[9px] mb-[14px] max-w-[860px] text-(--red)">error: {entry.message}</div>;
  }

  if (entry.kind === "subagent") {
    return (
      <div className="term-line term-dim flex items-baseline gap-[9px] mb-[14px] max-w-[860px] text-(--dim)">
        <span className="term-prompt text-[var(--accent-text,var(--green))] [text-shadow:0_0_10px_rgba(140,255,176,0.45)] flex-none">↳</span> [{displayText(entry.name)}] {entry.status}
        {entry.detail ? ` · ${entry.detail}` : ""}
      </div>
    );
  }
  if (entry.kind === "step") {
    return (
      <div className="term-line term-dim flex items-baseline gap-[9px] mb-[14px] max-w-[860px] text-(--dim)">
        <span className="term-prompt text-[var(--accent-text,var(--green))] [text-shadow:0_0_10px_rgba(140,255,176,0.45)] flex-none">›</span> step · {displayText(entry.name)} · {entry.status}
      </div>
    );
  }

  if (entry.kind === "custom") {
    const custom = plugins.custom?.(entry);
    if (custom !== undefined) return <>{custom}</>;
    return (
      <div className="term-line term-dim flex items-baseline gap-[9px] mb-[14px] max-w-[860px] text-(--dim)">
        <span className="term-prompt text-[var(--accent-text,var(--green))] [text-shadow:0_0_10px_rgba(140,255,176,0.45)] flex-none">›</span> custom · {displayText(entry.name)} · {safeJson(entry.value, 0)}
      </div>
    );
  }

  if (entry.kind === "assistant") return <AssistantLine entry={entry} />;
  // forward-compatible: unknown entry kinds are ignored, never mis-rendered
  return null;
}


/** Interrupt box with its own per-interrupt edit draft: several pending cards
    must never share an editor or submit each other's args (Fix B parity). */
function TermInterrupt({
  entry,
  live,
  onResolve,
}: {
  entry: InterruptEntry;
  live: boolean;
  onResolve: (approved: boolean, interruptId?: string) => void;
}) {
  const c = useConversation();
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState("");
  const pending = entry.status === "pending";

  function openEdit() {
    const tool = c.entries.find((e): e is ToolEntry => e.kind === "tool" && e.id === entry.toolCallId);
    setEditJson(JSON.stringify(tool?.args ?? {}, null, 2));
    setEditing(true);
  }

  function approveEdited() {
    try {
      c.resolveInterrupt(true, JSON.parse(editJson), entry.id);
    } catch {
      setEditing(false);
      c.resolveInterrupt(true, undefined, entry.id);
      return;
    }
    setEditing(false);
  }

  return (
    <div className={`${BOX} ${pending ? BOX_PENDING : BOX_DONE}`}>
      <div className={`${BOX_HEAD} ${pending ? "text-(--amber)" : "text-(--green-dim)"}`}>
        {pending ? "┌─ " + t("term.actionRequired") : "┌─ " + t("term.resolved")} {live ? "· interrupt" : ""}
      </div>
      <div className="term-box-title text-[#ffe9b8] text-[13px] leading-[1.5]">{entry.message}</div>
      {entry.description && <div className="term-box-desc text-[#b9a888] text-[11.5px] mt-[4px] leading-[1.6]">{entry.description}</div>}
      {entry.details.length > 0 && (
        <div className="term-box-terms flex flex-wrap gap-[18px] mt-[9px] text-[11px] text-[#d8c49a]">
          {entry.details.map((d) => (
            <span key={d.label}>
              <em className="text-(--dim) not-italic">{d.label.toLowerCase()}</em> {d.value}
            </span>
          ))}
        </div>
      )}
      {pending ? (
        <>
          <div className="term-box-actions flex items-center gap-[12px] mt-[13px] text-[11px]">
            <button className={`term-key term-key--yes ${KEY} ${KEY_YES}`} onClick={() => onResolve(true, entry.id)}>{t("term.approve")}</button>
            <button className={`term-key term-key--no ${KEY} ${KEY_NO}`} onClick={() => onResolve(false, entry.id)}>{t("term.decline")}</button>
            <button className={`term-key term-key--edit ${KEY} ${KEY_EDIT}`} onClick={openEdit}>{t("term.edit")}</button>
            <span className="term-dim text-(--dim)">{t("term.resumeHint")}</span>
          </div>
          {editing && (
            <div className="term-edit mt-[11px] [border-left:2px_solid_rgba(255,212,121,0.45)] pl-[12px]">
              <textarea
                value={editJson}
                onChange={(e) => setEditJson(e.target.value)}
                spellCheck={false}
                rows={4}
                aria-label={t("term.edit")}
                className="w-full min-h-[64px] resize-y bg-[rgba(140,255,176,0.04)] border border-(--line) text-[var(--accent-text,var(--green))] [font-family:inherit] text-[11px] leading-[1.55] px-[10px] py-[8px] outline-none focus:border-[rgba(255,212,121,0.6)]"
              />
              <div className="term-box-actions flex items-center gap-[12px] mt-[13px] text-[11px]">
                <button className={`term-key term-key--yes ${KEY} ${KEY_YES}`} onClick={approveEdited}>{t("term.approveEdited")}</button>
                <button className={`term-key term-key--no ${KEY} ${KEY_NO}`} onClick={() => setEditing(false)}>{t("term.cancelEdit")}</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={`term-box-resolved mt-[9px] text-[11px] ${entry.expired ? "text-(--amber)" : "text-[var(--accent-text,var(--green))]"}`}>
          {entry.expired
            ? "✗ " + t("term.expired")
            : "✓ " + (entry.status === "approved" ? t("term.approved") : t("term.denied"))}{" "}
          · {timeOf(entry.resolvedAt)}
        </div>
      )}
    </div>
  );
}

function AssistantLine({ entry }: { entry: AssistantEntry }) {  return (
    <div className="term-assistant flex gap-[12px] mb-[18px] max-w-[880px]">
      <div className="term-assistant-bar flex-none w-[2px] rounded-[2px] bg-[linear-gradient(180deg,var(--green),rgba(140,255,176,0.05))] shadow-[0_0_12px_rgba(140,255,176,0.35)]" />
      <div className="term-assistant-body flex-1 min-w-0">
        <div className="term-assistant-head flex items-baseline gap-[9px] mb-[5px]">
          <span className="term-who text-[var(--accent-text,var(--green))] font-semibold text-[11px] tracking-[0.1em] uppercase">agui</span>
          <span className="term-dim text-(--dim)">{timeOf(entry.at)}</span>
          {entry.streaming && <span className="term-dim term-blink text-(--dim) animate-[term-pulse_1.1s_ease-in-out_infinite] motion-reduce:animate-none">{t("term.writing")}</span>}
        </div>
        <Markdown className={`term-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
      </div>
    </div>
  );
}

function ToolLine({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="term-tool mb-[10px] max-w-[880px]">
      <button className="term-tool-head group flex w-full items-baseline gap-[9px] text-left text-[11.5px]" onClick={() => setOpen(!open)}>
        <span className="term-tool-mark text-[var(--accent-text,var(--green))] w-[9px] flex-none">
          {entry.status === "done" ? "✓" : entry.status === "error" ? "✗" : entry.status === "interrupted" ? "‖" : "⟳"}
        </span>
        <span className="term-tool-name text-(--cyan) flex-none group-hover:[text-shadow:0_0_10px_rgba(127,216,255,0.6)]">{displayText(entry.name)}</span>
        <span className="term-dim term-tool-args text-(--dim) flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px]" data-skin-text="">{displayText(entry.argsRaw).slice(0, 52)}</span>
        <span className="term-dim term-tool-time text-(--dim) text-[10px] flex-none">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
      </button>
      {open && (
        <pre className={TOOL_JSON}>{safeJson(entry.args ?? entry.argsRaw, 2)}</pre>
      )}
      <ToolResult entry={entry} variant="terminal" />
    </div>
  );
}

function PlanLine({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  // Non-PLAN activities may carry raw content and no steps at all — a 0/0
  // meter would read "NaN%", and entry.content would be silently dropped
  // (same fallback as aurora: render the raw content instead).
  if (view.rawOnly) {
    return (
      <div className="term-plan mb-[14px] max-w-[880px]">
        <div className="term-plan-head flex items-baseline gap-[14px] mb-[4px]">
          <span className="term-plan-title text-(--amber) text-[11.5px]">▸ {t("term.plan")} · {displayText(entry.title).toLowerCase()}</span>
        </div>
        <pre className={TOOL_JSON}>{planRawText(view)}</pre>
      </div>
    );
  }
  const done = view.steps.filter((s) => s.state === "done").length;
  const total = view.steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const filled = total ? Math.round((done / total) * 12) : 0;
  return (
    <div className="term-plan mb-[14px] max-w-[880px]">
      <div className="term-plan-head flex items-baseline gap-[14px] mb-[4px]">
        <span className="term-plan-title text-(--amber) text-[11.5px]">▸ {t("term.plan")} · {displayText(entry.title).toLowerCase()}</span>
        <span className="term-bar-meter text-[var(--accent-text,var(--green))] text-[10.5px] tracking-[0.04em]">[{"█".repeat(filled)}{"░".repeat(12 - filled)}] {pct}%</span>
      </div>
      {view.steps.map((s) => (
        <div key={s.id} className={`term-plan-step ml-[18px] text-[11.5px] ${PLAN_STEP[s.state] ?? PLAN_STEP_IDLE}`} data-state={s.state}>
          <span className={`term-check mr-[8px] ${s.state === "pending" ? "text-(--dim)" : "text-[var(--accent-text,var(--green))]"}`}>{s.state === "done" ? "[x]" : s.state === "active" ? "[~]" : "[ ]"}</span>
          {s.label}
          {s.state === "active" && <span className={CURSOR} />}
        </div>
      ))}
    </div>
  );
}

export default {
  id: "terminal",
  name: "Terminal",
  tagline: "Phosphor CLI · raw event trace",
  swatch: ["#05070a", "#0c1310", "#8cffb0"] as [string, string, string],
  ChatPage: TerminalPage,
};
