import { useMemo, useState } from "react";
import { useConversation, useSkinBranding, useSkinLang, useSkinPlugins } from "../../host";
import type {
  AssistantEntry,
  CustomEntry,
  Entry,
  ErrorEntry,
  InterruptEntry,
  PlanEntry,
  ReasoningEntry,
  StepEntry,
  SubagentEntry,
  ToolEntry,
} from "../../contract";
import { Markdown, clock, timeOf } from "../../shared/Markdown";
import { ProtocolDrawer } from "../../shared/ProtocolDrawer";
import { ToolResult } from "../../shared/ToolResult";
import { planRawText, planView } from "../../shared/plan";
import { displayText, entriesOf, isEmptyState, safeJson } from "../../shared/safe";
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { pendingInterrupts } from "../../shared/interrupts";
import {
  conversationGroups,
  foldGroupFailures,
  foldGroupOpen,
  foldGroupStats,
} from "../../shared/conversationGroups";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { Icon } from "../../shared/Icon";
import { formatDuration } from "../../utils";
import { t } from "../../i18n";
import "./particle.css";

/* ═══ Tailwind migration (task-13 Phase 2b) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-particle tokens via arbitrary var shorthand, so
   --sk-accent tuning and the --sk-font/--sk-mono hooks keep flowing.
   particle.css keeps only tokens/keyframes, the data-URI-free background
   gradients that read better as CSS (orbs/grid stay utilities), the
   .pt-markdown generated typography, the .pt-tool .tool-result* overrides
   of the shared aurora tool-result variant, scrollbars, the details-marker
   open-state rule, and the reduced-motion fallback.
   Same-property state branches are branch-exclusive (§1.6-1): hero-dot,
   tool border/status, step dot, subagent border, plan-state and
   interrupt pending/resolved maps carry full values. Chevron rotation is a
   ternary per site (default 90°, fold 0/90°, details -90° via residual). */

const INDENTED_KINDS = new Set(["reasoning", "tool", "plan", "step", "subagent", "custom", "interrupt", "error"]);

const ROW = "pt-row w-full max-w-[760px] mx-auto mb-[12px] relative";
const USER_ROW = `${ROW} pt-row--user flex justify-end items-end gap-[8px]`;
const ASSISTANT_ROW = `${ROW} pt-row--assistant flex gap-[12px]`;
const USER_BUBBLE =
  "pt-user max-w-[76%] px-[14px] py-[10px] rounded-[16px_16px_4px_16px] bg-[linear-gradient(135deg,rgba(155,140,255,0.24),rgba(103,245,208,0.12))] border border-[rgba(155,140,255,0.28)] text-[13px] leading-[1.6] whitespace-pre-wrap max-[720px]:max-w-[88%]";
const TIME = "pt-time text-[9.5px] text-(--pt-dim) opacity-80 whitespace-nowrap";
const AVATAR =
  "pt-avatar flex-none w-[26px] h-[26px] mt-[2px] rounded-full bg-[radial-gradient(circle_at_30%_30%,#dcd6ff,var(--pt-accent)_48%,#372f78_100%)] shadow-[0_0_18px_rgba(155,140,255,0.55)]";
const BUBBLE = "pt-bubble min-w-0 flex-1 px-0 py-[2px] text-[13.5px] leading-[1.72] [&_.pt-time]:block [&_.pt-time]:mt-[6px]";
const CHEV = "pt-chev opacity-60 [transition:transform_0.18s_ease]";

const REASON_TOGGLE =
  "pt-reason-toggle inline-flex items-center gap-[7px] px-[10px] py-[5px] rounded-full border border-(--pt-line) bg-[rgba(155,140,255,0.08)] text-(--pt-dim) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[10.5px] tracking-[0.04em] uppercase cursor-pointer hover:text-(--pt-text) hover:border-[rgba(155,140,255,0.35)]";
const REASON_BODY =
  "pt-reason-body mt-[8px] px-[12px] py-[10px] border-l border-[rgba(155,140,255,0.28)] text-(--pt-dim) text-[12px] leading-[1.7] whitespace-pre-wrap";
const BADGE =
  "pt-badge ml-[4px] px-[6px] py-px rounded-[4px] border border-[rgba(103,245,208,0.28)] text-(--pt-mint) text-[9px] tracking-[0.05em] uppercase";

const TOOL_BASE = "pt-tool w-full max-w-[760px] mx-auto mt-[10px] mb-[12px] border border-l-2 rounded-[10px] bg-(--pt-panel) overflow-hidden";
const TOOL_STATUS_BORDER: Record<string, string> = {
  done: "border-(--pt-line) border-l-(--pt-mint)",
  executing: "border-(--pt-line) border-l-(--pt-accent)",
  args: "border-(--pt-line) border-l-(--pt-accent)",
  interrupted: "border-(--pt-line) border-l-[#ffc478]",
  error: "border-[rgba(255,107,129,0.35)] border-l-[#ff6b81]",
};
const TOOL_BORDER_IDLE = "border-(--pt-line) border-l-(--pt-line)";
const TOOL_HEAD =
  "pt-tool-head flex items-center gap-[8px] w-full px-[13px] py-[11px] border-0 bg-transparent text-(--pt-text) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[11.5px] cursor-pointer text-left hover:bg-[rgba(155,140,255,0.07)]";
const TOOL_KICKER =
  "pt-tool-kicker px-[5px] py-px rounded-[3px] bg-[rgba(155,140,255,0.14)] text-(--pt-accent) text-[8.5px] tracking-[0.12em] uppercase";
const TOOL_NAME = "pt-tool-name [font-family:var(--sk-mono,ui-monospace,monospace)] text-[#c9c2ff]";
const TOOL_BRIEF =
  "pt-tool-brief min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--pt-dim) [font-family:var(--sk-mono,ui-monospace,monospace)] text-[10px]";
const TOOL_STATUS = "pt-tool-status ml-auto text-[10px] tracking-[0.04em] uppercase";
const TOOL_STATUS_TEXT: Record<string, string> = { error: "text-[#ff8094]" };
const TOOL_STATUS_IDLE = "text-(--pt-dim)";
const TOOL_BODY = "pt-tool-body border-t border-(--pt-line) px-[13px] pb-[12px] pt-[10px]";
const PRE =
  "pt-pre m-0 px-[11px] py-[9px] rounded-[8px] border border-(--pt-line) bg-[rgba(5,6,15,0.7)] text-(--pt-dim) [font-family:var(--sk-mono,ui-monospace,monospace)] text-[10.5px] leading-[1.6] whitespace-pre-wrap break-words overflow-x-auto";
const TOOL_ERROR = "pt-error m-0 px-[12px] py-[7px] border-t border-[rgba(255,107,129,0.25)] text-[#ff8094] text-[11px]";
const MUTED = "pt-muted text-(--pt-dim) text-[11.5px]";

const STEP_BASE = "pt-step w-full max-w-[760px] mx-auto my-[8px] flex items-center gap-[8px] text-(--pt-dim) text-[11px] [font-family:var(--sk-mono,ui-monospace,monospace)]";
const STEP_DOT_BASE = "pt-step-dot flex-none w-[5px] h-[5px] rounded-full";
const STEP_DOT: Record<string, string> = {
  done: "bg-(--pt-mint) shadow-[0_0_8px_var(--pt-mint)]",
};
const STEP_DOT_IDLE = "bg-(--pt-accent) shadow-[0_0_8px_var(--pt-accent)]";

const PLAN_CARD =
  "pt-plan-card w-full max-w-[760px] mx-auto mt-[10px] mb-[12px] border border-(--pt-line) rounded-[12px] bg-(--pt-panel) px-[13px] py-[11px] [&_ol]:list-none [&_ol]:m-0 [&_ol]:p-0";
const PLAN_HEAD = "pt-plan-card-head flex items-center gap-[7px] mb-[8px] text-(--pt-text) text-[12.5px]";
const PLAN_LI_BASE = "flex items-baseline gap-[8px] my-[5px] text-[11.5px]";
const PLAN_LI: Record<string, string> = {
  done: "text-(--pt-mint)",
  active: "text-(--pt-text)",
  pending: "text-(--pt-dim)",
};

const SUBAGENT_BASE =
  "pt-subagent flex items-center gap-[8px] w-full max-w-[760px] mx-auto my-[8px] px-[11px] py-[7px] border rounded-[10px] bg-[rgba(155,140,255,0.06)] text-(--pt-text) text-[11.5px]";
const SUBAGENT_STATUS: Record<string, string> = { running: "border-[rgba(155,140,255,0.4)]" };
const SUBAGENT_IDLE = "border-(--pt-line)";
const SUBAGENT_DETAIL = "pt-subagent-detail ml-auto text-(--pt-dim) text-[10.5px]";

const CUSTOM = "pt-custom w-full max-w-[760px] mx-auto mt-[10px] mb-[12px] px-0 py-[2px] text-[11px] [&>summary]:flex [&>summary]:items-center [&>summary]:gap-[7px] [&>summary]:px-[10px] [&>summary]:py-[6px] [&>summary]:border [&>summary]:border-dashed [&>summary]:border-(--pt-line) [&>summary]:rounded-[8px] [&>summary]:cursor-pointer [&>summary]:list-none [&>summary_.pt-chev]:ml-auto open:[&>summary]:rounded-b-none open:[&>summary_.pt-chev]:rotate-[-90deg] [&_.pt-pre]:mt-[6px]";

const INTERRUPT_BASE = "pt-interrupt w-full max-w-[760px] mx-auto mt-[10px] mb-[12px] border rounded-[14px] px-[14px] py-[13px] [&_.pt-kv]:mt-[9px] [&_.pt-pre]:mt-[9px]";
const INTERRUPT_KIND: Record<string, string> = {
  pending: "border-[rgba(255,196,120,0.35)] bg-[linear-gradient(180deg,rgba(255,196,120,0.1),rgba(17,20,38,0.7))]",
  resolved: "border-(--pt-line) bg-(--pt-panel) opacity-[0.72]",
};
const INTERRUPT_HEAD = "pt-interrupt-head flex items-center gap-[8px] text-[10.5px] tracking-[0.06em] uppercase";
const INTERRUPT_HEAD_KIND: Record<string, string> = {
  pending: "text-[#ffd9a0]",
  resolved: "text-(--pt-dim)",
};
const INTERRUPT_MSG = "pt-interrupt-msg mx-0 mt-[9px] mb-0 text-[13px] leading-[1.6]";
const INTERRUPT_ACTIONS = "pt-interrupt-actions flex flex-wrap gap-[8px] mt-[11px]";

const BTN_BASE = "pt-btn px-[12px] py-[6px] rounded-[8px] border text-[11.5px] [font-family:inherit] [line-height:inherit] [font-weight:inherit] cursor-pointer";
const BTN_KIND: Record<string, string> = {
  default: "border-(--pt-line) bg-[rgba(255,255,255,0.04)] text-(--pt-text) hover:border-[rgba(155,140,255,0.45)]",
  primary: "border-[rgba(103,245,208,0.45)] bg-[rgba(103,245,208,0.14)] text-[#bafff0] hover:border-[rgba(155,140,255,0.45)]",
  ghost: "border-(--pt-line) bg-transparent text-(--pt-dim) hover:border-[rgba(155,140,255,0.45)]",
};
const EDIT_AREA =
  "pt-edit w-full min-h-[70px] mt-[9px] px-[10px] py-[8px] rounded-[8px] border border-(--pt-line) bg-[rgba(5,6,15,0.7)] text-(--pt-text) [font-family:var(--sk-mono,ui-monospace,monospace)] text-[11px] resize-y";

const PANEL = "pt-panel px-0 pt-[12px] pb-[14px] border-b border-(--pt-line) first:pt-0 [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[9px] [&>h3]:text-(--pt-dim) [&>h3]:text-[9px] [&>h3]:font-semibold [&>h3]:tracking-[0.16em] [&>h3]:uppercase";
const KV =
  "pt-kv grid gap-[7px] m-0 [&>div]:grid [&>div]:grid-cols-[minmax(64px,0.4fr)_minmax(0,1fr)] [&>div]:gap-[8px] [&_dt]:text-(--pt-dim) [&_dt]:[font-family:var(--sk-mono,ui-monospace,monospace)] [&_dt]:text-[9.5px] [&_dt]:overflow-hidden [&_dt]:text-ellipsis [&_dd]:m-0 [&_dd]:text-(--pt-text) [&_dd]:[font-family:var(--sk-mono,ui-monospace,monospace)] [&_dd]:text-[9.5px] [&_dd]:whitespace-pre-wrap [&_dd]:break-words [&_dd]:max-h-[96px] [&_dd]:overflow-auto";
const VERSION = "pt-version mx-0 mt-[8px] mb-0 text-(--pt-dim) text-[9px] text-right";
const CHIPS = "pt-chips flex flex-wrap gap-[5px] [&>span]:px-[7px] [&>span]:py-[2px] [&>span]:rounded-full [&>span]:border [&>span]:border-(--pt-line) [&>span]:text-(--pt-dim) [&>span]:text-[9.5px]";

const COMPOSER_WRAP =
  "pt-composer-wrap flex-none px-[26px] pt-[10px] pb-[14px] bg-[linear-gradient(180deg,transparent,rgba(5,6,15,0.92)_55%)] max-[720px]:px-[14px] max-[720px]:pt-[8px] max-[720px]:pb-[12px]";
const SUGGESTIONS = "pt-suggestions flex flex-wrap gap-[7px] max-w-[760px] mx-auto mb-[9px]";
const SUGGESTION =
  "pt-suggestion inline-flex items-center gap-[6px] px-[10px] py-[5px] rounded-full border border-(--pt-line) bg-[rgba(155,140,255,0.08)] text-(--pt-dim) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[10.5px] cursor-pointer hover:text-(--pt-text) hover:border-[rgba(155,140,255,0.4)]";
const COMPOSER_BASE = "pt-composer flex items-center gap-[10px] max-w-[760px] mx-auto px-[12px] py-[9px] rounded-[14px] border bg-[rgba(17,20,38,0.86)] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]";
const COMPOSER_PENDING = "border-(--pt-line) focus-within:border-[rgba(155,140,255,0.5)] focus-within:shadow-[0_0_0_3px_rgba(155,140,255,0.1)]";
const COMPOSER_RUNNING = "border-(--pt-line)";
const PROMPT = "pt-prompt text-(--pt-accent) [font-family:var(--sk-mono,ui-monospace,monospace)]";
const COMPOSER_AREA =
  "flex-1 min-h-[20px] max-h-[120px] px-0 py-[2px] border-0 outline-0 resize-none bg-transparent text-(--pt-text) [font-family:inherit] [font-weight:inherit] text-[12.5px] leading-[1.6] placeholder:text-(--pt-dim)";
const SEND = "pt-send inline-flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border cursor-pointer disabled:opacity-36 disabled:cursor-not-allowed";
const SEND_KIND: Record<string, string> = {
  idle: "border-[rgba(103,245,208,0.35)] bg-[rgba(103,245,208,0.14)] text-[#bafff0]",
  running: "border-[rgba(255,107,129,0.4)] bg-[rgba(255,107,129,0.14)] text-[#ffb3bf]",
};

const FOLD_BASE = "pt-fold w-full max-w-[760px] mx-auto mt-0 mb-[12px] border border-(--pt-line) rounded-[10px] bg-(--pt-panel) overflow-hidden has-[.pt-fold-head:focus-visible]:border-[rgba(155,140,255,0.5)] has-[.pt-fold-head:focus-visible]:shadow-[0_0_0_3px_rgba(155,140,255,0.1)]";
const FOLD_HEAD_BASE =
  "pt-fold-head flex items-center gap-[8px] w-full px-[13px] py-[10px] border-0 bg-transparent text-(--pt-text) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[11.5px] tracking-[0.04em] uppercase cursor-pointer text-left min-w-0 hover:bg-[rgba(155,140,255,0.07)] active:bg-[rgba(155,140,255,0.12)] focus-visible:bg-[rgba(155,140,255,0.12)]";
const FOLD_SUMMARY =
  "pt-fold-summary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--pt-dim) [font-family:var(--sk-mono,ui-monospace,monospace)] text-[10px] normal-case tracking-normal";
const FOLD_FLAG = "pt-fold-flag flex-none px-[7px] py-px rounded-full text-[9.5px] normal-case tracking-[0.02em]";
const FOLD_FLAG_KIND: Record<string, string> = {
  error: "text-[#ff8094] bg-[rgba(255,107,129,0.12)]",
  interrupted: "text-[#ffc478] bg-[rgba(255,196,120,0.1)]",
  live: "text-(--pt-mint) bg-[rgba(103,245,208,0.1)]",
};
const FOLD_ITEMS = "pt-fold-items border-t border-(--pt-line) px-[13px] pt-[4px] pb-[12px] [&_.pt-row]:mt-[8px] [&_.pt-row]:mb-0 [&_.pt-row]:max-w-none";

const HERO_DOT_BASE = "pt-hero-dot flex-none w-[6px] h-[6px] rounded-full";
const HERO_DOT: Record<string, string> = {
  running: "bg-(--pt-accent) shadow-[0_0_10px_var(--pt-accent)] animate-[pt-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
  error: "bg-[#ff6b81] shadow-[0_0_10px_#ff6b81]",
};
const HERO_DOT_IDLE = "bg-(--pt-mint) shadow-[0_0_10px_var(--pt-mint)]";


/** Particle field skin: the agent name assembles from drifting dots, then the
 *  conversation runs underneath it as a calm glass column. */
export function ParticlePage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const lang = useSkinLang();
  const plugins = useSkinPlugins();
  const zh = lang === "zh";
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const scroller = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const pending = pendingInterrupts(c.entries);
  const running = c.status === "running";
  // Consecutive reasoning/tool rows collapse into one protocol fold card.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);
  const stateEntries = entriesOf(c.sharedState);
  const metadata = entriesOf(c.metadata ?? {});

  function send() {
    const text = draft.trim();
    if (!text || running || pending.length) return;
    setDraft("");
    c.send(text);
  }

  function approve(entry: InterruptEntry, approved: boolean) {
    let editedArgs: Record<string, unknown> | undefined;
    if (approved && edits[entry.id]) {
      try {
        editedArgs = JSON.parse(edits[entry.id]);
      } catch {
        setEditing(entry.id);
        return;
      }
    }
    setEditing(null);
    c.resolveInterrupt(approved, editedArgs, entry.id);
  }

  return (
    <div className="skin-particle relative flex flex-col h-full min-h-0 overflow-hidden bg-(--pt-bg) text-(--pt-text) [font-family:var(--sk-font,Geist,Inter,system-ui,sans-serif)] isolate">
      <div className="pt-bg absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <i className="pt-orb pt-orb--a absolute rounded-full blur-[100px] opacity-[0.24] w-[620px] h-[620px] left-[-220px] top-[-300px] bg-[radial-gradient(circle,rgba(122,108,255,0.6),transparent_68%)] animate-[pt-drift-a_24s_ease-in-out_infinite_alternate] motion-reduce:animate-none" />
        <i className="pt-orb pt-orb--b absolute rounded-full blur-[100px] opacity-[0.24] w-[520px] h-[520px] right-[-160px] top-[10%] bg-[radial-gradient(circle,rgba(64,224,210,0.34),transparent_70%)] animate-[pt-drift-b_29s_ease-in-out_infinite_alternate] motion-reduce:animate-none" />
        <div className="pt-grid absolute inset-0 opacity-10 [background-image:linear-gradient(rgba(190,195,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(190,195,255,0.12)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_72%)]" />
      </div>

      <div className="pt-shell relative z-[1] flex flex-col h-full min-h-0">
        <header className="pt-topbar flex-none flex items-center justify-between gap-[16px] min-h-[46px] px-[20px] border-b border-(--pt-line) bg-[rgba(8,9,20,0.72)] max-[720px]:px-[12px]">
          <div className="pt-brand flex items-center gap-[8px] min-w-0 text-[12.5px]">
            <span className={`${HERO_DOT_BASE} ${HERO_DOT[c.status] ?? HERO_DOT_IDLE}`} data-status={c.status} />
            <strong className="text-(--pt-text) font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{displayText(brand.agentName || "AG-UI")}</strong>
            <span className="pt-brand-sub text-(--pt-dim) text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis">{displayText(brand.modelLabel || c.transport)}</span>
          </div>
          <div className="pt-topmeta flex items-center gap-[14px] flex-none text-(--pt-dim) text-[10px] tracking-[0.05em] uppercase">
            <span className="pt-run max-w-[190px] overflow-hidden text-ellipsis whitespace-nowrap normal-case mono max-[720px]:hidden">{displayText(c.runId)}</span>
            <span>{c.tokens ? `${Math.round(c.tokens / 100) / 10}k tokens` : "— tokens"}</span>
            <span>{running ? clock(c.duration()) : c.status}</span>
          </div>
        </header>

        <div className="pt-main flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_286px] max-[1080px]:grid-cols-[minmax(0,1fr)]">
          <main className="pt-transcript overflow-y-auto px-[26px] pt-[20px] pb-[18px] max-[720px]:px-[14px] max-[720px]:pt-[14px] max-[720px]:pb-[10px]" ref={scroller} role="log" aria-live="polite" aria-label="Conversation">
            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            <div className="pt-feed w-full max-w-[760px] mx-auto">
            {(() => {
              const ctx = {
                zh,
                openTools,
                setOpenTools,
                openReasoning,
                setOpenReasoning,
                edits,
                setEdits,
                editing,
                setEditing,
                approve,
                plugins,
              };
              return foldItems.map((item) => {
                if (item.type === "entry") {
                  const row = renderEntry(item.entry, ctx);
                  return row ? (
                    <div key={item.entry.id} className={`pt-entry w-full${INDENTED_KINDS.has(item.entry.kind) ? " pl-[38px]" : ""}`} data-kind={item.entry.kind}>
                      {row}
                    </div>
                  ) : null;
                }
                const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
                const stats = foldGroupStats(item.entries);
                const failures = foldGroupFailures(item.entries);
                const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
                const preview = stats.toolNames.slice(0, 3).join(", ");
                const extra = stats.toolNames.length - 3;
                return (
                  <div key={item.id} className="pt-entry pt-entry--fold w-full" data-kind="fold" data-fold-id={item.id}>
                    <div className={FOLD_BASE}>
                      <button
                        type="button"
                        className={FOLD_HEAD_BASE}
                        data-fold-head=""
                        aria-expanded={open}
                        onClick={() => setFoldOverride((prev) => ({ ...prev, [item.id]: !open }))}
                        onKeyDown={(event) => {
                          // explicit for the keydown contract test (jsdom runs no activation)
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setFoldOverride((prev) => ({ ...prev, [item.id]: !open }));
                          }
                        }}
                      >
                        <Icon name="layers" size={12} />
                        <span>{t("fold.group")}</span>
                        <span className={FOLD_SUMMARY}>
                          {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
                          {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
                          {preview}
                          {extra > 0 && ` +${extra} ${t("fold.more")}`}
                        </span>
                        {failure ? (
                          <span className={`${FOLD_FLAG} pt-fold-flag--${failure} ${FOLD_FLAG_KIND[failure]}`}>
                            {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
                          </span>
                        ) : foldGroupOpen(item.entries) ? (
                          <span className={`${FOLD_FLAG} pt-fold-flag--live ${FOLD_FLAG_KIND.live}`}>{t("chat.executing")}</span>
                        ) : null}
                        <Icon name="chevron" size={11} className={`${CHEV}${open ? " rotate-90" : " rotate-0"}`} />
                      </button>
                      {open && (
                        <div className={FOLD_ITEMS}>
                          {item.entries.map((entry) => {
                            const row = renderEntry(entry, ctx);
                            return row ? <div key={entry.id}>{row}</div> : null;
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
            {!c.entries.length && (
              <p className="pt-empty mx-auto my-[40px] max-w-[380px] text-center text-(--pt-dim) text-[13px] leading-[1.7]">
                {zh ? "问点什么，粒子会先替你把答案聚拢。" : "Ask something — the field will gather the answer first."}
              </p>
            )}
            </div>
          </main>

          <aside className="pt-aside overflow-y-auto border-l border-(--pt-line) px-[16px] pt-[16px] pb-[40px] bg-[rgba(8,9,20,0.45)] max-[1080px]:hidden">
            {!!metadata.length && (
              <section className={PANEL}>
                <h3>{zh ? "元数据" : "Metadata"}</h3>
                <dl className={KV}>
                  {metadata.slice(0, 8).map(([key, value]) => (
                    <div key={key}>
                      <dt>{displayText(key)}</dt>
                      <dd>{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className={PANEL}>
              <h3>{zh ? "共享状态" : "Shared state"}</h3>
              {stateEntries.length ? (
                <dl className={KV}>
                  {stateEntries.slice(0, 10).map(([key, value]) => (
                    <div key={key}>
                      <dt>{displayText(key)}</dt>
                      <dd>{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : !isEmptyState(c.sharedState) ? (
                <pre className={PRE}>{displayText(c.sharedState)}</pre>
              ) : (
                <p className={MUTED}>{zh ? "暂无状态" : "No state yet"}</p>
              )}
              <p className={VERSION}>v{c.stateVersion}</p>
            </section>

            <section className={`${PANEL} pt-capabilities`}>
              <h3>{zh ? "能力" : "Capabilities"}</h3>
              <div className={CHIPS}>
                {c.capabilities?.tools?.supported && <span>tools</span>}
                {c.capabilities?.reasoning?.supported && <span>reasoning</span>}
                {c.capabilities?.state?.supported && <span>state</span>}
                {c.capabilities?.humanInTheLoop?.supported && <span>interrupts</span>}
                {!c.capabilities && <span className={MUTED}>—</span>}
              </div>
            </section>
          </aside>
        </div>

        <footer className={COMPOSER_WRAP}>
          {!!c.suggestions.length && (
            <div className={SUGGESTIONS}>
              {c.suggestions.slice(0, 4).map((suggestion, index) => (
                <button
                  key={`suggestion-${index}`}
                  type="button"
                  className={SUGGESTION}
                  onClick={() => setDraft(suggestion)}
                >
                  <Icon name="sparkle" size={12} />
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <div className={`${COMPOSER_BASE} ${running ? COMPOSER_RUNNING : COMPOSER_PENDING}${running ? " is-running" : ""}`}>
            <span className={PROMPT}>›</span>
            <textarea
              rows={1}
              value={draft}
              aria-label={zh ? "消息输入框" : "Message composer"}
              placeholder={
                pending.length
                  ? zh
                    ? "先处理上面的确认，再继续对话"
                    : "Resolve the request above to continue"
                  : zh
                  ? "发消息给 AG-UI 助手…"
                  : "Message the AG-UI agent…"
              }
              disabled={Boolean(pending.length)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className={COMPOSER_AREA}
            />
            {running ? (
              <button type="button" className={`${SEND} ${SEND_KIND.running}`} onClick={() => c.stop()} aria-label={zh ? "停止" : "Stop"}>
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="button" className={`${SEND} ${SEND_KIND.idle}`} onClick={send} disabled={!draft.trim() || !!pending.length} aria-label={t("chat.send")}>
                <Icon name="send" size={14} />
              </button>
            )}
          </div>
        </footer>
      </div>
      <ProtocolDrawer />
    </div>
  );
}

/* ── per-entry rendering ───────────────────────────────────────────── */

function renderEntry(
  entry: Entry,
  ctx: {
    zh: boolean;
    openTools: Record<string, boolean>;
    setOpenTools: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    openReasoning: Record<string, boolean>;
    setOpenReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    edits: Record<string, string>;
    setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    editing: string | null;
    setEditing: React.Dispatch<React.SetStateAction<string | null>>;
    approve: (entry: InterruptEntry, approved: boolean) => void;
    plugins: ReturnType<typeof useSkinPlugins>;
  }
) {
  switch (entry.kind) {
    case "user":
      return (
        <div className={USER_ROW}>
          <div className={USER_BUBBLE}>{entry.text}</div>
          <span className={TIME}>{timeOf(entry.at)}</span>
        </div>
      );
    case "assistant":
      return <AssistantRow entry={entry} />;
    case "reasoning":
      return <ReasoningRow entry={entry} {...ctx} />;
    case "tool":
      return <ToolRow entry={entry} {...ctx} />;
    case "plan":
      return <PlanRow entry={entry} />;
    case "step":
      return <StepRow entry={entry} zh={ctx.zh} />;
    case "subagent":
      return <SubagentRow entry={entry} zh={ctx.zh} />;
    case "custom":
      return <CustomRow entry={entry} plugins={ctx.plugins} />;
    case "interrupt":
      return <InterruptRow entry={entry} {...ctx} />;
    case "error":
      return <ErrorRow entry={entry} />;
    default:
      return null;
  }
}

function AssistantRow({ entry }: { entry: AssistantEntry }) {
  return (
    <div className={ASSISTANT_ROW}>
      <span className={AVATAR} aria-hidden="true" />
      <div className={BUBBLE}>
        <Markdown text={entry.text} className="md pt-markdown" />
        {entry.streaming && <span className="pt-caret inline-block w-[7px] h-[15px] ml-[3px] align-[-2px] bg-(--pt-accent) animate-[pt-blink_1s_steps(2)_infinite] motion-reduce:animate-none" aria-hidden="true" />}
        <span className={TIME}>{timeOf(entry.at)}</span>
      </div>
    </div>
  );
}

function ReasoningRow({
  entry,
  openReasoning,
  setOpenReasoning,
}: {
  entry: ReasoningEntry;
  openReasoning: Record<string, boolean>;
  setOpenReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const open = openReasoning[entry.id] ?? false;
  return (
    <div className={`${ROW} pt-row--reasoning`}>
      <button
        type="button"
        className={REASON_TOGGLE}
        aria-expanded={open}
        onClick={() => setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
      >
        <Icon name="brain" size={12} />
        <span>{entry.streaming ? "thinking" : "reasoning"}</span>
        <span className="pt-dim text-(--pt-dim)">· {entry.tokens} tokens</span>
        {entry.encryptedValue && <span className={BADGE}>encrypted</span>}
        <Icon name="chevron" size={11} className={`${CHEV} rotate-90`} />
      </button>
      {open && (
        <div className={REASON_BODY}>
          {entry.text ? <p>{entry.text}</p> : <p className={MUTED}>encrypted reasoning item</p>}
          {entry.encryptedValue && <pre className={PRE}>{entry.encryptedValue.slice(0, 160)}</pre>}
        </div>
      )}
    </div>
  );
}

function ToolRow({
  entry,
  openTools,
  setOpenTools,
  zh,
}: {
  entry: ToolEntry;
  openTools: Record<string, boolean>;
  setOpenTools: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  zh: boolean;
}) {
  const open = openTools[entry.id] ?? false;
  const brief = (() => {
    const args = entry.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) return "";
    return Object.entries(args as Record<string, unknown>)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .slice(0, 2)
      .map(([key, value]) => `${key}=${String(value).slice(0, 28)}`)
      .join(" · ");
  })();
  const status =
    entry.status === "done" ? "done" : entry.status === "error" ? "error" : entry.status === "interrupted" ? "paused" : "running";
  return (
    <div className={`${TOOL_BASE} ${TOOL_STATUS_BORDER[entry.status] ?? TOOL_BORDER_IDLE}`} data-status={entry.status}>
      <button type="button" className={TOOL_HEAD} onClick={() => setOpenTools((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} aria-expanded={open}>
        <Icon name="wrench" size={12} />
        <span className={TOOL_KICKER}>tool</span>
        <span className={TOOL_NAME}>{displayText(entry.name)}</span>
        {brief && <span className={TOOL_BRIEF}>{brief}</span>}
        <span className={`${TOOL_STATUS} ${TOOL_STATUS_TEXT[entry.status] ?? TOOL_STATUS_IDLE}`}>{status}</span>
        <span className={TIME}>{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
        <Icon name="chevron" size={11} className={`${CHEV} rotate-90`} />
      </button>
      {open && (
        <div className={TOOL_BODY}>
          <pre className={PRE}>{displayText(entry.argsRaw) || safeJson(entry.args, 2)}</pre>
          <ToolResult entry={entry} variant="particle" />
        </div>
      )}
      {!open && entry.error && <p className={TOOL_ERROR}>{displayText(entry.error)}</p>}
      {!open && entry.status === "error" && !entry.error && <p className={TOOL_ERROR}>{zh ? "工具失败" : "Tool failed"}</p>}
    </div>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className={PLAN_CARD}>
      <div className={PLAN_HEAD}>
        <Icon name="layers" size={12} />
        <span>{displayText(entry.title)}</span>
        <span className={BADGE}>{displayText(entry.activityType)}</span>
      </div>
      {view.rawOnly ? (
        <pre className={PRE}>{planRawText(view)}</pre>
      ) : (
        <ol>
          {view.steps.map((step) => (
            <li key={step.id} data-state={step.state} className={`${PLAN_LI_BASE} ${PLAN_LI[step.state] ?? PLAN_LI.pending}`}>
              <span className={`${STEP_DOT_BASE} ${STEP_DOT[step.state] ?? STEP_DOT_IDLE}${step.state === "active" ? " animate-[pt-pulse_1.2s_infinite] motion-reduce:animate-none" : ""}`} />
              {step.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({ entry, zh }: { entry: StepEntry; zh: boolean }) {
  return (
    <div className={STEP_BASE} data-status={entry.status}>
      <span className={`${STEP_DOT_BASE} ${STEP_DOT[entry.status] ?? STEP_DOT_IDLE}`} />
      <span>{displayText(entry.name)}</span>
      <span className="pt-dim text-(--pt-dim)">{entry.status === "running" ? (zh ? "进行中" : "running") : entry.status}</span>
    </div>
  );
}

function SubagentRow({ entry, zh }: { entry: SubagentEntry; zh: boolean }) {
  return (
    <div className={`${SUBAGENT_BASE} ${SUBAGENT_STATUS[entry.status] ?? SUBAGENT_IDLE}`} data-status={entry.status}>
      <Icon name="activity" size={12} />
      <span>{displayText(entry.name)}</span>
      <span className="pt-dim text-(--pt-dim)">{entry.status === "running" ? (zh ? "运行中" : "running") : entry.status}</span>
      {entry.detail && <span className={SUBAGENT_DETAIL}>{displayText(entry.detail)}</span>}
    </div>
  );
}

function CustomRow({ entry, plugins }: { entry: CustomEntry; plugins: ReturnType<typeof useSkinPlugins> }) {
  if (entry.display === "debug") return null;
  const plugin = plugins.custom?.(entry);
  if (plugin) return <div className={CUSTOM}>{plugin}</div>;
  const kind =
    entry.value === null
      ? "null"
      : Array.isArray(entry.value)
      ? `array[${entry.value.length}]`
      : typeof entry.value === "object"
      ? "object"
      : typeof entry.value;
  return (
    <details className={CUSTOM}>
      <summary>
        <span className={BADGE}>{displayText(entry.name)}</span>
        <span className="pt-dim text-(--pt-dim)">{kind}</span>
        <Icon name="chevron" size={11} className={`${CHEV} rotate-90`} />
      </summary>
      <pre className={PRE}>{safeJson(entry.value, 2)}</pre>
    </details>
  );
}

function InterruptRow({
  entry,
  zh,
  edits,
  setEdits,
  editing,
  setEditing,
  approve,
}: {
  entry: InterruptEntry;
  zh: boolean;
  edits: Record<string, string>;
  setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  editing: string | null;
  setEditing: React.Dispatch<React.SetStateAction<string | null>>;
  approve: (entry: InterruptEntry, approved: boolean) => void;
}) {
  const pending = entry.status === "pending" && !entry.expired;
  const kind = pending ? "pending" : "resolved";
  return (
    <div className={`${INTERRUPT_BASE} ${INTERRUPT_KIND[kind]}${pending ? "" : " is-resolved"}`}>
      <div className={`${INTERRUPT_HEAD} ${INTERRUPT_HEAD_KIND[kind]}`}>
        <Icon name={entry.expired ? "clock" : "shield"} size={14} />
        <span>
          {entry.expired
            ? zh
              ? "已过期"
              : "expired"
            : pending
            ? zh
              ? "等待确认"
              : "needs approval"
            : entry.status === "approved"
            ? zh
              ? "已批准"
              : "approved"
            : zh
            ? "已拒绝"
            : "denied"}
        </span>
        {entry.expiresAt && <span className="pt-dim text-(--pt-dim)">{new Date(entry.expiresAt).toLocaleTimeString()}</span>}
      </div>
      <p className={INTERRUPT_MSG}>{displayText(entry.message)}</p>
      {entry.description && <p className={MUTED}>{displayText(entry.description)}</p>}
      {!!entry.details.length && (
        <dl className={KV}>
          {entry.details.map((detail, index) => (
            <div key={`detail-${index}`}>
              <dt>{displayText(detail.label)}</dt>
              <dd>{displayText(detail.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.responseSchema && <pre className={PRE}>{safeJson(entry.responseSchema, 2)}</pre>}
      {pending && (
        <>
          {editing === entry.id && (
            <textarea
              className={EDIT_AREA}
              aria-label={zh ? "编辑参数" : "Edit arguments"}
              value={edits[entry.id] ?? ""}
              onChange={(event) => setEdits((prev) => ({ ...prev, [entry.id]: event.target.value }))}
              spellCheck={false}
            />
          )}
          <div className={INTERRUPT_ACTIONS}>
            <button type="button" className={`${BTN_BASE} pt-btn--primary ${BTN_KIND.primary}`} onClick={() => approve(entry, true)}>
              {zh ? "批准" : "Approve"}
            </button>
            <button type="button" className={`${BTN_BASE} ${BTN_KIND.default}`} onClick={() => approve(entry, false)}>
              {zh ? "拒绝" : "Deny"}
            </button>
            <button
              type="button"
              className={`${BTN_BASE} pt-btn--ghost ${BTN_KIND.ghost}`}
              onClick={() => {
                setEditing(editing === entry.id ? null : entry.id);
                setEdits((prev) => ({ ...prev, [entry.id]: prev[entry.id] ?? safeJson(entry.metadata ?? {}, 2) }));
              }}
            >
              {editing === entry.id ? (zh ? "收起" : "Close") : zh ? "编辑参数" : "Edit args"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorRow({ entry }: { entry: ErrorEntry }) {
  return (
    <div className="pt-error-row flex items-center gap-[8px] w-full max-w-[760px] mx-auto mt-[10px] mb-[12px] px-[11px] py-[8px] border border-[rgba(255,107,129,0.35)] rounded-[10px] text-[#ff9bab] text-[11.5px]" role="alert">
      <Icon name="x" size={12} />
      <span>{displayText(entry.message)}</span>
    </div>
  );
}

export default {
  id: "particle",
  name: "Particle",
  tagline: "Particle field · live protocol",
  swatch: ["#05060f", "#101528", "#9b8cff"] as [string, string, string],
  ChatPage: ParticlePage,
};
