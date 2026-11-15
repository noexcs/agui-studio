import { useMemo, useState } from "react";
import { useConversation } from "../../host";
import type { AssistantEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, SubagentEntry, ToolEntry } from "../../contract";
import { formatDuration } from "../../utils";
import { plainText } from "../../utils";
import { toolStage } from "../../shared/toolStatus";
import { ToolResult } from "../../shared/ToolResult";
import { planView, planRawText } from "../../shared/plan";
import { asArray, asRecord, displayText, isEmptyState, safeJson } from "../../shared/safe";
import { Markdown, timeOf } from "../../shared/Markdown";
import { ProtocolDrawer } from "../../shared/ProtocolDrawer";
import { pendingInterrupts } from "../../shared/interrupts";
import {
  conversationGroups,
  foldGroupFailures,
  foldGroupOpen,
  foldGroupStats,
} from "../../shared/conversationGroups";
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { t } from "../../i18n";
import { useSkinBranding } from "../../host";
import "./brutalist.css";

/* ═══ Tailwind migration (task-13 Phase 2a) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-brut tokens via arbitrary var shorthand so --sk-accent
   tuning and app.css's unlayered .lang-zh override keep working.
   brutalist.css keeps only tokens/keyframes/the generated .bru-md
   typography/the scrollbar/focus ring/reduced-motion, and the accent-guard
   foreground block (yellow surfaces must take --accent-fg from tuning.css).
   Residual notes:
   • same-property state branches write full values per branch and keep the
     base look in the map fallback (§1.6-1) — STATE/FOLD_FLAG/STEP/APPROVE/
     APPROVE_HEAD/SUB_STATUS/EV_CAT;
   • hover variants that would beat a state branch stay inside that branch
     (bru-send--stop must stay red even when hovered, as in the original
     source order); the disabled send keeps button semantics;
   • .bru-fold-body removes the child card shadows via descendant arbitrary
     variants (the original `.bru-fold-body .bru-think, .bru-tool` rule);
   • dead rules dropped: .bru-item(+.is-active)/.bru-item-no/.bru-new/
     .bru-replay had no JSX site or test anchor. */

const MONO = "[font-family:IBM_Plex_Mono,monospace]";
const SANS = "[font-family:'Space_Grotesk','Arial_Black',sans-serif]";

const LABEL = "bru-label mb-[8px] " + MONO + " text-[8px] tracking-[0.2em] uppercase";

/* status chip: color/background/border-color are branch-exclusive; the idle
   default lives only in STATE_IDLE (the fallback) */
const STATE_BASE = "bru-state border-[1.5px] px-[9px] py-[3px] " + MONO + " text-[9px] font-semibold tracking-[0.14em] uppercase";
const STATE: Record<string, string> = {
  running: "bg-[var(--green,#37d67a)] text-[#08110b] border-[#08110b]",
  done: "bg-(--paper) text-(--ink) border-(--paper)",
  interrupted: "bg-(--yellow) text-(--ink) border-(--ink)",
  error: "bg-(--red) text-white border-white",
};
const STATE_IDLE = "text-(--paper) border-(--paper)";

const TAG_BASE = "bru-tag mb-[7px] inline-block bg-(--ink) px-[7px] py-[2px] " + MONO + " text-[8px] tracking-[0.18em]";
const TAG = TAG_BASE + " text-(--paper)";
const TAG_DARK = TAG_BASE + " bru-tag--dark text-[var(--accent-text,var(--yellow))]";

const FOLD_HEAD =
  "bru-fold-head flex w-full min-w-0 cursor-pointer items-center gap-[10px] border-0 bg-none px-[12px] py-[8px] text-left text-(--ink) " + MONO +
  " text-[9px] tracking-[0.14em] uppercase hover:bg-[#efe9da] active:bg-[#e6dfcc] aria-expanded:border-b-2 aria-expanded:border-(--ink)";
const FOLD_FLAG_BASE = "bru-fold-flag flex-none px-[6px] py-[1px]";
const FOLD_FLAG: Record<string, string> = {
  error: "bg-(--red) text-(--white)",
  interrupted: "bg-(--yellow) text-(--ink)",
  live: "bg-(--ink) text-(--white)",
};

/* shared with ToolResult.tsx's brutalist variant (duplicated: shared/
   must not import a skin module) */
const TOOL_ARGS = "bru-tool-args m-0 max-h-[130px] overflow-auto whitespace-pre-wrap px-[12px] py-[10px] " + MONO + " text-[10.5px] leading-[1.55] text-[#33302a]";

const STEP_BASE = "bru-step flex items-center gap-[9px] border-b border-[rgba(0,0,0,0.12)] px-[11px] py-[5px] last:border-b-0 " + MONO + " text-[10.5px] tracking-[0.02em]";
const STEP: Record<string, string> = {
  done: "text-[#1b1a17]",
  active: "bg-[#fff8cc] text-(--ink) font-semibold",
};
const STEP_IDLE = "text-[#4a463d]";

const APPROVE_BASE = "bru-approve border-[3px] border-(--ink) px-[14px] pb-[14px]";
const APPROVE: Record<string, string> = {
  pending: "bg-(--yellow) shadow-[8px_8px_0_var(--ink)]",
  done: "bg-[#e9e4d6] shadow-[4px_4px_0_var(--ink)]",
  expired: "bg-[#e9e4d6] shadow-[4px_4px_0_var(--ink)]",
};
const APPROVE_HEAD_BASE = "bru-approve-head mx-[-14px] mb-[11px] flex justify-between px-[14px] py-[7px] " + MONO + " text-[9.5px] font-semibold tracking-[0.16em]";
const APPROVE_HEAD: Record<string, string> = {
  pending: "bg-(--ink) text-[var(--accent-text,var(--yellow))]",
  done: "bg-[#2f5d4e] text-[#eafff3]",
  expired: "bg-(--red) text-[#fff2ef]",
};

const BTN_BASE =
  "bru-btn border-2 border-(--ink) px-[15px] py-[9px] " + MONO +
  " text-[10.5px] font-bold tracking-[0.1em] [transition:transform_0.08s,box-shadow_0.08s] hover:[transform:translate(2px,2px)] hover:shadow-[0_0_0_rgba(0,0,0,0.3)]";
const BTN_OK = "bru-btn--ok bg-(--ink) text-[var(--accent-text,var(--yellow))] shadow-[4px_4px_0_rgba(0,0,0,0.35)]";
const BTN_NO = "bru-btn--no bg-(--white) text-(--ink) hover:bg-(--red) hover:text-white";

const SUB_STATUS: Record<string, string> = {
  running: "bg-(--yellow) px-[6px] py-[1px] text-(--ink)",
  error: "text-(--red)",
};
const SUB_STATUS_IDLE = "text-[#5a5548]";

const EV_CAT: Record<string, string> = {
  tool: "text-[#8fd0ff]",
  state: "text-[#c9a8ff]",
  life: "text-[#9ef0c8]",
  special: "text-[var(--accent-text,var(--yellow))]",
};
const EV_IDLE = "text-[#8f8a7c]";

const SEND_BASE = "bru-send border-2 border-(--ink) px-[20px] py-0 " + MONO + " text-[11px] font-bold tracking-[0.12em]";
const SEND =
  "bg-(--ink) text-[var(--accent-text,var(--yellow))] hover:bg-(--yellow) hover:text-(--ink) disabled:bg-[#c9c3b4] disabled:text-[#6b675c] disabled:border-[#6b675c] disabled:cursor-default";
const SEND_STOP = "bru-send--stop bg-(--red) text-white";

export function BrutalistPage() {
  const c = useConversation();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const brand = useSkinBranding();
  const scroller = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries)[0];
  // Consecutive thinking/tool blocks collapse into one hard-edged fold box.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);
  // Shared state is typed as a record, but a third-party stream can send a
  // scalar/array snapshot. Never call Object.keys on it and never read `.trip`
  // off null: fall back to raw JSON when it is not our demo object.
  const shared = asRecord(c.sharedState);
  const trip = asRecord(shared?.trip);
  const budget = asRecord(shared?.budget);
  const itinerary = asArray(shared?.itinerary);
  const bookings = asArray(shared?.bookings);
  const hasDemoState =
    !!shared && ["trip", "budget", "itinerary", "bookings"].some((key) => Object.prototype.hasOwnProperty.call(shared, key));
  const showRawState = !isEmptyState(c.sharedState) && !hasDemoState;

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  return (
    <div className={`skin-brut relative h-full overflow-hidden bg-(--paper) bg-[linear-gradient(rgba(0,0,0,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.045)_1px,transparent_1px)] [background-size:26px_26px] text-(--ink) ${SANS}`}>
      <header className="bru-top flex h-[54px] items-center justify-between gap-[16px] bg-(--ink) px-[16px] text-(--paper)">
        <div className="bru-wordmark flex items-center gap-[6px]">
          <span className="bru-mark bg-(--paper) px-[7px] py-[1px] text-[15px] font-bold leading-[1.4] tracking-[-0.02em] text-(--ink)">AG</span>
          <span className="bru-mark bru-mark--alt bg-(--yellow) px-[7px] py-[1px] text-[15px] font-bold leading-[1.4] tracking-[-0.02em] text-(--ink)">UI</span>
          <span className={`bru-top-sub ml-[8px] ${MONO} text-[9px] uppercase tracking-[0.16em] text-[#b9b4a6]`}>conversation system / v1.0</span>
        </div>
        <div className="bru-top-right flex items-center gap-[12px]">
          <span className={`bru-top-meta ${MONO} text-[9px] uppercase tracking-[0.08em] text-[#b9b4a6]`}>thread {c.threadId.slice(-8)}</span>
          <span className={`${STATE_BASE} bru-state--${c.status} ${STATE[c.status] ?? STATE_IDLE}`}>{c.status}{pendingInterrupts(c.entries).length > 1 ? ` ×${pendingInterrupts(c.entries).length}` : ""}</span>
        </div>
      </header>

      <div className="bru-body grid h-[calc(100%_-_54px)] grid-cols-[206px_minmax(0,1fr)_272px] max-[1180px]:grid-cols-[176px_minmax(0,1fr)]">
        <aside className="bru-index flex min-h-0 flex-col gap-[4px] overflow-y-auto border-r-2 border-(--ink) px-[10px] py-[14px]">
          <div className={`${LABEL} text-[#6b675c]`}>{t("bru.index")}</div>
          <div className={`bru-index-foot mt-auto grid grid-cols-[auto_1fr] gap-[2px_8px] border-t-2 border-(--ink) pt-[8px] ${MONO} text-[8.5px] uppercase tracking-[0.04em] text-[#6b675c]`}>
            <span>agent</span>
            <span className="bru-strong text-right font-bold text-(--ink)">{brand.agentName}</span>
            <span>transport</span>
            <span className="bru-strong text-right font-bold text-(--ink)">{c.transport}</span>
          </div>
        </aside>

        <main className="bru-chat flex min-h-0 flex-col">
          <div className="bru-chat-head flex flex-none items-end justify-between gap-[16px] border-b-2 border-(--ink) px-[20px] pb-[12px] pt-[14px]">
            <div>
              <h1 className="m-0 text-[24px] font-bold uppercase leading-none tracking-[-0.03em]">{brand.agentName}</h1>
              <p className={`bru-sub m-0 mt-[4px] ${MONO} text-[9px] uppercase tracking-[0.06em] text-[#6b675c]`}>{brand.modelLabel} · {c.transport} · reasoning · state · interrupts</p>
            </div>
            <div className="bru-run text-right">
              <span className={`bru-run-label block ${MONO} text-[8px] uppercase tracking-[0.2em] text-[#6b675c]`}>run</span>
              <span className={`bru-run-id ${MONO} text-[10px] font-semibold`}>{c.runId}</span>
            </div>
          </div>

          <div className="bru-scroll min-h-0 flex-1 overflow-y-auto px-[20px] pb-[10px] pt-[18px]" ref={scroller}>
            <div className="bru-stack mx-auto flex max-w-[780px] flex-col gap-[16px]">
              {c.entries.length === 0 && (
                <div className="bru-empty flex flex-col items-start gap-[14px] border-[3px] border-(--ink) bg-(--white) px-[26px] pb-[30px] pt-[36px] shadow-[6px_6px_0_var(--ink)]">
                  <span className="bru-empty-big text-[clamp(24px,3.4vw,44px)] font-bold uppercase leading-[1.05] tracking-[0.02em]">{t("bru.awaiting")}</span>
                  <span className="bru-empty-cursor h-[14px] w-[34px] border-2 border-(--ink) bg-(--yellow) animate-[bru-blink_1s_steps(2)_infinite] motion-reduce:animate-none" aria-hidden="true" />
                </div>
              )}

              {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
              {foldItems.map((item) => {
                if (item.type === "entry") {
                  return <BruEntry key={item.entry.id} entry={item.entry} pending={pending} />;
                }
                const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
                return <BruFoldGroup key={item.id} groupId={item.id} entries={item.entries} open={open} onToggle={() => setFoldOverride((prev) => ({ ...prev, [item.id]: !open }))} pending={pending} />;
              })}

              {c.status === "done" && c.entries.length > 0 && (
                <div className={`bru-summary flex items-center gap-[18px] border-b-2 border-t-2 border-(--ink) px-[2px] py-[8px] ${MONO} text-[9px] uppercase tracking-[0.08em]`}>
                  <span className="font-bold">■ {t("bru.endOfRun")}</span>
                  <span className="ml-auto">{formatDuration(c.duration())} / {c.tokens} tok / {c.events.length} events</span>
                </div>
              )}
            </div>
          </div>

          <footer className="bru-composer flex flex-none flex-col gap-[8px] border-t-2 border-(--ink) bg-(--paper) px-[16px] py-[10px]">
            {c.suggestions.length > 0 && (
              <div className="bru-suggest flex flex-wrap items-center gap-[8px] pt-[2px]">
                {c.suggestions.map((text) => (
                  <button key={text} className={`bru-suggest-chip cursor-pointer border-2 border-(--ink) bg-(--white) px-[10px] py-[3px] ${MONO} text-[10px] tracking-[0.04em] text-(--ink) [transition:background_0.15s,transform_0.15s] hover:bg-(--yellow) hover:[transform:translateY(-1px)]`} onClick={() => setDraft(text)}>
                    {text}
                  </button>
                ))}
              </div>
            )}
            <div className="bru-composer-row flex min-w-0 items-stretch gap-[10px]">
              <textarea
                rows={1}
                value={draft}
                aria-label={t("bru.write")}
                placeholder={t("bru.write")}
                className={`min-h-[38px] min-w-0 flex-1 resize-none border-2 border-(--ink) bg-(--white) px-[10px] py-[8px] outline-none ${SANS} text-[13px] leading-[1.5] focus:shadow-[0_0_0_3px_rgba(255,225,77,0.9)] placeholder:[font-family:IBM_Plex_Mono,monospace] placeholder:text-[10px] placeholder:tracking-[0.16em] placeholder:text-[#8a8577]`}
                onChange={(e) => setDraft(e.target.value)}
                onInput={(e) => {
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 110) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  if (e.key === "Escape") c.stop();
                }}
              />
              {running ? (
                <button className={`${SEND_BASE} ${SEND_STOP}`} onClick={() => c.stop()}>{t("bru.stop")}</button>
              ) : (
                <button className={`${SEND_BASE} ${SEND}`} onClick={send} disabled={!draft.trim()}>{t("bru.send")}</button>
              )}
            </div>
          </footer>
        </main>

        <aside className="bru-side flex min-h-0 flex-col overflow-y-auto border-l-2 border-(--ink) bg-(--ink) text-(--paper) max-[1180px]:hidden">
          <div className="bru-side-block border-b border-[rgba(255,255,255,0.16)] px-[14px] py-[13px]">
            <div className={`${LABEL} bru-label--light text-[var(--accent-text,var(--yellow))]`}>{t("bru.sharedState")}</div>
            {showRawState ? (
              <pre className={`${TOOL_ARGS}`} data-skin-text="" style={{ color: "var(--paper)" }}>{safeJson(c.sharedState)}</pre>
            ) : (
              <>
                <div className={`bru-stat flex justify-between gap-[10px] border-b border-dashed border-[rgba(255,255,255,0.14)] py-[3px] last:border-b-0 ${MONO} text-[9.5px] text-[#b9b4a6]`}>
                  <span>budget</span>
                  <b className="text-[10.5px] text-(--paper)">€{trip?.budget === undefined || trip?.budget === null ? "—" : displayText(trip.budget)}</b>
                </div>
                <div className={`bru-stat flex justify-between gap-[10px] border-b border-dashed border-[rgba(255,255,255,0.14)] py-[3px] last:border-b-0 ${MONO} text-[9.5px] text-[#b9b4a6]`}>
                  <span>spent</span>
                  <b className="text-[10.5px] text-(--paper)">€{budget?.total === undefined || budget?.total === null ? 0 : displayText(budget.total)}</b>
                </div>
                <div className={`bru-stat flex justify-between gap-[10px] border-b border-dashed border-[rgba(255,255,255,0.14)] py-[3px] last:border-b-0 ${MONO} text-[9.5px] text-[#b9b4a6]`}><span>days</span><b className="text-[10.5px] text-(--paper)">{itinerary.length}</b></div>
                <div className={`bru-stat flex justify-between gap-[10px] border-b border-dashed border-[rgba(255,255,255,0.14)] py-[3px] last:border-b-0 ${MONO} text-[9.5px] text-[#b9b4a6]`}><span>bookings</span><b className="text-[10.5px] text-(--paper)">{bookings.length}</b></div>
              </>
            )}
            <div className={`bru-stat flex justify-between gap-[10px] border-b border-dashed border-[rgba(255,255,255,0.14)] py-[3px] last:border-b-0 ${MONO} text-[9.5px] text-[#b9b4a6]`}><span>state ver.</span><b className="text-[10.5px] text-(--paper)">v{c.stateVersion}</b></div>
          </div>

          <div className="bru-side-block border-b border-[rgba(255,255,255,0.16)] px-[14px] py-[13px]">
            <div className={`${LABEL} bru-label--light text-[var(--accent-text,var(--yellow))]`}>{t("bru.events")}</div>
            <div className="bru-evcount mb-[8px] mt-[2px] text-[42px] font-bold leading-none tracking-[-0.04em]">{c.events.length}</div>
            <div className="bru-evlist flex flex-col gap-[2px]">
              {c.events.slice(-7).reverse().map(({ seq, event }) => (
                <div key={seq} className={`bru-ev overflow-hidden text-ellipsis whitespace-nowrap ${MONO} text-[8.5px] tracking-[0.02em] ${EV_CAT[cat(event.type)] ?? EV_IDLE}`} data-cat={cat(event.type)}>
                  <span>{event.type}</span>
                </div>
              ))}
            </div>
            <div className={`bru-transport mt-[10px] ${MONO} text-[8.5px] uppercase tracking-[0.1em] text-[#6f6a5e]`}>mock SSE · {c.tokens} tokens</div>
          </div>

          <div className={`bru-side-foot mt-auto flex justify-between border-t border-[rgba(255,255,255,0.16)] px-[14px] py-[10px] ${MONO} text-[8.5px] uppercase tracking-[0.1em] text-[#8f8a7c]`}>
            <span>protocol 1.0</span>
            <a href="https://docs.ag-ui.com/introduction" target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text,var(--yellow))]">docs ↗</a>
          </div>
        </aside>
      </div>
      <ProtocolDrawer />
    </div>
  );
}

const cat = (type: string) => {
  if (type.startsWith("RUN_") || type.startsWith("STEP_")) return "life";
  if (type.startsWith("TOOL_CALL")) return "tool";
  if (type.startsWith("STATE_")) return "state";
  if (type.startsWith("REASONING")) return "reason";
  if (type.startsWith("TEXT_MESSAGE")) return "text";
  return "special";
};

function BruEntry({ entry, pending }: { entry: Entry; pending?: InterruptEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="bru-user max-w-[84%] self-end border-2 border-(--ink) bg-(--yellow) px-[14px] py-[11px] shadow-[6px_6px_0_var(--ink)]">
        <div className={TAG_DARK}>USER · {timeOf(entry.at)}</div>
        <p className="m-0 text-[14.5px] font-medium leading-[1.5]">{entry.text}</p>
      </div>
    );
  }
  if (entry.kind === "assistant") return <BruAssistant entry={entry} />;
  if (entry.kind === "reasoning") return <BruReasoning entry={entry} />;
  if (entry.kind === "tool") return <BruTool entry={entry} />;
  if (entry.kind === "plan") return <BruPlan entry={entry} />;
  if (entry.kind === "interrupt") return <BruInterrupt entry={entry} live={pending?.id === entry.id} />;
  if (entry.kind === "error") return <div className={`bru-error border-2 border-(--red) bg-[#ffe3dd] px-[12px] py-[10px] ${MONO} text-[11px] text-[#7a1d0c]`}>RUN_ERROR · {entry.message}</div>;
  if (entry.kind === "subagent") return <BruSubagent entry={entry} />;
  return null;
}

/** One hard-edged fold box for a run of consecutive thinking/tool blocks.
    Failures stay loud on the head — a collapsed box never reads as "fine". */
function BruFoldGroup({
  groupId,
  entries,
  open,
  onToggle,
  pending,
}: {
  groupId: string;
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
  pending?: InterruptEntry;
}) {
  const stats = foldGroupStats(entries);
  const failures = foldGroupFailures(entries);
  const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
  return (
    <div className="bru-fold border-2 border-(--ink) bg-(--white) shadow-[4px_4px_0_var(--ink)]" data-fold-id={groupId}>
      <button
        type="button"
        className={FOLD_HEAD}
        data-fold-head=""
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          // explicit for the keydown contract test (jsdom runs no activation)
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="bru-fold-mark flex-none text-[8px]" aria-hidden="true">{open ? "▼" : "▶"}</span>
        <span>{t("fold.group").toUpperCase()}</span>
        <span className="bru-fold-meta min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[#4a463d]">
          {stats.reasoningCount > 0 ? `${t("fold.thinking").toUpperCase()} ×${stats.reasoningCount}` : ""}
          {stats.reasoningCount > 0 && stats.toolCount > 0 ? " · " : ""}
          {stats.toolCount > 0 ? `TOOLS ×${stats.toolCount}` : ""}
        </span>
        <span className="bru-fold-count ml-auto flex-none text-[#4a463d]">{`${entries.length} ${t("fold.steps").toUpperCase()}`}</span>
        {failure && (
          <span className={`${FOLD_FLAG_BASE} bru-fold-flag--${failure} ${FOLD_FLAG[failure]}`}>
            {failure === "error" ? `✕ ${t("fold.hasFailures").toUpperCase()}` : `‖ ${t("chat.interrupted").toUpperCase()}`}
          </span>
        )}
        {!failure && foldGroupOpen(entries) && (
          <span className={`${FOLD_FLAG_BASE} bru-fold-flag--live ${FOLD_FLAG.live}`}>▶ {t("chat.executing").toUpperCase()}</span>
        )}
      </button>
      {open && (
        <div className="bru-fold-body grid gap-[10px] px-[12px] py-[10px] [&_.bru-think]:shadow-none [&_.bru-tool]:shadow-none">
          {entries.map((entry) => (
            <BruEntry key={entry.id} entry={entry} pending={pending} />
          ))}
        </div>
      )}
    </div>
  );
}

function BruSubagent({ entry }: { entry: SubagentEntry }) {
  return (
    <div className="bru-subagent border-2 border-(--ink) bg-(--white) shadow-[3px_3px_0_var(--ink)]" data-status={entry.status}>
      <div className={`bru-subagent-head flex items-center gap-[10px] px-[12px] py-[7px] ${MONO}`}>
        <span className="bru-subagent-tag bg-(--ink) px-[6px] py-[2px] text-[8px] font-bold tracking-[0.16em] text-(--paper)">{t("bru.subagent")}</span>
        <span className="bru-subagent-name text-[11px] font-bold">{displayText(entry.name)}</span>
        <span className={`bru-subagent-status ml-auto text-[9px] tracking-[0.1em] ${SUB_STATUS[entry.status] ?? SUB_STATUS_IDLE}`}>{displayText(entry.status).toUpperCase()}</span>
      </div>
      {entry.detail && <p className="bru-subagent-detail m-0 border-t-[1.5px] border-(--ink) [border-top-style:dashed] px-[12px] py-[7px] text-[11px] text-[#3c382e]">{entry.detail}</p>}
    </div>
  );
}

function BruAssistant({ entry }: { entry: AssistantEntry }) {
  return (
    <div className="bru-agent border-2 border-(--ink) bg-(--white) px-[15px] py-[13px] shadow-[4px_4px_0_var(--ink)]">
      <div className={TAG}>AGENT</div>
      <Markdown className={`bru-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
    </div>
  );
}

function BruReasoning({ entry }: { entry: ReasoningEntry }) {
  return (
    <div className="bru-think border-2 border-dashed border-(--ink) bg-[#e9e4d6] px-[12px] py-[9px]" data-skin-text="">
      <div className={`bru-think-head mb-[5px] flex justify-between ${MONO} text-[8.5px] uppercase tracking-[0.16em]`}>
        <span>{t("bru.thinking")}</span>
        <span>{entry.streaming ? "…" : formatDuration(entry.durationMs ?? 0)}</span>
      </div>
      <p className={`m-0 ${MONO} text-[10.5px] leading-[1.6] text-[#4a463d]`}>{plainText(entry.text, 240)}</p>
    </div>
  );
}

function BruTool({ entry }: { entry: ToolEntry }) {
  const stage = toolStage(entry.status);
  return (
    <div className="bru-tool border-2 border-(--ink) bg-(--white) shadow-[4px_4px_0_var(--ink)]">
      <div className={`bru-tool-head flex items-center justify-between bg-(--ink) px-[10px] py-[6px] ${MONO} text-[9px] uppercase tracking-[0.12em] text-[var(--accent-text,var(--yellow))]`}>
        <span className="bru-tool-name">{displayText(entry.name).toUpperCase()}</span>
        <span className="bru-tool-status text-(--paper)">
          {stage === "done" ? "■ DONE" : stage === "interrupted" ? "‖ INTERRUPTED" : stage === "error" ? "✕ ERROR" : "▶ " + displayText(entry.status).toUpperCase()}
        </span>
      </div>
      <pre className={TOOL_ARGS} data-skin-text="">{entry.argsRaw ? safeJson(entry.args ?? entry.argsRaw, 1) : "…"}</pre>
      <ToolResult entry={entry} variant="brutalist" />
    </div>
  );
}

function BruPlan({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className="bru-plan border-2 border-(--ink) bg-(--white)">
      <div className={`bru-plan-head flex gap-[12px] border-b-2 border-(--ink) bg-(--yellow) px-[10px] py-[5px] ${MONO} text-[9px] font-semibold uppercase tracking-[0.14em]`}>
        <span>{t("bru.plan")}</span>
        <span>{displayText(entry.title).toUpperCase()}</span>
      </div>
      {view.rawOnly ? (
        <pre className={TOOL_ARGS} data-skin-text="">{planRawText(view)}</pre>
      ) : (
        view.steps.map((s) => (
          <div key={s.id} className={`${STEP_BASE} ${STEP[s.state] ?? STEP_IDLE}`} data-state={s.state}>
            <span className="bru-box inline-block w-[13px]">{s.state === "done" ? "■" : s.state === "active" ? "▣" : "□"}</span>
            {s.label.toUpperCase()}
          </div>
        ))
      )}
    </div>
  );
}

function BruInterrupt({ entry, live }: { entry: InterruptEntry; live: boolean }) {
  const c = useConversation();
  const pending = entry.status === "pending";
  const look = pending ? "pending" : entry.expired ? "expired" : "done";
  return (
    <div className={`${APPROVE_BASE} bru-approve--${look} ${APPROVE[look]}`}>
      <div className={`${APPROVE_HEAD_BASE} ${APPROVE_HEAD[look]}`}>
        {pending ? "▲ " + t("bru.approvalRequired") : entry.expired ? "■ " + t("bru.expired") : "■ " + t("bru.resolved")}
        <span>{timeOf(entry.at)}</span>
      </div>
      <h3 className="m-0 mb-[5px] text-[17px] font-bold leading-[1.25] tracking-[-0.01em]">{entry.message}</h3>
      {entry.description && <p className="bru-approve-desc m-0 mb-[11px] text-[12px] leading-[1.5] text-[#37342c]">{entry.description}</p>}
      <div className="bru-approve-terms mb-[12px] grid grid-cols-3 border-b-2 border-t-2 border-(--ink)">
        {entry.details.map((d, i) => (
          <div key={d.label} className={`py-[7px] pr-[10px] ${i > 0 ? "border-l-2 border-(--ink) pl-[12px]" : ""}`}>
            <span className={`block ${MONO} text-[8px] uppercase tracking-[0.16em] text-[#5a5548]`}>{d.label}</span>
            <b className="text-[14px] font-bold">{d.value}</b>
          </div>
        ))}
      </div>
      {pending ? (
        <div className="bru-approve-actions flex flex-wrap items-center gap-[10px]">
          <button className={`${BTN_BASE} ${BTN_OK}`} onClick={() => c.resolveInterrupt(true, undefined, entry.id)}>{t("bru.approve")}</button>
          <button className={`${BTN_BASE} ${BTN_NO}`} onClick={() => c.resolveInterrupt(false, undefined, entry.id)}>{t("bru.deny")}</button>
          <span className={`bru-approve-note ml-auto ${MONO} text-[8.5px] uppercase tracking-[0.1em] text-[#5a5548]`}>{t("bru.paused")} · {live ? t("bru.waiting") : t("bru.interrupt")}</span>
        </div>
      ) : (
        <div className={`bru-approve-resolved ${entry.expired ? "bru-approve-resolved--expired" : ""} ${MONO} text-[9.5px] font-semibold tracking-[0.08em] ${entry.expired ? "text-[#7a1d0c]" : "text-[#1f4a3d]"}`}>
          {entry.expired
            ? timeOf(entry.resolvedAt)
            : `✓ ${entry.status === "approved" ? t("bru.approvedByYou") : t("bru.deniedByYou")} · ${timeOf(entry.resolvedAt)}`}
        </div>
      )}
    </div>
  );
}

export default {
  id: "brutalist",
  name: "Brutalist",
  tagline: "Hard borders · loud approvals",
  swatch: ["#f2efe6", "#111111", "#ffe14d"] as [string, string, string],
  ChatPage: BrutalistPage,
};
