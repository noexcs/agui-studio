import { useMemo, useRef, useState } from "react";
import { useConversation } from "../../host";
import type { AssistantEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, SubagentEntry, ToolEntry } from "../../contract";
import { formatDuration, estimateTokens } from "../../utils";
import { plainText } from "../../utils";
import { toolStage } from "../../shared/toolStatus";
import { ToolResult, hasToolResultContent } from "../../shared/ToolResult";
import { planView, planRawText } from "../../shared/plan";
import { asArray, asRecord, displayText, isEmptyState, safeJson } from "../../shared/safe";
import { t } from "../../i18n";
import { useSkinBranding } from "../../host";
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
import "./paper.css";

/* ═══ Tailwind migration (task-13 Phase 2a) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-paper tokens via arbitrary var shorthand, so --sk-accent
   tuning and app.css's unlayered .lang-zh serif overrides keep working.
   paper.css keeps only tokens/keyframes/the data-URI grain/.pap-md (generated
   markdown elements)/scrollbars/focus ring/reduced-motion. Residual notes:
   • same-property state branches are written branch-exclusive (full values
     per branch, base string keeps none of those properties) — Tailwind's
     fixed utility sort, not intent, would otherwise pick the winner;
   • the original file's trailing "small legibility fixes" overrode earlier
     same-specificity rules — the computed values are baked into the
     utilities (.pap-column 664px, .pap-slip-title pr 150px, .pap-plan-box
     10px/600/green with only the done-state border-color branching);
   • the original 1180px media query became max-[1180px]: variants (v4 emits
     width < 1180px vs the original ≤1180px — 1px at the exact boundary,
     accepted repo-wide).
   The Icon import went away with the migration: paper renders no icons. */

const fmt = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
};

/* every status writes its full color/border-color/before-bg set — the base
   string keeps none of those properties (§1.6-1); unknown statuses fall back
   to the idle look */
const PAP_STATUS: Record<string, string> = {
  running:
    "text-[var(--accent-text,var(--vermilion))] border-[rgba(180,71,44,0.4)] before:bg-[var(--accent-text,var(--vermilion))] before:animate-[pap-pulse_1.6s_ease-in-out_infinite] motion-reduce:before:animate-none",
  interrupted: "text-[#8a5f16] border-(--rule-2) before:bg-[#b07a1e]",
  done: "text-(--ink-2) border-(--rule-2) before:bg-(--green)",
};
const PAP_STATUS_IDLE = "text-(--ink-2) border-(--rule-2) before:bg-(--ink-3)";
const STATUS_BASE =
  "pap-status inline-flex items-center gap-[6px] text-[9px] tracking-[0.14em] uppercase px-[9px] py-[4px] border before:h-[5px] before:w-[5px] before:rounded-full before:content-['']";

/* slip variants own the full border-style/border-color/background set plus
   everything that hangs off them (label/signed-line colors) — the base slip
   and its descendants keep none of those */
const SLIP =
  "pap-slip relative border px-[18px] py-[16px]";
const SLIP_HEAD = "pap-slip-head flex items-center justify-between mb-[8px]";
const SLIP_NO = "pap-slip-no [font-family:var(--mono)] text-[9px] text-(--ink-3)";
const SLIP_TITLE = "pap-slip-title mt-0 mb-[6px] pr-[150px] [font-family:var(--serif)] text-[19px] leading-[1.3]";
const SLIP_DESC = "pap-slip-desc mt-0 mb-[12px] [font-family:var(--body-serif)] text-[13px] text-(--ink-2) leading-[1.6]";
const SLIP_TERMS =
  "pap-slip-terms grid grid-cols-3 gap-[12px] py-[10px] border-y border-y-(--rule)";
const SLIP_TERMS_CELL = "flex flex-col gap-[2px]";
const SLIP_TERMS_SPAN = "text-[8px] tracking-[0.14em] uppercase text-(--ink-3)";
const SLIP_TERMS_B = "[font-family:var(--body-serif)] text-[14px] font-normal";
const SLIP_ACTIONS = "pap-slip-actions flex items-center gap-[14px] mt-[13px]";
const SLIP_OPEN =
  "border-dashed border-[rgba(180,71,44,0.55)] bg-[#fbf6ea] shadow-[0_1px_0_rgba(0,0,0,0.03)] before:content-['AWAITING_SIGNATURE'] before:absolute before:top-[12px] before:-right-[6px] before:rotate-[6deg] before:[font-family:var(--mono)] before:text-[8px] before:tracking-[0.16em] before:text-[rgba(180,71,44,0.75)] before:border before:border-[rgba(180,71,44,0.45)] before:px-[6px] before:py-[3px]";
const SLIP_LABEL_OPEN = "text-[var(--accent-text,var(--vermilion))]";
const SLIP_SIGNED = "border-solid border-[rgba(47,93,78,0.35)] bg-[#f2f6f1]";
const SLIP_LABEL_SIGNED = "text-(--green)";
const SLIP_SIGNED_LINE = "text-(--green)";
const SLIP_EXPIRED = "border-solid border-(--rule-2) bg-(--paper-2)";
const SLIP_LABEL_EXPIRED = "text-(--ink-2)";
const SLIP_SIGNED_LINE_EXPIRED = "text-(--ink-2)";
const SIGN =
  "pap-sign bg-(--ink) text-(--paper) text-[9px] tracking-[0.16em] uppercase px-[16px] py-[10px] [transition:background_0.2s] hover:bg-(--vermilion) disabled:opacity-50 disabled:cursor-default";
const DECLINE =
  "pap-decline text-[10px] tracking-[0.08em] text-(--ink-2) underline underline-offset-[3px] decoration-(--rule-2) hover:text-[var(--accent-text,var(--vermilion))]";
const EDITLINK =
  "pap-editlink ml-auto text-[9px] tracking-[0.1em] text-(--ink-3) underline underline-offset-[3px] hover:text-(--ink)";
const AMEND =
  "pap-amend mt-[14px] pt-[12px] border-t border-(--rule)";
const AMEND_LABEL = "block text-[8px] tracking-[0.14em] uppercase text-(--ink-3) mb-[6px]";
const AMEND_TEXTAREA =
  "w-full min-h-[90px] resize-y border border-(--rule-2) bg-[#fffdf7] px-[10px] py-[8px] [font-family:var(--mono)] text-[10.5px] leading-[1.6] text-(--ink) outline-none focus:[border-color:var(--accent-text,var(--vermilion))]";

const PS_CARD =
  "pap-ps-card group relative text-left border border-(--rule-2) bg-[#fffdf7] pl-[48px] pr-[14px] pt-[9px] pb-[8px] cursor-pointer [font-family:var(--body-serif)] [transition:border-color_0.2s,box-shadow_0.2s,transform_0.2s] hover:border-[var(--accent-text,var(--vermilion))] hover:shadow-[2px_2px_0_rgba(180,71,44,0.16)] hover:-translate-y-px";
const PS_LABEL = "pap-ps-label absolute left-[15px] top-[8px] [font-family:var(--serif)] italic text-[15px] text-[var(--accent-text,var(--vermilion))]";
const PS_TEXT = "pap-ps-text block text-[13px] leading-[1.5] text-(--ink)";
const PS_HINT =
  "pap-ps-hint block mt-[4px] [font-family:var(--mono)] text-[8px] tracking-[0.14em] uppercase text-(--ink-3) group-hover:text-[var(--accent-text,var(--vermilion))]";

const PROGRESS =
  "pap-progress flex items-baseline gap-[9px] mt-[4px] mb-[16px] ml-[4px] pt-[2px] pb-[10px] pl-[14px] [border-left:2px_dotted_var(--rule-2)]";
const PROGRESS_MARK = "pap-progress-mark [font-family:var(--serif)] text-[13px] text-(--ink-3)";
const PROGRESS_TEXT =
  "pap-progress-text [font-family:var(--body-serif)] italic text-[12.5px] tracking-[0.02em] text-(--ink-3)";
const BLINK = "pap-blink h-[5px] w-[5px] rounded-full bg-(--vermilion) animate-[pap-pulse_1.2s_ease-in-out_infinite] motion-reduce:animate-none";

const NOTE_BODY = "pap-note-body min-w-0";
const NOTE_LABEL =
  "pap-note-label flex items-center gap-[7px] text-[8.5px] tracking-[0.16em] uppercase text-(--ink-3) mb-[6px]";
const NOTE_META =
  "pap-note-meta ml-auto [font-family:var(--mono)] text-[8.5px] tracking-normal normal-case";
const NOTE_META_IDLE = "text-(--ink-3)";
const FOLD_HEAD =
  "pap-fold-head group flex w-full min-w-0 items-center gap-[8px] cursor-pointer text-left border-0 bg-none p-0 [font-family:inherit]";
const FOLD_LABEL = "pap-note-label pap-fold-label flex-1 min-w-0 mb-0";
const FOLD_LABEL_IDLE = "group-hover:text-(--ink-2) group-active:text-(--ink)";
const FOLD_MARK =
  "pap-fold-mark flex-none h-[16px] w-[16px] inline-flex items-center justify-center border rounded-full [font-family:var(--mono)] text-[11px] leading-none";
const FOLD_MARK_IDLE =
  "border-(--rule-2) text-(--ink-3) group-hover:border-(--ink-3) group-hover:text-(--ink-2)";
const FOLD_MARK_FAILURE = "border-(--vermilion) text-(--vermilion)";
const FOLD_NOTES = "pap-fold-notes grid gap-[12px] mt-[4px]";
const QUOTE =
  "pap-quote m-0 [font-family:var(--body-serif)] italic text-[12.5px] leading-[1.65] text-(--ink-2) border-l border-(--rule-2) pl-[10px]";
const ARGS =
  "pap-args m-0 [font-family:var(--mono)] text-[9.5px] leading-[1.6] text-(--ink-2) bg-[rgba(29,27,23,0.04)] border border-(--rule) px-[8px] py-[6px] max-h-[92px] overflow-auto whitespace-pre-wrap break-words";
const RESULT = "pap-result flex items-center gap-[6px] mt-[6px] [font-family:var(--mono)] text-[9.5px] text-(--green)";
const CHECK = "pap-check text-[10px]";
const TOOLNAME = "pap-toolname pap-mono normal-case tracking-normal text-(--ink-2) text-[9px]";
const PLAN_LIST = "pap-plan m-0 p-0 list-none flex flex-col gap-[4px]";
/* plan li text color + plan-box border-color are state branches (§1.6-1);
   the box glyph color is constant green (the original trailing "legibility
   fix" overrides won the cascade) */
const PLAN_LI: Record<string, string> = {
  active: "text-(--ink)",
  done: "text-(--ink-2)",
};
const PLAN_LI_IDLE = "text-(--ink-3)";
const PLAN_LI_BASE = "flex items-center gap-[7px] [font-family:var(--mono)] text-[10px]";
const PLAN_BOX = "pap-plan-box h-[12px] w-[12px] border inline-grid place-items-center text-[10px] leading-none font-semibold text-(--green)";
const PLAN_BOX_DONE = "border-(--green)";
const PLAN_BOX_IDLE = "border-(--rule-2)";
const DL = "pap-dl grid grid-cols-[auto_auto] gap-[2px_12px] m-0 [font-family:var(--mono)] text-[10px]";

export function PaperPage() {
  const c = useConversation();
  const { visible: visibleEntries, hidden, showEarlier } = useVisibleEntries(c.entries);
  const brand = useSkinBranding();
  const scroller = useStickToBottom<HTMLDivElement>();
  const notesRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [signingId, setSigningId] = useState<string | null>(null);
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [editJson, setEditJson] = useState<Record<string, string>>({});
  const input = useRef<HTMLTextAreaElement>(null);
  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries)[0];
  // The demo state is an object; a third-party snapshot may be a scalar/array.
  // Read it through the guards so `.trip?.budget` never runs on null and the
  // panel shows raw JSON rather than fabricated defaults for an unknown shape.
  const shared = asRecord(c.sharedState);
  const sharedTrip = asRecord(shared?.trip);
  const sharedBudget = asRecord(shared?.budget);
  const itinerary = asArray(shared?.itinerary);
  const bookings = asArray(shared?.bookings);
  const hasDemoState =
    !!shared && ["trip", "budget", "itinerary", "bookings"].some((key) => Object.prototype.hasOwnProperty.call(shared, key));
  const showRawState = !isEmptyState(c.sharedState) && !hasDemoState;

  // Consecutive reasoning/tool artefacts collapse into one margin-note group.
  // Grouping runs on the full stream so only truly adjacent entries merge —
  // then the two columns pick their items from the same list.
  const foldItems = useMemo(() => conversationGroups(visibleEntries), [visibleEntries]);
  const letters = foldItems.flatMap((item) =>
    item.type === "entry" && (item.entry.kind === "user" || item.entry.kind === "assistant" || item.entry.kind === "interrupt" || item.entry.kind === "error")
      ? [item.entry]
      : []
  );
  const noteItems = foldItems.filter(
    (item) =>
      item.type === "group" ||
      (item.type === "entry" && (item.entry.kind === "reasoning" || item.entry.kind === "tool" || item.entry.kind === "plan" || item.entry.kind === "subagent"))
  );
  const notes = noteItems.flatMap((item): (ReasoningEntry | ToolEntry | PlanEntry | SubagentEntry)[] => {
    if (item.type === "group") {
      return item.entries.filter((e): e is ReasoningEntry | ToolEntry => e.kind === "reasoning" || e.kind === "tool");
    }
    return item.entry.kind === "reasoning" || item.entry.kind === "tool" || item.entry.kind === "plan" || item.entry.kind === "subagent"
      ? [item.entry]
      : [];
  });
  const firstAssistant = useMemo(() => c.entries.find((e) => e.kind === "assistant")?.id, [c.entries]);
  // While the run is mid-tool the main column would otherwise sit empty
  // (letters only gain an entry as they are written) — name the activity in
  // progress, or keep naming the last artefact in the gaps between events.
  const activeNote = [...c.entries].reverse().find(
    (e): e is ReasoningEntry | ToolEntry | SubagentEntry =>
      (e.kind === "reasoning" && e.streaming) ||
      (e.kind === "tool" && (e.status === "args" || e.status === "executing")) ||
      (e.kind === "subagent" && e.status === "running")
  );
  const lastNote = notes[notes.length - 1];
  const progressNote = activeNote ?? lastNote;
  const progressLabel = progressNote
    ? progressNote.kind === "reasoning"
      ? t("paper.thinking")
      : progressNote.kind === "tool"
      ? `${t("paper.toolCall")} · ${displayText(progressNote.name)}`
      : progressNote.kind === "plan"
      ? `${t("paper.plan")} · ${displayText(progressNote.title)}`
      : `${t("paper.subagent")} · ${displayText(progressNote.name)}`
    : "";

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  function beginSigning(id?: string) {
    const target = id
      ? c.entries.find((e): e is InterruptEntry => e.kind === "interrupt" && e.id === id && e.status === "pending")
      : pending;
    if (!target) return;
    const tool = c.entries.find((e): e is ToolEntry => e.kind === "tool" && e.id === target.toolCallId);
    // Draft state is keyed by interrupt id: several pending cards must never
    // share an editor or submit each other's args.
    setEditJson((prev) => ({ ...prev, [target.id]: JSON.stringify(tool?.args ?? {}, null, 2) }));
    setSigningId(target.id);
  }

  function approve(id?: string) {
    if (id && signingId === id) {
      try {
        c.resolveInterrupt(true, JSON.parse(editJson[id] ?? ""), id);
      } catch {
        c.resolveInterrupt(true, undefined, id);
      }
    } else {
      c.resolveInterrupt(true, undefined, id);
    }
    setSigningId(null);
  }

  return (
    <div className="skin-paper relative h-full bg-(--paper) text-(--ink) [font-family:Inter,system-ui,sans-serif]">
      <div className="pap-grain" aria-hidden="true" />
      <div className="pap-shell relative flex h-full flex-col">
        <header className="pap-masthead flex-none flex items-end justify-between gap-[20px] px-[34px] pt-[20px] pb-[14px] border-b border-(--rule-2)">
          <div className="pap-mast-left flex items-center gap-[12px] min-w-0">
            <span className="pap-kicker text-[9px] tracking-[0.22em] uppercase text-[var(--accent-text,var(--vermilion))] font-semibold">{t("paper.fieldNotes")}</span>
            <span className="pap-rule h-px w-[28px] bg-(--rule-2)" />
            <span className="pap-mast-title [font-family:var(--serif)] text-[21px] tracking-[0.01em] text-(--ink)">{brand.agentName}</span>
          </div>
          <div className="pap-mast-right flex items-center gap-[14px]">
            <span className="pap-meta [font-family:var(--mono)] text-[9.5px] tracking-[0.06em] text-(--ink-3) uppercase">{fmt(c.events[0]?.event.timestamp as string)} · {c.threadId.slice(-6).toUpperCase()}</span>
            <span className={`${STATUS_BASE} pap-status--${c.status} ${PAP_STATUS[c.status] ?? PAP_STATUS_IDLE}`}>
              {c.status === "running" ? t("paper.recording") : c.status === "interrupted" ? t("paper.awaiting") : c.status === "done" ? t("paper.filed") : t(("status." + c.status) as never)}
            </span>
          </div>
        </header>

        <div className="pap-body grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_336px] max-[1180px]:grid-cols-[minmax(0,1fr)] max-[1180px]:grid-rows-[minmax(0,1fr)_auto]">
          {/* main column: the correspondence */}
          <div className="pap-main overflow-y-auto px-[48px] pt-[34px] pb-[12px]" ref={scroller}>
            <div className="pap-column mx-auto flex max-w-[664px] flex-col gap-[26px]">
              <div className="pap-lead border-b border-(--rule) pb-[18px]">
                <p className="m-0 [font-family:var(--body-serif)] italic text-[13.5px] leading-[1.7] text-(--ink-3)">{t("paper.lead")}</p>
              </div>

              {letters.map((entry) => (
                <div key={entry.id} className="pap-entry">
                  {entry.kind === "user" && (
                    <div className="pap-user ml-auto max-w-[82%] text-right pb-[12px] border-b border-(--rule)">
                      <div className="pap-user-tag text-[8.5px] tracking-[0.18em] uppercase text-(--ink-3) mb-[7px]">{t("chat.you")} · {timeOf(entry.at)}</div>
                      <p className="m-0 [font-family:var(--body-serif)] text-[14.5px] leading-[1.65] text-(--ink)">{entry.text}</p>
                    </div>
                  )}

                  {entry.kind === "assistant" && (
                    <article className={`pap-letter ${entry.id === firstAssistant ? "pap-letter--lede" : ""}`}>
                      <div className="pap-letter-tag flex items-center gap-[7px] mb-[10px] text-[8.5px] tracking-[0.18em] uppercase text-(--ink-3)">
                        <span className="pap-dotmark h-[5px] w-[5px] rounded-full bg-(--vermilion)" />
                        <span>{t("chat.assistant")}</span>
                        <span className="pap-letter-meta ml-auto [font-family:var(--mono)] tracking-[0.02em] normal-case text-[9px]">
                          {entry.streaming ? t("status.writing") : `${estimateTokens(entry.text)} ${t("chat.tokens")}`}
                        </span>
                      </div>
                      <Markdown className={`pap-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
                    </article>
                  )}

                  {entry.kind === "error" && (
                    <article className="pap-error border border-[rgba(180,71,44,0.45)] bg-[rgba(180,71,44,0.05)] px-[18px] py-[14px]">
                      <div className="pap-error-tag flex items-center gap-[7px] mb-[8px] text-[8.5px] tracking-[0.18em] uppercase text-[var(--accent-text,var(--vermilion))] font-semibold">
                        <span className="pap-dotmark h-[5px] w-[5px] rounded-full bg-(--vermilion)" />
                        <span>{t("paper.errorLabel")}</span>
                        <span className="pap-letter-meta ml-auto [font-family:var(--mono)] tracking-[0.02em] normal-case text-[9px]">RUN_ERROR</span>
                      </div>
                      <p className="pap-error-msg m-0 [font-family:var(--body-serif)] text-[14.5px] leading-[1.65] text-[var(--accent-text,var(--vermilion))]">{entry.message}</p>
                    </article>
                  )}

                  {entry.kind === "interrupt" && (() => {
                    const variant = entry.status === "pending" ? "open" : entry.expired ? "expired" : "signed";
                    return (
                    <div className={`${SLIP} ${variant === "open" ? SLIP_OPEN : variant === "expired" ? SLIP_EXPIRED : SLIP_SIGNED}`}>
                      <div className={SLIP_HEAD}>
                        <span className={`pap-slip-label text-[8.5px] tracking-[0.18em] uppercase font-semibold ${variant === "open" ? SLIP_LABEL_OPEN : variant === "expired" ? SLIP_LABEL_EXPIRED : SLIP_LABEL_SIGNED}`}>
                          {entry.status === "pending" ? t("paper.authorisation") : entry.expired ? t("paper.expiredLabel") : entry.status === "approved" ? t("paper.signedLabel") : t("paper.declinedLabel")}
                        </span>
                        <span className={SLIP_NO}>{timeOf(entry.at)}</span>
                      </div>
                      <div className="pap-slip-body">
                        <p className={SLIP_TITLE}>{entry.message}</p>
                        {entry.description && <p className={SLIP_DESC}>{entry.description}</p>}
                        <div className={SLIP_TERMS}>
                          {entry.details.map((d) => (
                            <div key={d.label} className={SLIP_TERMS_CELL}>
                              <span className={SLIP_TERMS_SPAN}>{d.label}</span>
                              <b className={SLIP_TERMS_B}>{d.value}</b>
                            </div>
                          ))}
                        </div>
                      </div>
                      {entry.status === "pending" ? (
                        <div className={SLIP_ACTIONS}>
                          <button className={SIGN} onClick={() => approve(entry.id)} disabled={!pending}>
                            {t("paper.sign")}
                          </button>
                          <button className={DECLINE} onClick={() => c.resolveInterrupt(false, undefined, entry.id)}>
                            {t("paper.decline")}
                          </button>
                          <button className={EDITLINK} onClick={() => beginSigning(entry.id)}>{t("paper.amend")}</button>
                        </div>
                      ) : (
                        <div className={`pap-slip-signed mt-[12px] [font-family:var(--mono)] text-[9.5px] tracking-[0.03em] ${variant === "expired" ? SLIP_SIGNED_LINE_EXPIRED : SLIP_SIGNED_LINE}`}>
                          {entry.status === "approved" ? t("paper.signed") : entry.expired ? t("paper.expired") : t("paper.declined")} · {timeOf(entry.resolvedAt)}
                        </div>
                      )}
                      {entry.status === "pending" && signingId === entry.id && (
                        <div className={AMEND}>
                          <label className={AMEND_LABEL}>{t("paper.amendLabel")}</label>
                          <textarea
                            value={editJson[entry.id] ?? ""}
                            onChange={(e) => setEditJson((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                            spellCheck={false}
                            className={AMEND_TEXTAREA}
                          />
                          <div className={SLIP_ACTIONS}>
                            <button className={SIGN} onClick={() => approve(entry.id)}>{t("paper.signEdit")}</button>
                            <button className={EDITLINK} onClick={() => setSigningId(null)}>{t("intr.cancel")}</button>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })()}
                </div>
              ))}

              {/* P.S. cards: the agent's suggested next lines, clickable */}
              {c.suggestions.length > 0 && (
                <div className="pap-ps flex flex-col gap-[8px] pt-[6px] pb-[18px]">
                  {c.suggestions.map((text) => (
                    <button key={text} className={PS_CARD} onClick={() => c.send(text)}>
                      <span className={PS_LABEL}>{t("paper.ps")}</span>
                      <span className={PS_TEXT}>{text}</span>
                      <span className={PS_HINT}>{t("paper.psHint")}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* the pen is still moving: name what the agent is doing */}
              {c.status === "running" && (activeNote || letters.length === 0) && (
                <div className={PROGRESS} aria-live="polite">
                  <span className="pap-progress-rule" aria-hidden="true" />
                  <span className="pap-progress-body">
                    <span className={PROGRESS_MARK} aria-hidden="true">✎</span>
                    <span className={PROGRESS_TEXT}>
                      {t("paper.inProgress")}
                      {progressLabel ? ` — ${progressLabel}` : ""}
                    </span>
                    <i className={`${BLINK} self-center flex-none`} aria-hidden="true" />
                  </span>
                </div>
              )}

              {c.entries.length > 0 && c.status === "done" && (
                <div className="pap-colophon flex items-center justify-between border-t border-(--rule-2) pt-[14px] pb-[30px] [font-family:var(--mono)] text-[9px] tracking-[0.08em] uppercase text-(--ink-3)">
                  <span>{t("paper.end")}</span>
                  <span>{formatDuration(c.duration())} · {c.tokens} tokens · {c.events.length} protocol events</span>
                </div>
              )}
            </div>
          </div>

          {/* margin: protocol artefacts as footnotes */}
          <aside className="pap-rail flex min-h-0 flex-col border-l border-(--rule) bg-[rgba(29,27,23,0.018)] max-[1180px]:border-l-0 max-[1180px]:border-t max-[1180px]:border-t-(--rule) max-[1180px]:max-h-[36vh]">
            <div className="pap-rail-head flex-none flex items-baseline justify-between px-[20px] pt-[16px] pb-[10px] text-[8.5px] tracking-[0.2em] uppercase text-(--ink-3) border-b border-(--rule)">
              <span>{t("paper.marginNotes")}</span>
              <span className="pap-rail-run [font-family:var(--mono)] tracking-normal normal-case text-[9px]">{c.runId}</span>
            </div>
            <div className="pap-rail-scroll min-h-0 flex-1 overflow-y-auto px-[20px] pt-[4px] pb-[12px]" ref={notesRef}>
              {notes.length === 0 && <p className="pap-empty [font-family:var(--body-serif)] italic text-[12px] text-(--ink-3) py-[14px]">{t("paper.marginEmpty")}</p>}

              {noteItems.map((item, i) => (
                <div key={item.type === "group" ? item.id : item.entry.id} className="pap-note grid grid-cols-[22px_minmax(0,1fr)] gap-[6px] py-[13px] border-b border-(--rule-2) [border-bottom-style:dotted] last:border-b-0">
                  <span className="pap-note-no [font-family:var(--mono)] text-[9px] text-(--ink-3) pt-[2px]">{String(i + 1).padStart(2, "0")}</span>
                  {item.type === "group" ? (
                    <FoldNote
                      entries={item.entries}
                      open={foldOverride[item.id] ?? foldGroupOpen(item.entries)}
                      onToggle={() =>
                        setFoldOverride((prev) => ({ ...prev, [item.id]: !(foldOverride[item.id] ?? foldGroupOpen(item.entries)) }))
                      }
                    />
                  ) : (
                    <>
                      {item.entry.kind === "reasoning" && <ReasoningNote entry={item.entry} />}
                      {item.entry.kind === "tool" && <ToolNote entry={item.entry} />}
                      {item.entry.kind === "plan" && <PlanNote entry={item.entry} />}
                      {item.entry.kind === "subagent" && <SubagentNote entry={item.entry} />}
                    </>
                  )}
                </div>
              ))}

              {!isEmptyState(c.sharedState) && (
                <div className="pap-note grid grid-cols-[22px_minmax(0,1fr)] gap-[6px] py-[13px] border-b border-(--rule-2) [border-bottom-style:dotted] last:border-b-0">
                  <span className="pap-note-no [font-family:var(--mono)] text-[9px] text-(--ink-3) pt-[2px]">§</span>
                  <div className={NOTE_BODY}>
                    <div className={NOTE_LABEL}>{t("paper.sharedState")} · v{c.stateVersion}</div>
                    {showRawState ? (
                      <pre className={ARGS} data-skin-text="">{safeJson(c.sharedState)}</pre>
                    ) : (
                      <dl className={DL}>
                        <dt className="text-(--ink-3)">budget</dt>
                        <dd className="m-0 text-right text-(--ink-2)">€{sharedTrip?.budget === undefined || sharedTrip?.budget === null ? "—" : displayText(sharedTrip.budget)}</dd>
                        <dt className="text-(--ink-3)">lodging</dt>
                        <dd className="m-0 text-right text-(--ink-2)">€{sharedBudget?.lodging === undefined || sharedBudget?.lodging === null ? 0 : displayText(sharedBudget.lodging)}</dd>
                        <dt className="text-(--ink-3)">total</dt>
                        <dd className="m-0 text-right text-(--ink-2)">€{sharedBudget?.total === undefined || sharedBudget?.total === null ? 0 : displayText(sharedBudget.total)}</dd>
                        <dt className="text-(--ink-3)">days</dt>
                        <dd className="m-0 text-right text-(--ink-2)">{itinerary.length}</dd>
                        <dt className="text-(--ink-3)">bookings</dt>
                        <dd className="m-0 text-right text-(--ink-2)">{bookings.length}</dd>
                      </dl>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="pap-rail-foot flex-none flex justify-between px-[20px] py-[10px] border-t border-(--rule) [font-family:var(--mono)] text-[9px] text-(--ink-3)">
              <span>{c.events.length} events</span>
              <span className="pap-mono [font-family:var(--mono)]">STATE_DELTA × {Math.max(0, c.stateVersion - 1)}</span>
            </div>
          </aside>
        </div>

        <footer className="pap-composer flex-none border-t border-(--rule-2) px-[48px] pt-[12px] pb-[10px] bg-[linear-gradient(180deg,rgba(244,239,228,0.4),var(--paper)_40%)]">
          <div className="pap-composer-inner mx-auto flex max-w-[648px] items-start gap-[14px]">
            <span className="pap-composer-prompt flex-none pt-[5px] text-[8.5px] tracking-[0.2em] uppercase text-(--ink-3)">{t("chat.reply")}</span>
            <textarea
              ref={input}
              rows={1}
              value={draft}
              aria-label={t("chat.replyPlaceholder")}
              placeholder={t("chat.replyPlaceholder")}
              className="flex-1 min-h-[30px] border-x-0 border-t-0 border-b border-b-(--rule-2) bg-transparent outline-none resize-none px-[2px] pt-[4px] pb-[7px] [font-family:var(--body-serif)] text-[14.5px] leading-[1.6] text-(--ink) placeholder:italic placeholder:text-(--ink-3) focus:[border-bottom-color:var(--accent-text,var(--vermilion))]"
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                if (e.key === "Escape") c.stop();
              }}
            />
            {running ? (
              <button className={`pap-send pap-send--stop flex-none text-[9px] tracking-[0.16em] uppercase px-[16px] py-[9px] [transition:background_0.2s] text-(--paper) bg-(--vermilion)`} onClick={() => c.stop()}>{t("chat.stop")}</button>
            ) : (
              <button className="pap-send flex-none text-[9px] tracking-[0.16em] uppercase px-[16px] py-[9px] [transition:background_0.2s] text-(--paper) bg-(--ink) hover:bg-(--vermilion) disabled:opacity-30 disabled:cursor-default" onClick={send} disabled={!draft.trim()}>{t("chat.send")}</button>
            )}
          </div>
          <div className="pap-composer-hint mx-auto mt-[7px] flex max-w-[648px] justify-between text-[9px] tracking-[0.04em] text-(--ink-3)">
            <span>{t("paper.hint")}</span>
          </div>
        </footer>
      </div>
      <ProtocolDrawer />
    </div>
  );
}

/**
 * One footnote standing in for a run of consecutive thinking/tool notes.
 * Letterpress fold head (+/− mark); failures surface in the meta line so a
 * collapsed group never reads as "all fine".
 */
function FoldNote({ entries, open, onToggle }: { entries: Entry[]; open: boolean; onToggle: () => void }) {
  const failures = foldGroupFailures(entries);
  const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
  const stats = foldGroupStats(entries);
  return (
    <div className={NOTE_BODY}>
      <button
        type="button"
        className={FOLD_HEAD}
        data-fold-head=""
        aria-expanded={open}
        data-failure={failure}
        onClick={onToggle}
        onKeyDown={(e) => {
          // explicit for the keydown contract test (jsdom runs no activation)
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={`${NOTE_LABEL} ${FOLD_LABEL} ${FOLD_LABEL_IDLE}`}>
          {t("fold.group")}
          <span className={`${NOTE_META} ${failure ? "text-[var(--accent-text,var(--vermilion))]" : NOTE_META_IDLE}`}>
            {entries.length} {t("fold.steps")}
            {stats.toolCount > 0 ? ` · ${stats.toolCount} ${t("paper.toolCall")}` : ""}
            {failure ? ` · ${failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}` : foldGroupOpen(entries) ? ` · ${t("paper.inProgress")}` : ""}
          </span>
        </span>
        <span className={`${FOLD_MARK} ${failure ? FOLD_MARK_FAILURE : FOLD_MARK_IDLE}`} aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className={FOLD_NOTES}>
          {entries.map((entry) =>
            entry.kind === "reasoning" ? (
              <ReasoningNote key={entry.id} entry={entry} />
            ) : entry.kind === "tool" ? (
              <ToolNote key={entry.id} entry={entry} />
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

function ReasoningNote({ entry }: { entry: ReasoningEntry }) {
  return (
    <div className={NOTE_BODY}>
      <div className={NOTE_LABEL}>
        {t("paper.thinking")} {entry.streaming && <i className={BLINK} />}
        <span className={`${NOTE_META} ${NOTE_META_IDLE}`}>{entry.streaming ? t("paper.inProgress") : formatDuration(entry.durationMs ?? 0)}</span>
      </div>
      <p className={QUOTE}>{plainText(entry.text, 220)}</p>
    </div>
  );
}

function ToolNote({ entry }: { entry: ToolEntry }) {
  const stage = toolStage(entry.status);
  const hasResult = hasToolResultContent(entry);
  return (
    <div className={NOTE_BODY}>
      <div className={NOTE_LABEL}>
        {t("paper.toolCall")} <span className={TOOLNAME}>{displayText(entry.name)}</span>
      </div>
      <pre className={ARGS} data-skin-text="">{entry.argsRaw ? safeJson(entry.args ?? entry.argsRaw, 1) : "…"}</pre>
      {stage !== "done" && stage !== "error" && (
        <div className={`${NOTE_META} ${NOTE_META_IDLE}`}>
          {stage === "streaming" ? t("chat.streamingArgs") : stage === "interrupted" ? t("chat.interrupted") : t("chat.executing")}
        </div>
      )}
      <ToolResult entry={entry} variant="paper" />
      {stage === "done" && !hasResult && (
        <div className={RESULT}>
          <span className={CHECK}>✓</span>
          {t("chat.done")}
          <span className={`${NOTE_META} ${NOTE_META_IDLE}`}>{formatDuration(entry.durationMs ?? 0)}</span>
        </div>
      )}
    </div>
  );
}

function PlanNote({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  const done = view.steps.filter((s) => s.state === "done").length;
  return (
    <div className={NOTE_BODY}>
      <div className={NOTE_LABEL}>
        {t("paper.plan")} <span className={`${NOTE_META} ${NOTE_META_IDLE}`}>{done}/{view.steps.length}</span>
      </div>
      {view.rawOnly ? (
        <pre className={ARGS} data-skin-text="">{planRawText(view)}</pre>
      ) : (
        <ul className={PLAN_LIST}>
          {view.steps.map((s) => (
            <li key={s.id} data-state={s.state} className={`${PLAN_LI_BASE} ${PLAN_LI[s.state] ?? PLAN_LI_IDLE}`}>
              <span className={`${PLAN_BOX} ${s.state === "done" ? PLAN_BOX_DONE : PLAN_BOX_IDLE}`}>{s.state === "done" ? "×" : s.state === "active" ? "~" : ""}</span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubagentNote({ entry }: { entry: SubagentEntry }) {
  return (
    <div className={NOTE_BODY}>
      <div className={NOTE_LABEL}>
        {t("paper.subagent")} <span className={TOOLNAME}>{displayText(entry.name)}</span>
        <span className={`${NOTE_META} ${NOTE_META_IDLE}`}>{entry.status}</span>
      </div>
      {entry.detail && <p className={QUOTE}>{plainText(entry.detail, 220)}</p>}
    </div>
  );
}

export default {
  id: "paper",
  name: "Paper",
  tagline: "Editorial light · margin notes",
  swatch: ["#f4efe6", "#e7dfd0", "#b4472c"] as [string, string, string],
  ChatPage: PaperPage,
};
