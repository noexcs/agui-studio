import { useMemo, useRef, useState } from "react";
import { useConversation, useSkinPlugins } from "../../host";
import type { AssistantEntry, CustomEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, StepEntry, SubagentEntry, ToolEntry } from "../../contract";
import { formatDuration, estimateTokens } from "../../utils";
import { Icon } from "../../shared/Icon";
import { ToolResult } from "../../shared/ToolResult";
import { planView, planRawText } from "../../shared/plan";
import { displayText, isEmptyState, safeJson } from "../../shared/safe";
import { t } from "../../i18n";
import { useSkinBranding } from "../../host";
import * as RadixTabs from "@radix-ui/react-tabs";
import { JsonView, darkStyles } from "react-json-view-lite";
import { Markdown, timeOf } from "../../shared/Markdown";
import { pendingInterrupts } from "../../shared/interrupts";
import {
  conversationGroups,
  foldGroupFailures,
  foldGroupOpen,
  foldGroupStats,
} from "../../shared/conversationGroups";
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { useStickToBottom } from "../../shared/useStickToBottom";
import "./aurora.css";

/* ═══ Tailwind migration (task-13 Phase 2a) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-aurora tokens via arbitrary var shorthand, so
   --sk-accent tuning and app.css's unlayered .lang-zh overrides keep working.
   aurora.css keeps only tokens/keyframes/resets/@layer-base ring/scrollbars/
   .prose (generated markdown elements). Residual notes:
   • same-property state branches are written branch-exclusive (full values
     per branch, base string keeps none of those properties) — Tailwind's
     fixed utility sort, not intent, would otherwise pick the winner;
     hover variants live in the branch they belong to (hover loses to
     is-active in the original CSS source order).
   • dead rules were dropped after DOM probes: .icon/.sprite/.is-hidden/.toast
     match nothing (Icon renders lucide svgs without an .icon class), the
     sidebar/thread/usage blocks and .avatar--sm/.agent-orb--violet/--amber
     have no JSX sites, .ev-more/.insp-meta* are top-level (outside the
     .skin-aurora block) so the button reset kills their padding/bg —
     .ev-more renders as a naked button and its :hover is a no-op
     (var(--text-1) is undefined). All reproduced as "no utilities".
   • .tab/.tab-count active styling comes from app.css's data-state rules
     (aurora.css's .is-active pair is dead — Radix never sets that class);
     the violet tab-count variant is the live one. Those app.css rules moved
     here as branch classes; aurora's inspector no longer depends on app.css. */

const BLOCK = "block mx-auto max-w-[812px] animate-[rise_0.5s_var(--ease)_both]";

/* every status styles the same properties explicitly — base stays out of the
   unconditional string (§1.6-1); unknown statuses fall back to the idle look */
const RUN_PILL: Record<string, string> = {
  idle: "border-(--border) bg-[rgba(255,255,255,0.03)]",
  stopped: "border-(--border) bg-[rgba(255,255,255,0.03)]",
  done: "border-(--border) bg-[rgba(255,255,255,0.03)]",
  error: "border-(--border) bg-[rgba(255,255,255,0.03)]",
  running: "border-[rgba(94,240,194,0.3)] bg-[rgba(94,240,194,0.07)]",
  interrupted: "border-[rgba(255,196,107,0.34)] bg-[rgba(255,196,107,0.09)]",
};
const RUN_PILL_DOT: Record<string, string> = {
  idle: "bg-(--text-3)",
  stopped: "bg-(--text-3)",
  done: "bg-(--mint)",
  error: "bg-(--rose)",
  running: "bg-(--mint) shadow-[0_0_0_0_rgba(94,240,194,0.5)] animate-[pulse-ring_1.8s_ease-out_infinite] motion-reduce:animate-none",
  interrupted: "bg-(--amber) animate-[pulse-ring-amber_1.8s_ease-out_infinite] motion-reduce:animate-none",
};
const RUN_PILL_TEXT: Record<string, string> = {
  idle: "text-(--text-2)",
  stopped: "text-(--text-2)",
  done: "text-(--text-2)",
  running: "text-(--mint)",
  interrupted: "text-(--amber)",
  error: "text-(--rose)",
};

const CAP_NORMAL = "border-(--border) bg-[rgba(255,255,255,0.025)] text-(--text-2)";
const CAP_HITL = "border-[rgba(255,196,107,0.24)] bg-[rgba(255,196,107,0.07)] text-(--amber)";

const TOOL_BOX: Record<string, string> = {
  base: "border-[rgba(90,200,255,0.2)] bg-[linear-gradient(180deg,rgba(90,200,255,0.07),rgba(90,200,255,0.015))]",
  done: "border-[rgba(94,240,194,0.22)] bg-[linear-gradient(180deg,rgba(94,240,194,0.055),rgba(94,240,194,0.012))]",
  error: "border-[rgba(255,122,138,0.3)] bg-[linear-gradient(180deg,rgba(255,122,138,0.07),transparent)]",
};
const TOOL_ICON: Record<string, string> = {
  base: "border-[rgba(90,200,255,0.22)] bg-[rgba(90,200,255,0.14)] text-(--cyan)",
  done: "border-[rgba(94,240,194,0.24)] bg-[rgba(94,240,194,0.14)] text-(--mint)",
};
const TOOL_PILL: Record<string, string> = {
  base: "border-(--border) text-(--text-2)",
  done: "border-[rgba(94,240,194,0.24)] bg-[rgba(94,240,194,0.08)] text-(--mint)",
};

const PLAN_STEP_COLOR: Record<string, string> = { done: "text-(--text-2)", active: "text-[#fff]" };
const PLAN_CHECK: Record<string, string> = {
  done: "border-(--mint) bg-(--mint) text-[#04140f]",
  active: "border-(--cyan) shadow-[0_0_0_3px_rgba(90,200,255,0.12)] after:content-[''] after:h-[5px] after:w-[5px] after:rounded-full after:bg-(--cyan) after:animate-[pulse-soft_1.2s_infinite] motion-reduce:after:animate-none",
};

/* category → --cat for the ev-row stripe (data-cat values, full ids);
   "reasoning" renders #d3b4ff via data-cat (the fdot--reas slice below has
   no rule — that gap exists in the base CSS and is reproduced, not fixed) */
const CAT: Record<string, string> = {
  lifecycle: "[--cat:var(--mint)]",
  text: "[--cat:#9fb2c9]",
  tool: "[--cat:var(--cyan)]",
  state: "[--cat:var(--violet)]",
  reasoning: "[--cat:#d3b4ff]",
  special: "[--cat:var(--amber)]",
};
/* fdot--<cat.slice(0,4)> → dot color; "reas" intentionally missing (the base
   CSS only defines fdot--reason, which the slice(0,4) never produces) */
const FDOT: Record<string, string> = {
  life: "bg-(--mint)",
  text: "bg-[#9fb2c9]",
  tool: "bg-(--cyan)",
  state: "bg-(--violet)",
  special: "bg-(--amber)",
};

const TAB_ACTIVE = "text-(--text) bg-[rgba(255,255,255,0.07)] shadow-[0_1px_2px_rgba(0,0,0,0.4)]";
const TAB_IDLE = "text-(--text-3) hover:text-(--text-2)";
const TAB_COUNT_ACTIVE = "text-(--violet) bg-[rgba(167,139,250,0.12)]";
const TAB_COUNT_IDLE = "text-(--text-3) bg-[rgba(255,255,255,0.06)]";

const BTN_BASE =
  "inline-flex h-8 items-center gap-[6px] rounded-[9px] border px-[14px] text-[12px] [transition:all_0.22s_var(--ease)] hover:-translate-y-px active:translate-y-0";
/* each kind writes the full bg/border/color set it needs (incl. its hover bg —
   the original .btn--X:hover rules won the source-order fight vs .btn:hover) */
const BTN_KIND: Record<string, string> = {
  approve:
    "border-transparent bg-[image:var(--accent-grad)] font-semibold text-[#04140f] shadow-[0_12px_26px_-14px_rgba(94,240,194,0.8)] hover:border-(--border-2) hover:bg-[image:var(--accent-grad)] hover:brightness-[1.06] hover:shadow-[0_16px_30px_-14px_rgba(94,240,194,0.9)]",
  deny: "border-(--border) bg-[rgba(255,255,255,0.04)] font-medium text-(--text) hover:border-[rgba(255,122,138,0.35)] hover:bg-[rgba(255,122,138,0.08)] hover:text-(--rose)",
  ghost: "border-transparent bg-transparent text-[11px] font-medium text-(--text-3) hover:border-(--border-2) hover:bg-[rgba(255,255,255,0.05)] hover:text-(--text-2)",
};

const INTERRUPT_BOX: Record<string, string> = {
  pending: "border-[rgba(255,196,107,0.3)] bg-[linear-gradient(180deg,rgba(255,196,107,0.11),rgba(255,196,107,0.02))] shadow-[0_30px_60px_-44px_rgba(255,196,107,0.7)] before:bg-[linear-gradient(90deg,transparent,rgba(255,196,107,0.7),transparent)]",
  resolved: "border-[rgba(94,240,194,0.24)] bg-[linear-gradient(180deg,rgba(94,240,194,0.07),transparent)] shadow-none before:bg-[linear-gradient(90deg,transparent,rgba(94,240,194,0.5),transparent)]",
  expired: "border-[rgba(154,164,182,0.24)] bg-[linear-gradient(180deg,rgba(154,164,182,0.07),transparent)] shadow-none before:bg-[linear-gradient(90deg,transparent,rgba(154,164,182,0.45),transparent)]",
};
const INTERRUPT_ICON: Record<string, string> = {
  pending: "border-[rgba(255,196,107,0.3)] bg-[rgba(255,196,107,0.16)] text-(--amber)",
  resolved: "border-[rgba(255,196,107,0.3)] bg-[rgba(255,196,107,0.16)] text-(--amber)",
  expired: "border-[rgba(154,164,182,0.28)] bg-[rgba(154,164,182,0.12)] text-(--text-2)",
};
const INTERRUPT_KICKER: Record<string, string> = {
  pending: "text-(--amber)",
  resolved: "text-(--amber)",
  expired: "text-(--text-2)",
};

const FOLD_FLAG: Record<string, string> = {
  error: "text-(--rose) bg-[rgba(255,122,138,0.1)]",
  interrupted: "text-(--amber) bg-(--amber-soft)",
  live: "text-(--cyan) bg-[rgba(90,200,255,0.1)]",
};

const SEND =
  "grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-[image:var(--accent-grad)] text-[#04140f] shadow-[0_10px_24px_-12px_rgba(94,240,194,0.9),0_0_0_1px_rgba(255,255,255,0.16)_inset] [transition:all_0.25s_var(--ease-spring)] hover:-translate-y-px hover:scale-[1.03] hover:shadow-[0_14px_30px_-12px_rgba(94,240,194,1)] active:scale-[0.95] disabled:bg-none disabled:bg-[rgba(255,255,255,0.07)] disabled:text-(--text-3) disabled:shadow-none disabled:cursor-default disabled:transform-none disabled:translate-none disabled:scale-100";

/* ── small helpers ─────────────────────────────────────────────────── */

const statusLabel: Record<string, string> = {
  idle: "idle",
  running: "running",
  interrupted: "awaiting input",
  done: "finished",
  error: "error",
  stopped: "stopped",
};

function categoryOf(type: string) {
  if (type.startsWith("RUN_") || type.startsWith("STEP_")) return "lifecycle";
  if (type.startsWith("TEXT_MESSAGE")) return "text";
  if (type.startsWith("TOOL_CALL")) return "tool";
  if (type.startsWith("STATE_") || type === "MESSAGES_SNAPSHOT") return "state";
  if (type.startsWith("REASONING")) return "reasoning";
  return "special";
}

function eventPreview(event: Record<string, unknown>): string {
  const pick = (k: string) => (event[k] === undefined ? "" : String(event[k]));
  const truncated = (s: string, n = 64) => (s.length > n ? s.slice(0, n) + "…" : s);
  switch (event.type) {
    case "TEXT_MESSAGE_CONTENT":
    case "TOOL_CALL_ARGS":
    case "REASONING_MESSAGE_CONTENT":
      return JSON.stringify(pick("delta"));
    case "TOOL_CALL_START":
      return pick("toolCallName") + " · " + pick("toolCallId");
    case "TOOL_CALL_RESULT":
      return pick("toolCallId") + " → " + truncated(pick("content"), 44);
    case "STATE_DELTA": {
      const delta = (event.delta as { path: string }[]) || [];
      return delta.map((d) => d.path).join(", ");
    }
    case "RUN_FINISHED":
      return JSON.stringify((event.outcome as Record<string, unknown>) || {});
    case "CUSTOM":
      return pick("name");
    default:
      return truncated(JSON.stringify(event).replace(/^\{"type":"[^"]+",?/, ""), 70);
  }
}


/* ── page ─────────────────────────────────────────────────────────── */

export function AuroraPage() {
  const c = useConversation();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const brand = useSkinBranding();
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"events" | "state">("events");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [evLimit, setEvLimit] = useState(200);
  const [draft, setDraft] = useState("");
  const scroller = useStickToBottom<HTMLDivElement>();
  // Inspector event list pins to the newest event with the same contract as
  // the chat column: streaming appends no longer yank the reader back down
  // once they have scrolled up to inspect history.
  const eventList = useStickToBottom<HTMLDivElement>();
  const textarea = useRef<HTMLTextAreaElement>(null);

  const events = useMemo(
    () => (filter === "all" ? c.events : c.events.filter((e) => categoryOf(e.event.type) === filter)),
    [c.events.length, filter, c.getVersion()]
  );
  // Real streams can be thousands of events; render a bounded tail and let the
  // inspector opt into earlier history instead of mounting one JsonView per row.
  const visibleEvents = events.slice(-evLimit);
  const firstTs = Date.parse(String(c.events[0]?.event.timestamp ?? ""));
  const running = c.status === "running";
  const interrupt = pendingInterrupts(c.entries)[0];
  // Consecutive reasoning/tool blocks collapse into one glass fold block.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  return (
    <div className="skin-aurora relative h-full overflow-hidden bg-(--bg) text-(--text) [font-family:var(--font)] text-[14px] leading-[1.55] [-webkit-font-smoothing:antialiased]">
      <div className="bg absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="bg-orb bg-orb--mint absolute rounded-full blur-[100px] opacity-50 will-change-transform w-[620px] h-[620px] left-[-160px] top-[-220px] bg-[radial-gradient(circle,rgba(46,214,170,0.55),transparent_70%)] animate-[drift-a_26s_var(--ease)_infinite_alternate]" />
        <div className="bg-orb bg-orb--cyan absolute rounded-full blur-[100px] opacity-50 will-change-transform w-[560px] h-[560px] right-[-80px] top-[8%] bg-[radial-gradient(circle,rgba(56,160,255,0.4),transparent_70%)] animate-[drift-b_31s_var(--ease)_infinite_alternate]" />
        <div className="bg-orb bg-orb--violet absolute rounded-full blur-[100px] opacity-50 will-change-transform w-[720px] h-[720px] left-[32%] bottom-[-420px] bg-[radial-gradient(circle,rgba(139,108,255,0.4),transparent_70%)] animate-[drift-c_35s_var(--ease)_infinite_alternate]" />
        <div className="bg-grid absolute inset-[-10%] bg-[linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] bg-[length:64px_64px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,#000_0%,transparent_75%)] [-webkit-mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,#000_0%,transparent_75%)]" />
        <div className="bg-noise" />
        <div className="bg-vignette absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_0%,transparent_40%,rgba(3,4,6,0.75)_100%)]" />
      </div>

      <div className="app relative z-[1] flex h-full flex-col">
        <header className="topbar flex h-[58px] flex-none items-center gap-4 px-[18px]">
          <div className="brand flex items-center gap-[10px]">
            <div className="brand-mark relative grid h-[26px] w-[26px] place-items-center rounded-[9px] bg-[image:var(--accent-grad)] shadow-[0_0_0_1px_rgba(255,255,255,0.18)_inset,0_8px_24px_-8px_rgba(94,240,194,0.6)]"><span className="h-[10px] w-[10px] rounded-[4px] bg-[#04120d] shadow-[0_0_0_2px_rgba(255,255,255,0.85)_inset] rotate-[12deg]" /></div>
            <div className="brand-word flex items-baseline gap-[6px]">
              <span className="brand-name bg-[image:var(--accent-grad)] bg-[length:200%_100%] [background-clip:text] [-webkit-background-clip:text] text-transparent font-bold tracking-[-0.02em] text-[15px] animate-[shimmer_7s_linear_infinite] motion-reduce:animate-none">AG-UI</span>
              <span className="brand-sub text-[13px] text-(--text-2) font-[450]">Studio</span>
            </div>
            <span className="brand-version mono ml-[6px] text-[10px] text-(--text-3) rounded-full border border-(--border) px-2 py-[2px] bg-[rgba(255,255,255,0.02)] max-[820px]:hidden">protocol 1.0</span>
          </div>

          <div className="topbar-center flex flex-1 justify-center max-[820px]:hidden">
            <div className="conn flex items-center gap-[7px] text-[11.5px] text-(--text-2) rounded-full border border-(--border) bg-[rgba(255,255,255,0.025)] px-[12px] py-[5px]">
              <span className="conn-dot h-[6px] w-[6px] rounded-full bg-(--mint) shadow-[0_0_0_3px_rgba(94,240,194,0.14)] animate-[pulse-soft_2.6s_ease-in-out_infinite] motion-reduce:animate-none" />
              <span className="conn-label text-(--text) font-medium">SSE</span>
              <span className="conn-sep text-(--text-3)">·</span>
              <span className="conn-host mono text-[11px] text-(--text-3)">agent.local/run</span>
            </div>
          </div>

          <div className="topbar-actions flex items-center gap-2">
            <div className={`run-pill flex h-[30px] items-center gap-2 rounded-full border pl-[10px] pr-[12px] text-[11.5px] [transition:all_0.4s_var(--ease)] ${RUN_PILL[c.status] ?? RUN_PILL.idle}`} data-status={c.status}>
              <span className={`run-pill-dot h-[6px] w-[6px] rounded-full [transition:all_0.3s] ${RUN_PILL_DOT[c.status] ?? RUN_PILL_DOT.idle}`} />
              <span className={`run-pill-text font-medium lowercase ${RUN_PILL_TEXT[c.status] ?? RUN_PILL_TEXT.idle}`}>{t(("status." + c.status) as never)}{pendingInterrupts(c.entries).length > 1 ? ` ×${pendingInterrupts(c.entries).length}` : ""}</span>
              <span className="run-pill-meta mono text-[10.5px] text-(--text-3)">{c.status === "idle" ? "" : formatDuration(c.duration())}</span>
            </div>
            <div className="avatar grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-[linear-gradient(140deg,#8ef5d1,#5ac8ff)] text-[12px] font-semibold text-[#06110d] shadow-[0_0_0_1px_rgba(255,255,255,0.2)_inset]" title="noexcs">N</div>
          </div>
        </header>

        <div className="workspace grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_372px] gap-3 px-[14px] pb-[14px] max-[1240px]:grid-cols-[minmax(0,1fr)_330px] max-[1080px]:grid-cols-[minmax(0,1fr)] max-[820px]:grid-cols-[minmax(0,1fr)] max-[820px]:px-2 max-[820px]:pb-2">

          {/* chat */}
          <main className="panel chat relative min-h-0 flex flex-col overflow-hidden border border-(--border) rounded-(--r-lg) bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018)_40%,rgba(255,255,255,0.012))] shadow-(--shadow-panel) backdrop-blur-[24px] backdrop-saturate-[1.1] [-webkit-backdrop-filter:blur(24px)_saturate(1.1)]">
            <div className="chat-head flex flex-none items-center justify-between gap-[14px] border-b border-(--border) bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent)] px-[18px] py-[13px]">
              <div className="chat-id flex min-w-0 items-center gap-[12px]">
                <div className="agent-orb relative flex-none h-10 w-10 rounded-[13px] bg-[radial-gradient(circle_at_30%_25%,#b5ffe8,#4be0b4_45%,#1d8f7a)] shadow-[0_0_0_1px_rgba(255,255,255,0.18)_inset,0_4px_14px_-4px_rgba(94,240,194,0.7)]">
                  <span className="absolute inset-[-4px] rounded-[16px] border border-[rgba(94,240,194,0.4)] animate-[orb-pulse_2.6s_ease-out_infinite] motion-reduce:animate-none" />
                </div>
                <div className="chat-id-text min-w-0">
                  <div className="chat-title flex items-center gap-[6px] text-[14px] font-semibold tracking-[-0.01em]">
                    <span>{brand.agentName}</span>
                    <span className="verified grid h-[15px] w-[15px] place-items-center rounded-full bg-[rgba(94,240,194,0.18)] text-(--mint)"><Icon name="check" /></span>
                  </div>
                  <div className="chat-sub mono text-[10.5px] text-(--text-3) overflow-hidden whitespace-nowrap text-ellipsis">{brand.modelLabel} · {c.threadId} · {c.runId}</div>
                </div>
              </div>
              <div className="chat-caps flex flex-wrap items-center justify-end gap-[6px] max-[1240px]:max-w-[190px] max-[820px]:hidden">
                {c.capabilities?.tools?.supported && (
                  <span className={`cap inline-flex h-6 items-center gap-[5px] rounded-lg border px-[9px] text-[10.5px] ${CAP_NORMAL}`}><Icon name="wrench" />{t("chat.tools")} <b className="font-semibold text-(--text)">{c.capabilities.tools.items?.length ?? 0}</b></span>
                )}
                {c.capabilities?.reasoning?.supported && <span className={`cap inline-flex h-6 items-center gap-[5px] rounded-lg border px-[9px] text-[10.5px] ${CAP_NORMAL}`}><Icon name="brain" />{t("chat.reasoning")}</span>}
                {c.capabilities?.state?.supported && <span className={`cap inline-flex h-6 items-center gap-[5px] rounded-lg border px-[9px] text-[10.5px] ${CAP_NORMAL}`}><Icon name="layers" />{t("chat.state")}</span>}
                {c.capabilities?.humanInTheLoop?.supported && (
                  <span className={`cap cap--hitl inline-flex h-6 items-center gap-[5px] rounded-lg border px-[9px] text-[10.5px] ${CAP_HITL}`}><Icon name="shield" />{t("chat.interrupts")}</span>
                )}
              </div>
            </div>

            <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-[30px] pt-5 pb-[6px]" ref={scroller}>
              {c.entries.length === 0 && (
                <div className={`${BLOCK} mb-4`} style={{ opacity: 0.6, textAlign: "center", paddingTop: 40 }}>
                  <span className="mono" style={{ fontSize: 11 }}>{t("aurora.waiting")}</span>
                </div>
              )}

              {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
              {foldItems.map((item) => {
                if (item.type === "entry") {
                  return (
                    <EntryView
                      key={item.entry.id}
                      entry={item.entry}
                      open={!!openReasoning[item.entry.id]}
                      onToggleReasoning={() => setOpenReasoning((prev) => ({ ...prev, [item.entry.id]: !prev[item.entry.id] }))}
                      interrupt={item.entry.kind === "interrupt" ? interrupt : undefined}
                      onApprove={(editedArgs) => c.resolveInterrupt(true, editedArgs, item.entry.id)}
                      onDeny={() => c.resolveInterrupt(false, undefined, item.entry.id)}
                    />
                  );
                }
                const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
                return (
                  <FoldGroupBlock
                    key={item.id}
                    groupId={item.id}
                    entries={item.entries}
                    open={open}
                    onToggle={() => setFoldOverride((prev) => ({ ...prev, [item.id]: !open }))}
                    openReasoning={openReasoning}
                    setOpenReasoning={setOpenReasoning}
                    onApprove={(editedArgs, entryId) => c.resolveInterrupt(true, editedArgs, entryId)}
                    onDeny={(entryId) => c.resolveInterrupt(false, undefined, entryId)}
                  />
                );
              })}

              {(c.status === "done" || c.status === "stopped") && c.entries.length > 2 && (
                <RunSummary />
              )}
            </div>

            <div className="composer-wrap relative flex-none px-[22px] pb-[12px] max-[820px]:px-[10px] max-[820px]:pb-[10px] before:pointer-events-none before:absolute before:inset-x-0 before:-top-[28px] before:bottom-0 before:content-[''] before:bg-[linear-gradient(180deg,transparent,rgba(6,7,10,0.85)_60%)]">
              {c.suggestions.length > 0 && (
                <div className="suggestions relative mx-auto mb-[9px] flex max-w-[812px] flex-wrap gap-[7px]">
                  {c.suggestions.map((text) => (
                    <button key={text} className="suggestion inline-flex items-center gap-[6px] rounded-full border border-(--border) bg-[rgba(255,255,255,0.035)] px-[12px] py-[7px] text-[11.5px] text-(--text-2) [transition:all_0.25s_var(--ease)] hover:text-[#fff] hover:border-[rgba(94,240,194,0.35)] hover:bg-[rgba(94,240,194,0.09)] hover:-translate-y-px" onClick={() => { setDraft(text); textarea.current?.focus(); }}>
                      <Icon name="sparkle" />
                      <span>{text}</span>
                    </button>
                  ))}
                </div>
              )}

              <form
                className="group relative mx-auto max-w-[812px] overflow-hidden rounded-[18px] border border-(--border) bg-[linear-gradient(180deg,rgba(20,23,31,0.94),rgba(12,14,20,0.96))] shadow-[0_24px_70px_-34px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.05)_inset] backdrop-blur-[20px] [transition:border-color_0.35s_var(--ease),box-shadow_0.35s_var(--ease),transform_0.35s_var(--ease)] focus-within:border-[rgba(94,240,194,0.3)] focus-within:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.95),0_0_0_4px_rgba(94,240,194,0.06)]"
                onSubmit={(e) => { e.preventDefault(); send(); }}
              >
                <div className="composer-glow pointer-events-none absolute inset-x-[-10%] top-[-40%] h-[130px] bg-[radial-gradient(ellipse_at_50%_100%,rgba(94,240,194,0.22),transparent_70%)] opacity-0 [transition:opacity_0.5s] group-focus-within:opacity-100" aria-hidden="true" />
                <textarea
                  ref={textarea}
                  rows={1}
                  value={draft}
                  aria-label={t("chat.placeholder")}
                  placeholder={t("chat.placeholder")}
                  className="[display:block] min-h-[26px] max-h-[168px] w-full resize-none border-0 bg-transparent px-4 pt-[14px] pb-[6px] text-[13.8px] leading-[1.6] text-(--text) placeholder:text-(--text-3)"
                  onChange={(e) => setDraft(e.target.value)}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 168) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                    if (e.key === "Escape") c.stop();
                  }}
                />
                <div className="composer-bar flex items-center justify-between pl-[11px] pr-[9px] pt-[6px] pb-[9px]">
                  <div className="composer-tools flex items-center gap-[2px]">
                    <button type="button" className="tool-btn inline-flex h-[27px] items-center gap-[6px] rounded-[7px] px-2 text-[11px] text-(--text-3) [transition:all_0.2s] hover:text-(--text) hover:bg-[rgba(255,255,255,0.055)]" aria-label="Attach"><Icon name="paperclip" /></button>
                    <button type="button" className="tool-btn inline-flex h-[27px] items-center gap-[6px] rounded-[7px] px-2 text-[11px] text-(--text-3) [transition:all_0.2s] hover:text-(--text) hover:bg-[rgba(255,255,255,0.055)]"><Icon name="wrench" /><span>{t("chat.tools")}</span></button>
                    <button type="button" className="tool-btn inline-flex h-[27px] items-center gap-[6px] rounded-[7px] px-2 text-[11px] text-(--text-3) [transition:all_0.2s] hover:text-(--text) hover:bg-[rgba(255,255,255,0.055)]"><Icon name="command" /><span>{t("chat.commands")}</span></button>
                  </div>
                  <div className="composer-right flex items-center gap-[9px]">
                    <span className="model-chip mono rounded-[7px] border border-(--border) bg-[rgba(255,255,255,0.025)] px-2 py-[4px] text-[10px] text-(--text-2)">{brand.modelLabel}</span>
                    {running ? (
                      <button type="button" className={`send ${SEND}`} onClick={() => c.stop()} aria-label="Stop"> <Icon name="stop" /></button>
                    ) : (
                      <button type="submit" className={`send ${SEND}`} disabled={!draft.trim()} aria-label="Send"><Icon name="send" /></button>
                    )}
                  </div>
                </div>
              </form>

              <div className="composer-hint mx-auto mt-[7px] flex max-w-[812px] justify-between px-1 text-[10px] text-(--text-3)">
                <span><kbd className="kbd [font-family:var(--mono)] rounded-[5px] border border-current px-[3px] text-[9px] leading-[1.3] text-inherit opacity-62">⏎</kbd> send · <kbd className="kbd [font-family:var(--mono)] rounded-[5px] border border-current px-[3px] text-[9px] leading-[1.3] text-inherit opacity-62">⇧⏎</kbd> newline · <kbd className="kbd [font-family:var(--mono)] rounded-[5px] border border-current px-[3px] text-[9px] leading-[1.3] text-inherit opacity-62">esc</kbd> stop</span>
                <span className="hint-right mono">events stream over SSE</span>
              </div>
            </div>
          </main>

          {/* inspector */}
          <aside className="panel inspector relative min-h-0 flex flex-col overflow-hidden border border-(--border) rounded-(--r-lg) bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018)_40%,rgba(255,255,255,0.012))] shadow-(--shadow-panel) backdrop-blur-[24px] backdrop-saturate-[1.1] [-webkit-backdrop-filter:blur(24px)_saturate(1.1)] max-[1080px]:hidden">
            <RadixTabs.Root className="insp-root flex h-full min-h-0 flex-col" value={tab} onValueChange={(value) => setTab(value as "events" | "state")}>
            <div className="insp-head flex flex-none items-center gap-2 border-b border-(--border) px-[12px] py-[10px]">
              <RadixTabs.List className="tabs flex flex-1 gap-[2px] rounded-[10px] border border-(--border) bg-[rgba(0,0,0,0.3)] p-[3px]" aria-label="Inspector">
                <RadixTabs.Trigger className={`tab inline-flex h-[26px] flex-1 items-center justify-center gap-[6px] rounded-[7px] text-[11.5px] [transition:all_0.25s_var(--ease)] ${tab === "events" ? TAB_ACTIVE : TAB_IDLE}`} value="events">
                  {t("chat.eventsTab")}<span className={`tab-count mono inline-flex h-[14px] items-center rounded-[4px] px-1 text-[9px] ${tab === "events" ? TAB_COUNT_ACTIVE : TAB_COUNT_IDLE}`}>{c.events.length}</span>
                </RadixTabs.Trigger>
                <RadixTabs.Trigger className={`tab inline-flex h-[26px] flex-1 items-center justify-center gap-[6px] rounded-[7px] text-[11.5px] [transition:all_0.25s_var(--ease)] ${tab === "state" ? TAB_ACTIVE : TAB_IDLE}`} value="state">
                  {t("chat.stateTab")}<span className={`tab-count mono inline-flex h-[14px] items-center rounded-[4px] px-1 text-[9px] ${tab === "state" ? TAB_COUNT_ACTIVE : TAB_COUNT_IDLE}`}>v{c.stateVersion}</span>
                </RadixTabs.Trigger>
              </RadixTabs.List>
              <button className="icon-btn icon-btn--sm grid h-[26px] w-[26px] place-items-center rounded-lg text-(--text-2) border border-transparent [transition:all_0.25s_var(--ease)] hover:text-(--text) hover:bg-[rgba(255,255,255,0.055)] hover:border-(--border)" title="Clear log" onClick={() => { setSelected(null); }}><Icon name="x" /></button>
            </div>

            {Object.keys(c.metadata ?? {}).length > 0 && (
              <div className="insp-meta flex flex-wrap items-center gap-[6px] border-b border-(--border) px-[14px] py-2" title={JSON.stringify(c.metadata, null, 2)}>
                <span className="insp-meta-k mono text-[9px] tracking-[0.12em] text-(--text-3)">META</span>
                {Object.entries(c.metadata ?? {}).slice(0, 4).map(([key, value]) => (
                  <span key={key} className="insp-meta-chip mono rounded-full border border-(--border-2) bg-[rgba(255,255,255,0.03)] px-[7px] py-[2px] text-[9.5px] text-(--text-2)">
                    {key}={typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </span>
                ))}
              </div>
            )}

            <RadixTabs.Content className="insp-pane flex min-h-0 flex-1 flex-col [&[data-state=inactive]]:hidden" value="events">
                <div className="ev-filters flex flex-none flex-wrap gap-1 px-[10px] pt-[9px] pb-[7px]">
                  {[
                    ["all", t("filter.all")],
                    ["lifecycle", t("filter.lifecycle")],
                    ["text", t("filter.text")],
                    ["tool", t("filter.tool")],
                    ["state", t("filter.state")],
                    ["reasoning", t("filter.reasoning")],
                    ["special", t("filter.special")],
                  ].map(([id, label]) => (
                    <button key={id} className={`filter inline-flex h-[22px] items-center gap-[5px] rounded-md border px-2 text-[10px] [transition:all_0.2s] ${filter === id ? "border-(--border) bg-[rgba(255,255,255,0.055)] text-(--text)" : "border-transparent text-(--text-3) hover:text-(--text-2) hover:bg-[rgba(255,255,255,0.045)]"}`} onClick={() => { setFilter(id); setEvLimit(200); }}>
                      {id !== "all" && <i className={`fdot inline-block h-[5px] w-[5px] rounded-full ${FDOT[id.slice(0, 4)] ?? ""}`} />}
                      {label}
                    </button>
                  ))}
                </div>

                <div className="ev-list min-h-0 flex-1 overflow-y-auto px-2 pt-[2px] pb-2" ref={eventList}>
                  {events.length > visibleEvents.length && (
                    <button
                      type="button"
                      className="ev-more my-2.5 mx-auto"
                      onClick={() => setEvLimit((limit) => limit + 200)}
                    >
                      {t("history.more")} · {events.length - visibleEvents.length}
                    </button>
                  )}
                  {visibleEvents.map(({ seq, event }) => {
                    const cat = categoryOf(event.type);
                    const evTs = Date.parse(String(event.timestamp ?? ""));
                    const offset = isFinite(firstTs) && isFinite(evTs) ? "+" + ((evTs - firstTs) / 1000).toFixed(2) + "s" : "";
                    const toggle = () => setSelected(selected === seq ? null : seq);
                    return (
                      <div
                        key={seq}
                        role="button"
                        tabIndex={0}
                        aria-expanded={selected === seq}
                        className={`ev-row group relative mb-[2px] flex cursor-pointer items-start gap-2 rounded-lg border px-[9px] pt-[6px] pb-[6px] pl-[10px] before:pointer-events-none before:absolute before:left-[2px] before:top-[7px] before:bottom-[7px] before:w-[2px] before:rounded-[2px] before:bg-[var(--cat,var(--text-3))] before:opacity-80 before:content-[''] focus-visible:border-(--border) focus-visible:bg-[rgba(255,255,255,0.04)] [transition:background_0.18s,border-color_0.18s] animate-[ev-in_0.35s_var(--ease)_both] ${CAT[cat] ?? ""} ${selected === seq ? "is-selected border-(--border-2) bg-[rgba(255,255,255,0.05)]" : "border-transparent hover:border-(--border) hover:bg-[rgba(255,255,255,0.04)]"}`}
                        data-cat={cat}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                      >
                        <div className="ev-main min-w-0 flex-1">
                          <div className="ev-top flex items-center gap-[6px]">
                            <span className="ev-type overflow-hidden whitespace-nowrap text-ellipsis [font-family:var(--mono)] text-[10px] font-medium tracking-[-0.02em] text-(--text) group-focus-visible:text-[#fff]">{event.type}</span>
                            <span className="ev-time ml-auto flex-none [font-family:var(--mono)] text-[8.5px] text-(--text-3)">{offset}</span>
                          </div>
                          <div className="ev-preview mt-px overflow-hidden whitespace-nowrap text-ellipsis [font-family:var(--mono)] text-[9.5px] text-(--text-3)">{eventPreview(event as Record<string, unknown>)}</div>
                          {selected === seq && (
                            <div className="ev-json mt-[7px] overflow-auto whitespace-pre rounded-[7px] border border-(--border) bg-[rgba(0,0,0,0.42)] px-[9px] py-2 [font-family:var(--mono)] text-[9.5px] leading-[1.55] text-[#b9c6d8] max-h-[240px] animate-[fade_0.2s]">
                              <JsonView data={event as Record<string, unknown>} style={darkStyles} shouldExpandNode={(level) => level < 3} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="insp-foot flex flex-none items-center justify-between border-t border-(--border) px-[12px] py-2 text-[9px] text-(--text-3)">
                  <span className="mono">
                    {events.length} events{events.length > visibleEvents.length ? ` · ${visibleEvents.length} shown` : ""}
                  </span>
                  <span className="mono">mock SSE · {c.tokens || 0} tokens</span>
                </div>
            </RadixTabs.Content>

            <RadixTabs.Content className="insp-pane flex min-h-0 flex-1 flex-col [&[data-state=inactive]]:hidden" value="state">
                <div className="state-head flex flex-none items-center justify-between px-[13px] pt-[12px] pb-[9px]">
                  <div>
                    <div className="state-title text-[12px] font-semibold text-(--text)">Shared state</div>
                    <div className="state-sub mono mt-px text-[9px] text-(--text-3)">STATE_SNAPSHOT + JSON Patch</div>
                  </div>
                  <span className="state-version mono rounded-full border border-[rgba(167,139,250,0.24)] bg-[rgba(167,139,250,0.12)] px-[7px] py-[2px] text-[9px] text-[var(--accent-text,var(--violet))]">v{c.stateVersion}</span>
                </div>
                <div className="state-tree min-h-0 flex-1 overflow-auto px-[10px] pt-[2px] pb-[12px] [font-family:var(--mono)] text-[10.5px] leading-[1.75]">
                  {isEmptyState(c.sharedState) ? (
                    <div className="state-empty px-[14px] py-[22px] text-center text-[11px] text-(--text-3)">
                      <Icon name="braces" />
                      No snapshot yet
                    </div>
                  ) : (
                    <StateNode name="thread" value={c.sharedState} pointer="" touched={c.touchedPaths} />
                  )}
                </div>
                <div className="insp-foot flex flex-none items-center justify-between border-t border-(--border) px-[12px] py-2 text-[9px] text-(--text-3)">
                  <span className="mono">{c.stateVersion} versions</span>
                  <span className="mono">{c.touchedPaths.join(" ") || "—"}</span>
                </div>
            </RadixTabs.Content>
            </RadixTabs.Root>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ── entries ──────────────────────────────────────────────────────── */

/**
 * One glass fold block standing in for a run of consecutive thinking/tool
 * blocks; the original EntryView rendering mounts inside when unfolded.
 * Failures surface on the header so a collapsed group cannot hide them.
 */
function FoldGroupBlock(props: {
  groupId: string;
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
  openReasoning: Record<string, boolean>;
  setOpenReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onApprove: (editedArgs: Record<string, unknown> | undefined, entryId: string) => void;
  onDeny: (entryId: string) => void;
}) {
  const { entries, open, onToggle } = props;
  const stats = foldGroupStats(entries);
  const failures = foldGroupFailures(entries);
  const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
  const preview = stats.toolNames.slice(0, 3).join(", ");
  const extra = stats.toolNames.length - 3;
  return (
    <>
      <div className={`${BLOCK} mb-4`}>
        <div className={`reason reason--fold mb-[12px] mt-[2px] overflow-hidden rounded-[12px] border border-dashed border-(--border) bg-[linear-gradient(180deg,rgba(90,200,255,0.06),rgba(90,200,255,0.015))] ${open ? "is-open" : ""}`} data-fold-id={props.groupId}>
          <button
            className="reason-toggle flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-[11px] py-2 text-left text-[11.5px] text-(--text-2) hover:text-(--text)"
            data-fold-head=""
            aria-expanded={open}
            onClick={onToggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle();
              }
            }}
          >
            <Icon name="layers" className="icon-brain h-[13px] w-[13px] text-(--cyan)" />
            <span className="reason-dot h-[5px] w-[5px] rounded-full bg-(--violet) shadow-[0_0_8px_var(--violet)] opacity-50" />
            <span className="reason-label font-medium text-(--text-2)">{t("fold.group")}</span>
            <span className="reason-meta mono text-[10.5px] text-(--text-3)">
              {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
              {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
              {preview}
              {extra > 0 && ` +${extra} ${t("fold.more")}`}
            </span>
            {failure ? (
              <span className={`fold-flag fold-flag--${failure} flex-none rounded-full px-2 py-px text-[9.5px] ${FOLD_FLAG[failure]}`}>
                {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
              </span>
            ) : foldGroupOpen(entries) ? (
              <span className={`fold-flag fold-flag--live flex-none rounded-full px-2 py-px text-[9.5px] ${FOLD_FLAG.live}`}>{t("chat.executing")}</span>
            ) : null}
            <Icon name="chevron" className={`chev ml-auto h-[12px] w-[12px] text-(--text-3) ${open ? "rotate-90" : ""}`} />
          </button>
        </div>
      </div>
      {open &&
        entries.map((entry) => (
          <EntryView
            key={entry.id}
            entry={entry}
            open={!!props.openReasoning[entry.id]}
            onToggleReasoning={() =>
              props.setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))
            }
            onApprove={(editedArgs) => props.onApprove(editedArgs, entry.id)}
            onDeny={() => props.onDeny(entry.id)}
          />
        ))}
    </>
  );
}

function EntryView(props: {
  entry: Entry;
  open: boolean;
  onToggleReasoning: () => void;
  interrupt?: InterruptEntry;
  onApprove: (editedArgs?: Record<string, unknown>) => void;
  onDeny: () => void;
}) {
  const { entry } = props;

  if (entry.kind === "user") {
    return (
      <div className={`${BLOCK} block--user flex justify-end mb-[22px]`}>
        <div className="msg-user max-w-[76%] rounded-[16px_16px_5px_16px] bg-[linear-gradient(135deg,rgba(94,240,194,0.16),rgba(90,200,255,0.1))] border border-[rgba(94,240,194,0.2)] shadow-[0_18px_40px_-28px_rgba(94,240,194,0.55)] px-[15px] py-[11px] text-[13.5px] leading-[1.6] text-[#eefbf7]">
          <div className="msg-user-name mono mb-1 flex items-center gap-[6px] text-[10px] text-[rgba(255,255,255,0.45)] uppercase">YOU · {timeOf(entry.at)}</div>
          {entry.text}
        </div>
      </div>
    );
  }

  if (entry.kind === "reasoning") return <ReasoningBlock entry={entry} open={props.open} onToggle={props.onToggleReasoning} />;
  if (entry.kind === "tool") return <ToolBlock entry={entry} />;
  if (entry.kind === "plan") return <PlanBlock entry={entry} />;
  if (entry.kind === "interrupt") {
    return (
      <InterruptBlock
        entry={entry}
        live={props.interrupt?.id === entry.id}
        onApprove={props.onApprove}
        onDeny={props.onDeny}
      />
    );
  }
  if (entry.kind === "error") {
    return (
      <div className={`${BLOCK} mb-4`}>
        <div className={`tool mb-[14px] overflow-hidden rounded-[14px] shadow-[0_24px_48px_-40px_rgba(90,200,255,0.6)] border [transition:border-color_0.4s] ${TOOL_BOX.error}`} data-status="error" style={{ padding: 12 }}>
          <span className="mono" style={{ color: "var(--rose)", fontSize: 12 }}>RUN_ERROR · {entry.message}</span>
        </div>
      </div>
    );
  }
  if (entry.kind === "subagent") return <SubagentRow entry={entry} />;
  if (entry.kind === "step") return <StepRow entry={entry} />;
  if (entry.kind === "custom") return <CustomRow entry={entry} />;
  if (entry.kind === "assistant") return <AssistantBlock entry={entry} />;
  // forward-compatible: unknown entry kinds are ignored, never mis-rendered
  return null;
}

function AssistantBlock({ entry }: { entry: AssistantEntry }) {
  const brand = useSkinBranding();
  const c = useConversation();
  return (
    <div className={`${BLOCK} block--agent group flex gap-[12px] mb-4`}>
      <div className="msg-avatar relative mt-px h-[26px] w-[26px] flex-none rounded-[9px] bg-[radial-gradient(circle_at_30%_25%,#b5ffe8,#4be0b4_45%,#1d8f7a)] shadow-[0_0_0_1px_rgba(255,255,255,0.16)_inset] after:content-[''] after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[0_0_18px_rgba(94,240,194,0.28)]" />
      <div className="msg-main min-w-0 flex-1">
        <div className="msg-meta mb-[5px] flex h-5 items-center gap-2">
          <span className="msg-author text-[12px] font-semibold text-(--text)">{brand.agentName}</span>
          <span className="msg-time text-[10px] text-(--text-3)">{timeOf(entry.at)}</span>
          {entry.streaming && <span className="msg-byline flex items-center gap-[5px] text-[10px] text-(--text-3)"><Icon name="activity" size={10} />{t("status.generating")}</span>}
        </div>
        {entry.text ? (
          <Markdown className={`prose text-[13.8px] leading-[1.68] text-[#d8deea] ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
        ) : (
          <div className="prose text-[13.8px] leading-[1.68] text-[#d8deea]"><span className="caret ml-[2px] inline-block h-[0.95em] w-[2px] rounded-[2px] bg-(--mint) align-[-0.12em] shadow-[0_0_8px_rgba(94,240,194,0.8)] animate-[blink_1.05s_steps(2)_infinite] motion-reduce:animate-none" /></div>
        )}
        {!entry.streaming && (
          <div className="msg-actions mt-[10px] flex gap-1 opacity-0 translate-y-[-2px] [transition:all_0.3s_var(--ease)] group-hover:opacity-100 group-hover:translate-y-0">
            <button className="msg-action inline-flex h-6 items-center gap-[5px] rounded-[7px] border border-transparent px-2 text-[10.5px] text-(--text-3) hover:text-(--text) hover:bg-[rgba(255,255,255,0.05)] hover:border-(--border)" onClick={() => navigator.clipboard?.writeText(entry.text)}>
              <Icon name="copy" />{t("chat.copy")}
            </button>
            <span className="msg-action mono inline-flex h-6 items-center gap-[5px] rounded-[7px] border border-transparent px-2 text-[10.5px] text-(--text-3)" style={{ opacity: 0.6 }}>{estimateTokens(entry.text)} tok</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ReasoningBlock({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  return (
    <div className={`${BLOCK} mb-4`}>
      <div className={`reason mb-[12px] mt-[2px] overflow-hidden rounded-[12px] border border-(--border) bg-[linear-gradient(180deg,rgba(167,139,250,0.07),rgba(167,139,250,0.02))] ${open ? "is-open" : ""} ${entry.streaming ? "is-streaming" : ""}`}>
        <button className="reason-toggle flex w-full items-center gap-2 px-[11px] py-2 text-[11.5px] text-(--text-2)" onClick={onToggle}>
          <Icon name="brain" className="icon-brain h-[13px] w-[13px] text-[var(--accent-text,var(--violet))]" />
          <span className={`reason-dot h-[5px] w-[5px] rounded-full bg-(--violet) shadow-[0_0_8px_var(--violet)] ${entry.streaming ? "animate-[pulse-soft_1.4s_ease-in-out_infinite] motion-reduce:animate-none" : "opacity-50"}`} />
          <span className="reason-label font-medium text-(--text-2)">{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
          <span className="reason-meta mono text-[10.5px] text-(--text-3)">
            {entry.streaming ? "…" : formatDuration(entry.durationMs ?? 0)}
          </span>
          <Icon name="chevron" className={`chev ml-auto h-[12px] w-[12px] text-(--text-3) [transition:transform_0.3s_var(--ease)] ${open ? "rotate-90" : ""}`} />
        </button>
        {open && (
          <div className="reason-body px-[12px] pb-[11px] animate-[fade_0.3s_var(--ease)]" data-skin-text="">
            <div className="reason-text whitespace-pre-wrap border-l border-[rgba(167,139,250,0.25)] pl-[10px] text-[12px] leading-[1.7] italic text-[rgba(154,164,182,0.92)]">
              {entry.text}
              {entry.streaming && <span className="caret ml-[2px] inline-block h-[0.95em] w-[2px] rounded-[2px] bg-(--mint) align-[-0.12em] shadow-[0_0_8px_rgba(94,240,194,0.8)] animate-[blink_1.05s_steps(2)_infinite] motion-reduce:animate-none" />}
            </div>
            <div className="reason-tokens mt-[7px] [font-family:var(--mono)] text-[9.5px] text-(--text-3)">
              REASONING_MESSAGE_CONTENT · ~{entry.tokens} tokens
              {entry.encryptedValue && <span> · encrypted</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBlock({ entry }: { entry: ToolEntry }) {
  const name = displayText(entry.name);
  const dot = name.lastIndexOf(".");
  const ns = dot > -1 ? name.slice(0, dot + 1) : "";
  const shortName = dot > -1 ? name.slice(dot + 1) : name;

  return (
    <div className={`${BLOCK} mb-4`}>
      <div className={`tool mb-[14px] overflow-hidden rounded-[14px] shadow-[0_24px_48px_-40px_rgba(90,200,255,0.6)] border [transition:border-color_0.4s] ${TOOL_BOX[entry.status] ?? TOOL_BOX.base}`} data-status={entry.status}>
        <div className="tool-head flex items-center gap-[9px] pl-[10px] pr-[12px] py-[9px]">
          <div className={`tool-icon grid h-[26px] w-[26px] flex-none place-items-center rounded-lg border ${TOOL_ICON[entry.status] ?? TOOL_ICON.base}`}><Icon name="wrench" /></div>
          <span className="tool-name [font-family:var(--mono)] text-[11.5px] font-medium text-[#dcefff]"><span className="text-(--text-3)">{ns}</span>{shortName}</span>
          <div className="tool-meta ml-auto flex items-center gap-2 text-[10px] text-(--text-3)">
            <span className="mono">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
            <span className={`tool-status inline-flex items-center gap-[5px] rounded-full border px-[7px] py-[2px] text-[10px] ${TOOL_PILL[entry.status] ?? TOOL_PILL.base}`}>
              {entry.status === "args" && <><span className="h-2 w-2 rounded-full border-[1.5px] border-[rgba(90,200,255,0.3)] border-t-(--cyan) animate-[spin_0.8s_linear_infinite] motion-reduce:animate-none" />{t("chat.streamingArgs")}</>}
              {entry.status === "executing" && <><span className="h-2 w-2 rounded-full border-[1.5px] border-[rgba(90,200,255,0.3)] border-t-(--cyan) animate-[spin_0.8s_linear_infinite] motion-reduce:animate-none" />{t("chat.executing")}</>}
              {entry.status === "interrupted" && <><Icon name="pause" />{t("chat.interrupted")}</>}
              {entry.status === "done" && <><Icon name="check" />{t("chat.done")}</>}
              {entry.status === "error" && <><Icon name="x" />{t("chat.failed")}</>}
            </span>
          </div>
        </div>
        <div className="tool-body px-[12px] pb-[10px]">
          {entry.argsRaw && <div className="tool-args max-h-[148px] overflow-auto whitespace-pre-wrap break-words rounded-[9px] border border-[rgba(255,255,255,0.05)] bg-[rgba(0,0,0,0.3)] px-[10px] py-2 [font-family:var(--mono)] text-[11px] leading-[1.62] text-[#a9b8cc]" data-skin-text="">{safeJson(entry.args ?? entry.argsRaw, 2)}</div>}
          <ToolResult entry={entry} variant="aurora" />
        </div>
      </div>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  return (
    <div className={`${BLOCK} mb-4`}>
      <div className="reason mb-[12px] mt-[2px] overflow-hidden rounded-[12px] border border-(--border) bg-[linear-gradient(180deg,rgba(167,139,250,0.07),rgba(167,139,250,0.02))]">
        <div className="reason-toggle flex items-center gap-2 px-[11px] py-2 text-[11.5px] text-(--text-2)">
          <Icon name="layers" className="icon-brain h-[13px] w-[13px] text-[var(--accent-text,var(--violet))]" />
          <span className="reason-label font-medium text-(--text-2)">{displayText(entry.name)}</span>
          <span className="reason-meta mono text-[10.5px] text-(--text-3)">{entry.status}</span>
        </div>
        {entry.detail && <div className="reason-body hidden px-[12px] pb-[11px]" data-skin-text="">{entry.detail}</div>}
      </div>
    </div>
  );
}

function StepRow({ entry }: { entry: StepEntry }) {
  return (
    <div className={`${BLOCK} mb-4`}>
      <div className="reason mb-[12px] mt-[2px] overflow-hidden rounded-[12px] border border-(--border) bg-[linear-gradient(180deg,rgba(167,139,250,0.07),rgba(167,139,250,0.02))]">
        <div className="reason-toggle flex items-center gap-2 px-[11px] py-2 text-[11.5px] text-(--text-2)">
          <Icon name="activity" className="icon-brain h-[13px] w-[13px] text-[var(--accent-text,var(--violet))]" />
          <span className="reason-label font-medium text-(--text-2)">{displayText(entry.name)}</span>
          <span className="reason-meta mono text-[10.5px] text-(--text-3)">{entry.status}</span>
        </div>
      </div>
    </div>
  );
}

function CustomRow({ entry }: { entry: CustomEntry }) {
  const plugins = useSkinPlugins();
  const custom = plugins.custom?.(entry);
  if (custom !== undefined) return <>{custom}</>;
  return (
    <div className={`${BLOCK} mb-4`}>
      <div className="reason mb-[12px] mt-[2px] overflow-hidden rounded-[12px] border border-(--border) bg-[linear-gradient(180deg,rgba(167,139,250,0.07),rgba(167,139,250,0.02))]">
        <div className="reason-toggle flex items-center gap-2 px-[11px] py-2 text-[11.5px] text-(--text-2)">
          <Icon name="braces" className="icon-brain h-[13px] w-[13px] text-[var(--accent-text,var(--violet))]" />
          <span className="reason-label font-medium text-(--text-2)">{displayText(entry.name)}</span>
          <span className="reason-meta mono text-[10.5px] text-(--text-3)">{safeJson(entry.value, 0)}</span>
        </div>
      </div>
    </div>
  );
}

function PlanBlock({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  const done = view.steps.filter((s) => s.state === "done").length;
  const pct = view.steps.length ? Math.round((done / view.steps.length) * 100) : 0;
  return (
    <div className={`${BLOCK} mb-4`}>
      <div className="plan mb-[14px] rounded-[14px] border border-(--border) bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] px-[13px] py-[12px]">
        <div className="plan-head mb-[9px] flex items-center gap-2">
          <span className="plan-icon grid h-[18px] w-[18px] place-items-center rounded-md border border-[rgba(167,139,250,0.22)] bg-[rgba(167,139,250,0.14)] text-[var(--accent-text,var(--violet))]"><Icon name="activity" /></span>
          <span className="plan-title text-[11.5px] font-semibold tracking-[0.01em] text-(--text)">{displayText(entry.title)}</span>
          <span className="plan-tag ml-auto rounded-full border border-(--border) px-[6px] py-px [font-family:var(--mono)] text-[9px] text-(--text-3)">ACTIVITY · {displayText(entry.activityType)}</span>
        </div>
        {view.rawOnly ? (
          <pre className="tool-args max-h-[148px] overflow-auto whitespace-pre-wrap break-words rounded-[9px] border border-[rgba(255,255,255,0.05)] bg-[rgba(0,0,0,0.3)] px-[10px] py-2 [font-family:var(--mono)] text-[11px] leading-[1.62] text-[#a9b8cc]" data-skin-text="">{planRawText(view)}</pre>
        ) : (
        <div className="plan-steps flex flex-col gap-px">
          {view.steps.map((step) => (
            <div key={step.id} className={`flex items-center gap-[9px] px-[2px] py-[5px] text-[12px] [transition:color_0.3s] ${PLAN_STEP_COLOR[step.state] ?? "text-(--text-2)"}`} data-state={step.state}>
              <span className={`plan-check grid h-[15px] w-[15px] flex-none place-items-center rounded-[5px] border [transition:all_0.35s_var(--ease)] ${PLAN_CHECK[step.state] ?? "border-(--border-2)"}`}>{step.state === "done" && <Icon name="check" />}</span>
              <span className="plan-step-label flex-1">{step.label}</span>
              {step.state === "active" && <span className="plan-step-time mono text-[9.5px] text-(--text-3)">{t("chat.executing")}</span>}
            </div>
          ))}
        </div>
        )}
        <div className="plan-bar mt-[9px] h-[2px] overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]"><span className="[display:block] h-full rounded-[inherit] bg-[image:var(--accent-grad)] [transition:width_0.7s_var(--ease)]" style={{ width: pct + "%" }} /></div>
      </div>
    </div>
  );
}

function InterruptBlock(props: {
  entry: InterruptEntry;
  live: boolean;
  onApprove: (editedArgs?: Record<string, unknown>) => void;
  onDeny: () => void;
}) {
  const c = useConversation();
  const { entry, live } = props;
  const pending = entry.status === "pending";
  const variant = pending ? "pending" : entry.expired ? "expired" : "resolved";
  // Draft state is per interrupt: with several pending cards each card must
  // keep its own editor, its own input and its own submitted args.
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState("");

  function openEdit() {
    const tool = c.entries.find((e): e is ToolEntry => e.kind === "tool" && e.id === entry.toolCallId);
    setEditJson(JSON.stringify(tool?.args ?? {}, null, 2));
    setEditing(true);
  }

  function approve() {
    if (editing) {
      try {
        props.onApprove(JSON.parse(editJson));
      } catch {
        setEditing(false);
        props.onApprove(undefined);
        return;
      }
    } else {
      props.onApprove(undefined);
    }
    setEditing(false);
  }

  return (
    <div className={`${BLOCK} mb-4`}>
      <div className={`interrupt relative mb-[14px] overflow-hidden rounded-[15px] border p-[14px] before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[''] ${INTERRUPT_BOX[variant]}`}>
        <div className="interrupt-head mb-[6px] flex items-center gap-[9px]">
          <span className={`interrupt-icon grid h-6 w-6 place-items-center rounded-lg border ${INTERRUPT_ICON[variant]}`}><Icon name={pending ? "shield" : entry.expired ? "clock" : "check"} /></span>
          <span className={`interrupt-kicker text-[10px] font-semibold uppercase tracking-[0.08em] ${INTERRUPT_KICKER[variant]}`}>{pending ? t("intr.paused") : t("intr.resolved")}</span>
          <span className="interrupt-time ml-auto [font-family:var(--mono)] text-[9.5px] text-(--text-3)">{timeOf(entry.at)}</span>
        </div>
        <div className="interrupt-title mb-[3px] text-[13.5px] font-semibold tracking-[-0.01em] text-[#fff]">{entry.message}</div>
        {entry.description && <div className="interrupt-desc max-w-[62ch] text-[12px] leading-[1.55] text-(--text-2)">{entry.description}</div>}

        {entry.details.length > 0 && (
          <div className="mt-[10px] grid grid-cols-3 gap-[10px] rounded-[9px] border border-[rgba(255,255,255,0.055)] bg-[rgba(0,0,0,0.28)] px-[11px] py-[9px]">
            {entry.details.map((d) => (
              <div key={d.label} className="flex flex-col gap-[2px]">
                <span className="text-[9.5px] uppercase tracking-[0.06em] text-(--text-3)">{d.label}</span>
                <span className="text-[12px] text-(--text)">{d.value}</span>
              </div>
            ))}
          </div>
        )}

        {pending && (
          <>
            <div className="interrupt-actions mt-[12px] flex items-center gap-2">
              <button className={`btn btn--approve ${BTN_BASE} ${BTN_KIND.approve}`} onClick={approve}><Icon name="check" />{t("intr.approve")}</button>
              <button className={`btn btn--deny ${BTN_BASE} ${BTN_KIND.deny}`} onClick={props.onDeny}><Icon name="x" />{t("intr.deny")}</button>
              <button className={`btn btn--ghost ${BTN_BASE} ${BTN_KIND.ghost}`} onClick={openEdit}>{t("intr.edit")}</button>
              <span className="interrupt-hint ml-auto [font-family:var(--mono)] text-[9.5px] text-(--text-3)">resume[0].payload</span>
            </div>
            {editing && (
              <div className="interrupt-edit mt-[10px] animate-[fade_0.25s]">
                <textarea value={editJson} onChange={(e) => setEditJson(e.target.value)} spellCheck={false} className="w-full min-h-[70px] resize-y rounded-[9px] border border-[rgba(255,196,107,0.25)] bg-[rgba(0,0,0,0.35)] px-[10px] py-2 [font-family:var(--mono)] text-[11px] leading-[1.6] text-[#ffe6c2] focus:border-[rgba(255,196,107,0.5)]" />
                <div className="interrupt-actions mt-[12px] flex items-center gap-2">
                  <button className={`btn btn--approve ${BTN_BASE} ${BTN_KIND.approve}`} onClick={approve}>{t("intr.approveEdited")}</button>
                  <button className={`btn btn--ghost ${BTN_BASE} ${BTN_KIND.ghost}`} onClick={() => setEditing(false)}>{t("intr.cancel")}</button>
                </div>
              </div>
            )}
          </>
        )}

        {!pending && (
          <div className={`resolved-row mt-[10px] flex items-center gap-[7px] text-[11.5px] ${variant === "expired" ? "text-(--text-2)" : "text-(--mint)"}`}>
            <Icon name={entry.expired ? "clock" : "check"} />
            <span>{entry.status === "approved" ? t("intr.approvedBy") : entry.expired ? t("intr.expired") : t("intr.deniedBy")}</span>
            <time className="ml-auto [font-family:var(--mono)] text-[9.5px] text-(--text-3)">{timeOf(entry.resolvedAt)}</time>
          </div>
        )}
      </div>
    </div>
  );
}

function RunSummary() {
  const c = useConversation();
  const counts = c.events.reduce<Record<string, number>>((acc, { event }) => {
    const cat = categoryOf(event.type);
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="summary mb-5 mt-1 flex items-center gap-[10px] px-[2px]">
      <div className="summary-line h-px flex-1 bg-[linear-gradient(90deg,transparent,var(--border),transparent)]" />
      <div className="summary-body flex items-center gap-2 text-[10.5px] text-(--text-3)">
        <Icon name="check" />
        <span>{t("chat.endOfRun")}</span>
        <span className="summary-stat inline-flex items-center gap-1"><b className="font-medium text-(--text-2) [font-family:var(--mono)] text-[10px]">{formatDuration(c.duration())}</b></span>
        <span className="summary-stat inline-flex items-center gap-1"><b className="font-medium text-(--text-2) [font-family:var(--mono)] text-[10px]">{c.tokens}</b> {t("chat.tokens")}</span>
        <span className="summary-stat inline-flex items-center gap-1"><b className="font-medium text-(--text-2) [font-family:var(--mono)] text-[10px]">{c.events.length}</b> {t("chat.events")}</span>
        <span className="summary-dots flex items-center gap-[2px]">
          {Object.entries(counts).flatMap(([cat, n]) =>
            Array.from({ length: Math.min(n, 12) }, (_, i) => <i key={`${cat}-${i}`} className={`summary-dot h-[8px] w-[4px] rounded-[1px] ${FDOT[cat.slice(0, 4)] ?? "bg-[rgba(255,255,255,0.14)]"}`} />)
          )}
        </span>
      </div>
      <div className="summary-line h-px flex-1 bg-[linear-gradient(90deg,transparent,var(--border),transparent)]" />
    </div>
  );
}

/* ── state tree ───────────────────────────────────────────────────── */

function StateNode({ name, value, pointer, touched }: { name: string; value: unknown; pointer: string; touched: string[] }) {
  const isObject = value !== null && typeof value === "object";
  const flash = touched.some((t) => t === "*" || t === pointer || (t && pointer.startsWith(t.replace(/\/-$/, "")) && t !== pointer));

  const row = (
    <div className={`node-row flex gap-[5px] rounded-[5px] px-[4px] py-px cursor-default [transition:background_0.6s] hover:bg-[rgba(255,255,255,0.04)] ${flash ? "animate-[flash_1.2s_var(--ease)]" : ""}`}>
      <span className="node-key text-[#8fd0ff] after:content-[':'] after:ml-[1px] after:text-(--text-3)">{name}</span>
      {isObject ? (
        <span className="node-brace text-(--text-3)">
          {Array.isArray(value) ? "[" : "{"}
          <span className="node-count ml-[3px] text-[9px] text-(--text-3)">{Array.isArray(value) ? value.length : Object.keys(value as object).length}</span>
        </span>
      ) : (
        <span className={valueTypeClass(value)}>{renderValue(value)}</span>
      )}
    </div>
  );

  if (!isObject) return <div className="node relative pl-[12px]">{row}</div>;

  return (
    <div className="node relative pl-[12px]">
      {row}
      <div className="node-branch ml-[3px] border-l border-[rgba(255,255,255,0.07)]">
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
          <StateNode key={key} name={key} value={child} pointer={`${pointer}/${key}`} touched={touched} />
        ))}
      </div>
    </div>
  );
}

function valueTypeClass(value: unknown) {
  if (value === null) return "node-null text-[#8b93a3]";
  if (typeof value === "number") return "node-num text-[#ffcf99]";
  if (typeof value === "boolean") return "node-bool text-[#c9a8ff]";
  return "node-str break-all text-[#9ef0c8]";
}

function renderValue(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export default {
  id: "aurora",
  name: "Aurora",
  tagline: "Dark glass · protocol mint",
  swatch: ["#06070a", "#161b26", "#5ef0c2"] as [string, string, string],
  ChatPage: AuroraPage,
};
