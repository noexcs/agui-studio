import { useMemo, useState } from "react";
import { useConversation, useSkinBranding, useSkinPlugins } from "../../host";
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
import { Markdown, timeOf } from "../../shared/Markdown";
import { ProtocolDrawer } from "../../shared/ProtocolDrawer";
import { ToolResult } from "../../shared/ToolResult";
import { planRawText, planView } from "../../shared/plan";
import { displayText, safeJson } from "../../shared/safe";
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { pendingInterrupts } from "../../shared/interrupts";
import {
  conversationGroups,
  foldGroupFailures,
  foldGroupOpen,
  foldGroupStats,
} from "../../shared/conversationGroups";
import { toolStage } from "../../shared/toolStatus";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { Icon } from "../../shared/Icon";
import { formatDuration } from "../../utils";
import { isZh, t } from "../../i18n";
import "./bubble.css";

/* ═══ Tailwind migration (task-13 Phase 2b) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-bubble tokens via arbitrary var shorthand, so
   --sk-accent/--sk-font/--sk-mono keep flowing. bubble.css keeps the strict
   residual: tokens, keyframes, the bubble/card tail pseudo-elements (the
   whole visual signature), .bb-md generated typography, the typing-dot
   nth-child delays, the .bb-tool-body .tool-result* overrides, scrollbars,
   the textarea focus overrides, and the reduced-motion fallback.
   Same-property state branches are branch-exclusive (§1.6-1): topbar status,
   pill, bubble in/out (all four corner radii written per branch), chip,
   plan state/check, approval pending/resolved/expired, button and send
   kinds. Chevrons are ternaries; details open state uses open: variants. */

const ROW_BASE = "bb-row flex min-w-0";
const ROW_IN = `${ROW_BASE} bb-row--in justify-start`;
const ROW_OUT = `${ROW_BASE} bb-row--out justify-end`;
const ROW_CENTER = `${ROW_BASE} bb-row--center justify-center`;
const STACK = "bb-stack flex flex-col gap-[3px] max-w-[78%] min-w-0 max-[720px]:max-w-[88%]";
const STACK_OUT = `${STACK} items-end`;
const TIME = "bb-time px-[6px] text-(--bb-faint) text-[9.5px]";
const TIME_CARD = "bb-time ml-auto px-0 text-(--bb-faint) text-[9.5px]";

const TOPBAR =
  "bb-topbar flex-none flex items-center gap-[10px] px-[16px] py-[10px] bg-[rgba(255,255,255,0.86)] backdrop-blur-[8px] border-b border-(--bb-line)";
const AVATAR =
  "bb-avatar flex-none inline-flex items-center justify-center w-[34px] h-[34px] rounded-full bg-[linear-gradient(135deg,var(--bb-out),#6f9bff)] text-[#fff] font-bold text-[14px]";
const STATUS_BASE = "bb-topbar-status text-[10.5px] whitespace-nowrap overflow-hidden text-ellipsis";
const STATUS_KIND: Record<string, string> = {
  running: "text-(--bb-out)",
  done: "text-(--bb-green-ink)",
  error: "text-(--bb-red-ink)",
  interrupted: "text-(--bb-amber)",
};
const STATUS_IDLE = "text-(--bb-faint)";
const MODEL =
  "bb-topbar-model ml-auto flex-none px-[9px] py-[2px] border border-(--bb-line) rounded-full bg-(--bb-panel) text-(--bb-dim) text-[9.5px]";

const CHAT = "bb-chat flex-1 min-h-0 overflow-y-auto";
const THREAD =
  "bb-thread flex flex-col gap-[10px] max-w-[640px] mx-auto px-[16px] pt-[18px] pb-[20px] min-h-full justify-end max-[720px]:px-[12px] max-[720px]:pt-[14px] max-[720px]:pb-[16px]";

const BUBBLE_BASE = "bb-bubble relative px-[13px] py-[9px] min-w-0 break-words";
const BUBBLE_IN = `${BUBBLE_BASE} bb-bubble--in bg-(--bb-in) border border-(--bb-line) rounded-tl-[18px] rounded-tr-[18px] rounded-br-[18px] rounded-bl-[6px] shadow-[0_1px_2px_rgba(28,36,48,0.05)]`;
const BUBBLE_OUT = `${BUBBLE_BASE} bb-bubble--out bg-(--bb-out-ink) text-(--bb-accent-fg) rounded-tl-[18px] rounded-tr-[18px] rounded-bl-[18px] rounded-br-[6px] shadow-[0_2px_6px_rgba(52,120,246,0.22)]`;

const EMPTY = "bb-empty flex flex-col items-center gap-[6px] mx-auto mt-[96px] text-center";
const EMPTY_DOT = "bb-empty-dot w-[10px] h-[10px] rounded-full bg-(--bb-out) opacity-[0.85] animate-[bb-rise_1.6s_ease-in-out_infinite] motion-reduce:animate-none";
const EMPTY_TITLE = "bb-empty-title m-0 text-(--bb-dim) text-[13.5px] font-semibold";
const EMPTY_SUB = "bb-empty-sub m-0 text-(--bb-faint) text-[9.5px]";

const PILL_BASE =
  "bb-pill inline-flex items-center gap-[6px] max-w-[88%] px-[12px] py-[4px] rounded-full text-[10.5px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";
const PILL_KIND: Record<string, string> = {
  running: "text-(--bb-out) bg-[rgba(52,120,246,0.08)]",
  error: "text-(--bb-red-ink) bg-[rgba(220,38,38,0.07)]",
  failed: "text-(--bb-red-ink) bg-[rgba(220,38,38,0.07)]",
  done: "text-(--bb-green-ink) bg-[rgba(29,154,108,0.08)]",
};
const PILL_IDLE = "bg-[rgba(28,36,48,0.05)] text-(--bb-dim)";

const CHEV = "bb-chev opacity-50 [transition:transform_0.15s_ease]";
const REASON =
  "bb-reason inline-flex items-center gap-[7px] px-[12px] py-[5px] border-0 rounded-full bg-[rgba(28,36,48,0.05)] text-(--bb-dim) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[10.5px] italic cursor-pointer max-w-full min-w-0 hover:text-(--bb-ink) hover:bg-[rgba(28,36,48,0.09)] active:text-(--bb-ink) active:bg-[rgba(28,36,48,0.13)]";
const REASON_META = "bb-reason-meta not-italic text-(--bb-faint) text-[9.5px]";
const REASON_BADGE =
  "bb-reason-badge px-[5px] py-0 rounded-[4px] bg-[rgba(109,40,217,0.08)] text-[#6d28d9] text-[8.5px] not-italic [font-family:var(--bb-mono)]";
const REASON_BODY = `${BUBBLE_IN} bb-reason-body text-[12px] italic text-(--bb-dim) whitespace-pre-wrap [&_.bb-pre]:not-italic [&_.bb-pre]:mt-[8px]`;

const CARD_BASE =
  "bb-card max-w-[88%] px-[12px] py-[10px] rounded-[16px] border shadow-[0_1px_2px_rgba(28,36,48,0.05)] text-[12px] min-w-0 relative";
const CARD_KIND: Record<string, string> = {
  default: "bg-(--bb-panel) border-(--bb-line)",
  error: "bg-[#fef4f4] border-[#f2caca]",
  pending: "bg-[#fff9ee] border-[#eddfc2]",
  resolved: "bg-(--bb-panel) border-(--bb-line) opacity-[0.78]",
  expired: "bg-(--bb-panel) border-(--bb-line)",
};
const CARD_APPROVAL_PENDING_HEAD = "[&_.bb-card-head_svg]:text-(--bb-amber)";
const CARD_HEAD = "bb-card-head flex items-center gap-[7px] mb-[6px] [&_svg]:flex-none [&_svg]:text-(--bb-dim)";
const CARD_TITLE = "bb-card-title font-[650] text-[12px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";
const CARD_MSG = "bb-card-msg mx-0 mt-0 mb-[4px] text-[12.5px] leading-[1.55] break-words";
const CARD_DESC = "bb-card-desc mx-0 mt-0 mb-[4px] text-[11.5px] text-(--bb-dim)";

const CHIP_BASE = "bb-chip flex-none px-[8px] py-px rounded-full text-[9px] font-[650] tracking-[0.03em]";
const CHIP_KIND: Record<string, string> = {
  streaming: "text-(--bb-out) bg-[rgba(52,120,246,0.09)]",
  running: "text-(--bb-out) bg-[rgba(52,120,246,0.09)]",
  done: "text-(--bb-green-ink) bg-[rgba(29,154,108,0.09)]",
  interrupted: "text-(--bb-amber) bg-[rgba(180,83,9,0.1)]",
  error: "text-(--bb-red-ink) bg-[rgba(220,38,38,0.08)]",
  plan: "text-[#2456b3] bg-[rgba(52,120,246,0.08)]",
  custom: "text-(--bb-dim) bg-[rgba(28,36,48,0.06)]",
};

const TOOL_HEAD =
  "bb-tool-head flex items-center gap-[7px] w-full p-0 border-0 bg-transparent text-(--bb-ink) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[11.5px] cursor-pointer text-left min-w-0 [&_svg]:flex-none [&_svg]:text-(--bb-dim) active:bg-[rgba(28,36,48,0.05)] active:rounded-[8px]";
const TOOL_NAME = "bb-tool-name flex-none font-semibold text-[11px]";
const TOOL_BRIEF = "bb-tool-brief flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--bb-faint) text-[9.5px]";
const TOOL_TIME = "bb-tool-time flex-none text-(--bb-faint) text-[9.5px]";
const TOOL_BODY = "bb-tool-body border-t border-(--bb-line) mt-[8px] pt-[8px]";
const TOOL_ERROR = "bb-tool-error mx-0 mt-[7px] mb-0 p-0 text-(--bb-red-ink) text-[11px]";
const PRE =
  "bb-pre mx-0 mt-[6px] mb-0 px-[10px] py-[8px] rounded-[10px] bg-[#f2f5fa] text-(--bb-dim) text-[10px] leading-[1.6] whitespace-pre-wrap break-words overflow-x-auto min-w-0";

const FOLD_CARD =
  "bb-card bb-card--fold max-w-[88%] rounded-[16px] border shadow-[0_1px_2px_rgba(28,36,48,0.05)] text-[12px] min-w-0 relative bg-(--bb-panel) border-(--bb-line) px-[12px] py-[9px]";
const FOLD_HEAD =
  "bb-fold-head flex items-center gap-[7px] w-full px-[8px] py-[3px] -mx-[8px] -my-[3px] border-0 rounded-[8px] bg-transparent text-(--bb-ink) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[11.5px] cursor-pointer text-left min-w-0 [&_svg]:flex-none [&_svg]:text-(--bb-dim) hover:bg-[rgba(28,36,48,0.04)] active:bg-[rgba(28,36,48,0.08)]";
const FOLD_TITLE = "bb-fold-title flex-none font-semibold text-[11px]";
const FOLD_SUMMARY = "bb-fold-summary flex-[1_1_auto] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--bb-faint) text-[9.5px]";
const FOLD_ITEMS =
  "bb-fold-items grid gap-[8px] mt-[9px] pt-[9px] border-t border-(--bb-line) [&_.bb-card]:max-w-full [&_.bb-reason]:justify-self-start";

const PLAN_LIST = "bb-plan-list list-none m-0 p-0 grid gap-[4px]";
const PLAN_LI_BASE = "flex items-baseline gap-[8px] text-[12px]";
const PLAN_LI: Record<string, string> = {
  done: "text-(--bb-green-ink)",
  active: "text-(--bb-ink)",
  cancelled: "text-(--bb-faint) line-through",
};
const PLAN_LI_IDLE = "text-(--bb-dim)";
const PLAN_CHECK_BASE = "bb-plan-check flex-none inline-flex w-[13px] h-[13px] border rounded-full items-center justify-center";
const PLAN_CHECK_KIND: Record<string, string> = {
  done: "border-(--bb-green)",
  active: "border-(--bb-out) animate-[bb-rise_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
};
const PLAN_CHECK_IDLE = "border-(--bb-line)";

const DETAILS = "bb-details grid gap-0 mx-0 mt-[6px] mb-[2px] [&>div]:grid [&>div]:grid-cols-[minmax(72px,0.35fr)_minmax(0,1fr)] [&>div]:gap-[8px] [&>div]:py-[3px] [&>div]:border-b [&>div]:border-b-(--bb-line) [&>div]:[border-bottom-style:dashed] [&>div:last-child]:border-b-0 [&_dt]:text-(--bb-dim) [&_dt]:text-[11px] [&_dd]:m-0 [&_dd]:text-[11px] [&_dd]:break-words [&_dd]:min-w-0";
const APPROVAL_ACTIONS = "bb-approval-actions flex items-center flex-wrap gap-[8px] mt-[9px]";
const BTN_BASE = "bb-btn px-[13px] py-[5px] border rounded-full text-[11.5px] font-semibold [font-family:inherit] [line-height:inherit] cursor-pointer";
const BTN_KIND: Record<string, string> = {
  default:
    "border-(--bb-line) bg-(--bb-panel) text-(--bb-ink) hover:border-[#c4cdd8] hover:bg-[#f5f7fa] active:scale-[0.98] active:border-[#b9c3d0] active:bg-[#eef1f6]",
  primary:
    "border-transparent bg-(--bb-out-ink) text-(--bb-accent-fg) hover:bg-(--bb-out-ink) hover:brightness-[1.08] active:scale-[0.98] active:brightness-[0.92]",
  ghost:
    "border-transparent bg-transparent text-(--bb-dim) font-medium hover:text-(--bb-ink) hover:bg-[rgba(28,36,48,0.05)] active:scale-[0.98] active:text-(--bb-ink) active:bg-[rgba(28,36,48,0.09)]",
};
const EDIT = "bb-edit mt-[8px] [&_label]:block [&_label]:mb-[4px] [&_label]:text-(--bb-faint) [&_label]:text-[9px] [&_label]:tracking-[0.12em] [&_label]:uppercase [&_label]:[font-family:var(--bb-mono)]";
const EDIT_AREA =
  "bb-edit-area w-full min-h-[76px] px-[10px] py-[8px] border border-(--bb-line) rounded-[12px] bg-[#ffffff] text-(--bb-ink) [font-family:var(--bb-mono)] text-[10.5px] leading-[1.55] resize-y outline-none";

const ERROR_CARD = `${CARD_BASE} bb-card--error ${CARD_KIND.error} flex items-start gap-[8px] text-(--bb-red-ink) text-[12px] [&_svg]:flex-none [&_svg]:mt-[3px]`;
const CUSTOM_CARD =
  `${CARD_BASE} bb-card--custom ${CARD_KIND.default} [&>summary]:flex [&>summary]:items-center [&>summary]:gap-[7px] [&>summary]:cursor-pointer [&>summary]:list-none [&>summary]:min-w-0 [&_.bb-pre]:mt-[8px] open:[&>summary_.bb-chev]:rotate-[-90deg]`;

const DOCK = "bb-dock flex-none px-[16px] pt-[8px] pb-[14px] bg-[linear-gradient(180deg,rgba(238,240,244,0),var(--bb-page)_40%)] max-[720px]:px-[10px] max-[720px]:pt-[6px] max-[720px]:pb-[12px]";
const SUGGESTIONS = "bb-suggestions flex gap-[7px] max-w-[640px] mx-auto mb-[8px] overflow-x-auto";
const SUGGESTION =
  "bb-suggestion flex-none px-[12px] py-[5px] border border-(--bb-line) rounded-full bg-(--bb-panel) text-(--bb-dim) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[11px] cursor-pointer max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap hover:text-(--bb-ink) hover:border-(--bb-out) active:scale-[0.98] active:text-(--bb-ink) active:border-(--bb-out) active:bg-[#f5f7fa]";
const COMPOSER =
  "bb-composer flex items-end gap-[10px] max-w-[640px] mx-auto px-[7px] py-[7px] pl-[16px] border border-(--bb-line) rounded-[24px] bg-(--bb-panel) shadow-[0_2px_10px_rgba(28,36,48,0.07)] focus-within:border-(--bb-out)";
const COMPOSER_AREA =
  "flex-1 min-w-0 min-h-[22px] max-h-[110px] px-0 py-[4px] border-0 outline-none resize-none bg-transparent text-(--bb-ink) [font-family:inherit] [font-weight:inherit] text-[13px] leading-[1.5] placeholder:text-(--bb-faint) disabled:opacity-55";
const SEND_BASE =
  "bb-send flex-none inline-flex items-center justify-center w-[34px] h-[34px] border-0 rounded-full cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed active:not-disabled:scale-[0.96] active:not-disabled:brightness-[0.92]";
const TYPING =
  "bb-bubble bb-bubble--in bb-typing inline-flex items-center gap-[4px] min-h-[34px] px-[14px] py-[11px] bg-(--bb-in) border border-(--bb-line) rounded-tl-[18px] rounded-tr-[18px] rounded-br-[18px] rounded-bl-[6px] shadow-[0_1px_2px_rgba(28,36,48,0.05)]";
const SEND_KIND: Record<string, string> = {
  send: "bg-(--bb-out-ink) text-(--bb-accent-fg)",
  stop: "bg-(--bb-red) text-(--bb-accent-fg)",
};


/**
 * Bubble — a mobile chat surface.
 *
 * Left/right speech bubbles with tails on a soft light page, a three-dot
 * typing indicator while the agent gathers its first words, one centered
 * column, and a composer pinned to the bottom. Approvals arrive as card
 * bubbles so the chat language never breaks. Friendly, but grown-up: one
 * accent, quiet hairlines, no cartoonish extras.
 */
export function BubblePage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const plugins = useSkinPlugins();
  const zh = isZh();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const scroller = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<Record<string, string>>({});

  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries);
  // Consecutive reasoning/tool bubbles collapse into one card bubble.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);
  const lastAssistant = [...c.entries].reverse().find((entry): entry is AssistantEntry => entry.kind === "assistant");
  // The typing bubble covers the moment before the first words land.
  const typing = running && (!lastAssistant || (lastAssistant.streaming && !lastAssistant.text));

  function send() {
    const text = draft.trim();
    if (!text || running || pending.length) return;
    setDraft("");
    c.send(text);
  }

  function beginEdit(id: string) {
    const target = c.entries.find(
      (entry): entry is InterruptEntry => entry.kind === "interrupt" && entry.id === id && entry.status === "pending"
    );
    if (!target) return;
    const tool = c.entries.find((entry): entry is ToolEntry => entry.kind === "tool" && entry.id === target.toolCallId);
    setEditJson((prev) => ({ ...prev, [target.id]: JSON.stringify(tool?.args ?? {}, null, 2) }));
    setEditingId(target.id);
  }

  function approve(entry: InterruptEntry, approved: boolean, withEdits: boolean) {
    let editedArgs: Record<string, unknown> | undefined;
    if (approved && withEdits && editingId === entry.id) {
      try {
        editedArgs = JSON.parse(editJson[entry.id] ?? "");
      } catch {
        editedArgs = undefined;
      }
    }
    setEditingId(null);
    c.resolveInterrupt(approved, editedArgs, entry.id);
  }

  const statusText = (
    c.status === "idle" ? t("status.idle")
    : c.status === "running" ? t("status.running")
    : c.status === "interrupted" ? t("status.interrupted")
    : c.status === "done" ? t("status.done")
    : c.status === "error" ? t("status.error")
    : t("status.stopped")
  );

  return (
    <div className="skin-bubble relative flex flex-col h-full min-h-0 overflow-hidden bg-(--bb-page) text-(--bb-ink) [font-family:var(--sk-font,Geist,Inter,system-ui,sans-serif)] text-[13.5px] leading-[1.6] isolate">
      <header className={TOPBAR}>
        <span className={AVATAR} aria-hidden="true">{displayText(brand.agentName).slice(0, 1).toUpperCase()}</span>
        <span className="bb-topbar-id flex flex-col min-w-0 leading-[1.25]">
          <strong className="text-[13.5px] font-[650] whitespace-nowrap overflow-hidden text-ellipsis">{displayText(brand.agentName)}</strong>
          <span className={`${STATUS_BASE} bb-topbar-status--${c.status} ${STATUS_KIND[c.status] ?? STATUS_IDLE}`}>{statusText}</span>
        </span>
        <span className={`${MODEL} mono`}>{displayText(brand.modelLabel)}</span>
      </header>

      <main className={CHAT} ref={scroller} role="log" aria-live="polite" aria-label={zh ? "对话" : "Conversation"}>
        <div className={THREAD}>
          {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
          {c.entries.length === 0 && (
            <div className={EMPTY}>
              <span className={EMPTY_DOT} aria-hidden="true" />
              <p className={EMPTY_TITLE}>{t("bb.empty")}</p>
              <p className={`${EMPTY_SUB} mono`}>{displayText(brand.modelLabel)} · {c.threadId}</p>
            </div>
          )}
          {foldItems.map((item) => {
            if (item.type === "entry") {
              return <Row key={item.entry.id} entry={item.entry} ctx={{ zh, plugins, openTools, setOpenTools, openReasoning, setOpenReasoning, editingId, editJson, setEditJson, setEditingId, beginEdit, approve }} />;
            }
            const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
            const failures = foldGroupFailures(item.entries);
            const stats = foldGroupStats(item.entries);
            const preview = stats.toolNames.slice(0, 3).join(", ");
            const extra = stats.toolNames.length - 3;
            const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
            return (
              <div key={item.id} className={ROW_IN}>
                <div className={FOLD_CARD} data-fold-id={item.id}>
                  <button
                    type="button"
                    className={FOLD_HEAD}
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
                    <Icon name="layers" size={11} />
                    <span className={FOLD_TITLE}>{t("fold.group")}</span>
                    <span className={`${FOLD_SUMMARY} mono`}>
                      {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
                      {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
                      {preview}
                      {extra > 0 && ` +${extra} ${t("fold.more")}`}
                    </span>
                    {failure ? (
                      <span className={`${CHIP_BASE} bb-chip--${failure} ${CHIP_KIND[failure]}`}>{failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}</span>
                    ) : foldGroupOpen(item.entries) ? (
                      <span className={`${CHIP_BASE} bb-chip--running ${CHIP_KIND.running}`}>{t("chat.executing")}</span>
                    ) : (
                      <span className={`${CHIP_BASE} bb-chip--done ${CHIP_KIND.done}`}>{`${item.entries.length} ${t("fold.steps")}`}</span>
                    )}
                    <Icon name="chevron" size={9} className={`${CHEV} ${open ? "rotate-[-90deg]" : "rotate-90"}`} />
                  </button>
                  {open && (
                    <div className={FOLD_ITEMS}>
                      {item.entries.map((entry) => {
                        if (entry.kind === "tool") {
                          return <ToolCard key={entry.id} entry={entry} open={!!openTools[entry.id]} onToggle={() => setOpenTools((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} />;
                        }
                        if (entry.kind === "reasoning") {
                          return <ReasonCard key={entry.id} entry={entry} open={!!openReasoning[entry.id]} onToggle={() => setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} />;
                        }
                        return null; // group members are reasoning/tool by construction
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {typing && (
            <div className={ROW_IN} data-testid="bb-typing">
              <div className={TYPING} role="status" aria-label={t("bb.typing")}>
                <i className="w-[6px] h-[6px] rounded-full bg-(--bb-faint) animate-[bb-rise_1.2s_ease-in-out_infinite] motion-reduce:animate-none" />
                <i className="w-[6px] h-[6px] rounded-full bg-(--bb-faint) animate-[bb-rise_1.2s_ease-in-out_0.15s_infinite] motion-reduce:animate-none" />
                <i className="w-[6px] h-[6px] rounded-full bg-(--bb-faint) animate-[bb-rise_1.2s_ease-in-out_0.3s_infinite] motion-reduce:animate-none" />
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className={DOCK}>
        {!!c.suggestions.length && (
          <div className={SUGGESTIONS} role="list" aria-label={zh ? "建议" : "Suggestions"}>
            {c.suggestions.slice(0, 4).map((suggestion, index) => (
              <button
                key={`suggestion-${index}`}
                type="button"
                role="listitem"
                className={SUGGESTION}
                onClick={() => setDraft(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <div className={COMPOSER}>
          <textarea
            rows={1}
            value={draft}
            aria-label={zh ? "消息输入框" : "Message composer"}
            placeholder={pending.length ? (zh ? "先处理上方的卡片" : "Handle the card above first") : zh ? "输入消息…" : "Message…"}
            disabled={pending.length > 0}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
              if (event.key === "Escape") c.stop();
            }}
            className={COMPOSER_AREA}
          />
          {running ? (
            <button type="button" className={`${SEND_BASE} bb-send--stop ${SEND_KIND.stop}`} onClick={() => c.stop()} aria-label={t("chat.stop")}>
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button type="button" className={`${SEND_BASE} ${SEND_KIND.send}`} onClick={send} disabled={!draft.trim() || pending.length > 0} aria-label={t("chat.send")}>
              <Icon name="send" size={14} />
            </button>
          )}
        </div>
      </footer>
      <ProtocolDrawer />
    </div>
  );
}

/* ── rows ──────────────────────────────────────────────────────────── */

interface RowCtx {
  zh: boolean;
  plugins: ReturnType<typeof useSkinPlugins>;
  openTools: Record<string, boolean>;
  setOpenTools: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  openReasoning: Record<string, boolean>;
  setOpenReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingId: string | null;
  editJson: Record<string, string>;
  setEditJson: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  beginEdit: (id: string) => void;
  approve: (entry: InterruptEntry, approved: boolean, withEdits: boolean) => void;
}

function Row({ entry, ctx }: { entry: Entry; ctx: RowCtx }) {
  switch (entry.kind) {
    case "user":
      return <UserRow entry={entry} />;
    case "assistant":
      return <AssistantRow entry={entry} />;
    case "reasoning":
      return <ReasoningRow entry={entry} open={!!ctx.openReasoning[entry.id]} onToggle={() => ctx.setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} />;
    case "tool":
      return <ToolRow entry={entry} open={!!ctx.openTools[entry.id]} onToggle={() => ctx.setOpenTools((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} />;
    case "plan":
      return <PlanRow entry={entry} />;
    case "step":
      return <SystemPill entry={entry} />;
    case "subagent":
      return <SubagentRow entry={entry} />;
    case "custom":
      return <CustomRow entry={entry} plugins={ctx.plugins} />;
    case "interrupt":
      return <InterruptRow entry={entry} ctx={ctx} />;
    case "error":
      return <ErrorRow entry={entry} />;
    default:
      return null;
  }
}

const UserRow = ({ entry }: { entry: Entry & { kind: "user"; text: string } }) => {
  return (
    <div className={ROW_OUT}>
      <div className={STACK_OUT}>
        <div className={BUBBLE_OUT}>
          <p className="m-0 whitespace-pre-wrap">{entry.text}</p>
        </div>
        <span className={TIME}>{t("chat.you")} · {timeOf(entry.at)}</span>
      </div>
    </div>
  );
};

function AssistantRow({ entry }: { entry: AssistantEntry }) {
  return (
    <div className={ROW_IN}>
      <div className={STACK}>
        <div className={BUBBLE_IN}>
          <Markdown text={entry.text} className="md bb-md" />
          {entry.streaming && !entry.text && <span className="bb-caret inline-block w-[2px] h-[14px] mt-[2px] bg-(--bb-dim) animate-[bb-blink_1s_steps(2)_infinite] motion-reduce:animate-none" aria-hidden="true" />}
        </div>
        <span className={TIME}>
          {entry.streaming ? t("bb.typing") : `${t("chat.assistant")} · ${timeOf(entry.at)}`}
        </span>
      </div>
    </div>
  );
}

function stageWord(status: ToolEntry["status"]): string {
  switch (toolStage(status)) {
    case "streaming":
      return t("chat.streamingArgs");
    case "running":
      return t("chat.executing");
    case "interrupted":
      return t("chat.interrupted");
    case "error":
      return t("chat.failed");
    default:
      return t("chat.done");
  }
}

function ToolRow({ entry, open, onToggle }: { entry: ToolEntry; open: boolean; onToggle: () => void }) {
  return (
    <div className={ROW_IN}>
      <ToolCard entry={entry} open={open} onToggle={onToggle} />
    </div>
  );
}

/** The tool card without its chat-row wrapper — reused inside fold groups. */
function ToolCard({ entry, open, onToggle }: { entry: ToolEntry; open: boolean; onToggle: () => void }) {
  const brief = (() => {
    const args = entry.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) return "";
    return Object.entries(args as Record<string, unknown>)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .slice(0, 2)
      .map(([key, value]) => `${key}=${String(value).slice(0, 30)}`)
      .join(" · ");
  })();
  return (
    <div className={`${CARD_BASE} bb-card--tool ${CARD_KIND.default}${open ? " is-open" : ""}`} data-stage={toolStage(entry.status)}>
      <button type="button" className={TOOL_HEAD} aria-expanded={open} onClick={onToggle}>
        <Icon name="wrench" size={11} />
        <span className={`${TOOL_NAME} mono`}>{displayText(entry.name)}</span>
        {brief && <span className={`${TOOL_BRIEF} mono`}>{brief}</span>}
        <span className={`${CHIP_BASE} bb-chip--${toolStage(entry.status)} ${CHIP_KIND[toolStage(entry.status)] ?? CHIP_KIND.done}`}>{stageWord(entry.status)}</span>
        {entry.durationMs ? <span className={`${TOOL_TIME} mono`}>{formatDuration(entry.durationMs)}</span> : null}
        <Icon name="chevron" size={9} className={`${CHEV} ${open ? "rotate-[-90deg]" : "rotate-90"}`} />
      </button>
      {open && (
        <div className={TOOL_BODY}>
          <pre className={`${PRE} mono`}>{displayText(entry.argsRaw) || safeJson(entry.args, 2)}</pre>
          <ToolResult entry={entry} variant="particle" />
          {entry.error && <p className={TOOL_ERROR}>{displayText(entry.error)}</p>}
        </div>
      )}
      {!open && entry.status === "error" && <p className={TOOL_ERROR}>{displayText(entry.error) || t("chat.failed")}</p>}
    </div>
  );
}

function ReasoningRow({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  return (
    <div className={ROW_IN}>
      <div className={STACK}>
        <ReasonCard entry={entry} open={open} onToggle={onToggle} />
      </div>
    </div>
  );
}

/** The reason pill (+ body) without its chat-row wrapper — reused in fold groups. */
function ReasonCard({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button type="button" className={REASON} aria-expanded={open} onClick={onToggle}>
        <Icon name="brain" size={11} />
        <span>{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
        {!!entry.tokens && <span className={`${REASON_META} mono`}>{entry.tokens} {t("chat.tokens")}</span>}
        {entry.encryptedValue && <span className={REASON_BADGE}>enc</span>}
        <Icon name="chevron" size={9} className={`${CHEV} ${open ? "rotate-[-90deg]" : "rotate-90"}`} />
      </button>
      {open && (
        <div className={REASON_BODY}>
          {entry.text || "encrypted reasoning item"}
          {entry.encryptedValue && <pre className={`${PRE} mono`}>{entry.encryptedValue.slice(0, 140)}</pre>}
        </div>
      )}
    </>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className={ROW_IN}>
      <div className={`${CARD_BASE} bb-card--plan ${CARD_KIND.default}`}>
        <div className={CARD_HEAD}>
          <Icon name="layers" size={11} />
          <span className={CARD_TITLE}>{displayText(entry.title)}</span>
          <span className={`${CHIP_BASE} bb-chip--plan ${CHIP_KIND.plan} mono`}>{t("wb.node.plan")}</span>
        </div>
        {view.rawOnly ? (
          <pre className={`${PRE} mono`}>{planRawText(view)}</pre>
        ) : (
          <ul className={PLAN_LIST}>
            {view.steps.map((step) => (
              <li key={step.id} data-state={step.state} className={`${PLAN_LI_BASE} ${PLAN_LI[step.state] ?? PLAN_LI_IDLE}`}>
                <span className={`${PLAN_CHECK_BASE} ${PLAN_CHECK_KIND[step.state] ?? PLAN_CHECK_IDLE}`}>{step.state === "done" && <Icon name="check" size={9} />}</span>
                {step.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SystemPill({ entry }: { entry: StepEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "failed" ? t("chat.failed") : t("chat.done");
  return (
    <div className={ROW_CENTER}>
      <span className={`${PILL_BASE} ${PILL_KIND[entry.status] ?? PILL_IDLE}`} data-status={entry.status}>
        {displayText(entry.name)} · {word}
      </span>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "error" ? t("chat.failed") : t("chat.done");
  return (
    <div className={ROW_CENTER}>
      <span className={`${PILL_BASE} ${PILL_KIND[entry.status] ?? PILL_IDLE}`} data-status={entry.status}>
        <Icon name="activity" size={10} />
        {displayText(entry.name)} · {word}
      </span>
    </div>
  );
}

function CustomRow({ entry, plugins }: { entry: CustomEntry; plugins: ReturnType<typeof useSkinPlugins> }) {
  const plugin = plugins.custom?.(entry);
  if (plugin) {
    return (
      <div className={ROW_IN}>
        <div className={`${CARD_BASE} ${CARD_KIND.default}`}>{plugin}</div>
      </div>
    );
  }
  return (
    <div className={ROW_IN}>
      <details className={CUSTOM_CARD}>
        <summary>
          <span className={`${CHIP_BASE} bb-chip--custom ${CHIP_KIND.custom} mono`}>{t("wb.node.custom")}</span>
          <span className={`${CARD_TITLE} mono`}>{displayText(entry.name)}</span>
          <Icon name="chevron" size={9} className={`${CHEV} rotate-90`} />
        </summary>
        <pre className={`${PRE} mono`}>{safeJson(entry.value, 2)}</pre>
      </details>
    </div>
  );
}

function InterruptRow({ entry, ctx }: { entry: InterruptEntry; ctx: RowCtx }) {
  const pendingCard = entry.status === "pending" && !entry.expired;
  const headWord = entry.expired
    ? t("intr.expired")
    : pendingCard
    ? t("intr.paused")
    : entry.status === "approved"
    ? t("intr.approvedBy")
    : t("intr.deniedBy");
  const kind = pendingCard ? "pending" : entry.expired ? "expired" : "resolved";
  return (
    <div className={ROW_IN}>
      <div className={`${CARD_BASE} bb-card--approval ${CARD_KIND[kind]}${pendingCard ? ` ${CARD_APPROVAL_PENDING_HEAD}` : ""}${pendingCard ? " is-pending" : " is-resolved"}`} data-expired={entry.expired || undefined}>
        <div className={CARD_HEAD}>
          <Icon name={entry.expired ? "clock" : "shield"} size={12} />
          <span className={CARD_TITLE}>{headWord}</span>
          <span className={`${TIME_CARD} mono`}>{timeOf(entry.at)}</span>
        </div>
        <p className={CARD_MSG}>{displayText(entry.message)}</p>
        {entry.description && <p className={CARD_DESC}>{displayText(entry.description)}</p>}
        {!!entry.details.length && (
          <dl className={DETAILS}>
            {entry.details.map((detail, index) => (
              <div key={`detail-${index}`}>
                <dt>{displayText(detail.label)}</dt>
                <dd className="mono">{displayText(detail.value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {entry.responseSchema && <pre className={`${PRE} mono`}>{safeJson(entry.responseSchema, 2)}</pre>}
        {pendingCard && (
          <>
            {ctx.editingId === entry.id && (
              <div className={EDIT}>
                <label className="mono">{t("intr.edit")}</label>
                <textarea
                  className={EDIT_AREA}
                  aria-label={ctx.zh ? "编辑参数" : "Edit arguments"}
                  value={ctx.editJson[entry.id] ?? ""}
                  onChange={(event) => ctx.setEditJson((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                  spellCheck={false}
                />
              </div>
            )}
            <div className={APPROVAL_ACTIONS}>
              <button type="button" className={`${BTN_BASE} bb-btn--primary ${BTN_KIND.primary}`} onClick={() => ctx.approve(entry, true, true)}>
                {ctx.editingId === entry.id ? t("intr.approveEdited") : t("intr.approve")}
              </button>
              <button type="button" className={`${BTN_BASE} ${BTN_KIND.default}`} onClick={() => ctx.approve(entry, false, false)}>
                {t("intr.deny")}
              </button>
              <button
                type="button"
                className={`${BTN_BASE} bb-btn--ghost ${BTN_KIND.ghost}`}
                onClick={() => (ctx.editingId === entry.id ? ctx.setEditingId(null) : ctx.beginEdit(entry.id))}
              >
                {ctx.editingId === entry.id ? t("intr.cancel") : t("intr.edit")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorRow({ entry }: { entry: ErrorEntry }) {
  return (
    <div className={ROW_IN}>
      <div className={ERROR_CARD} role="alert">
        <Icon name="x" size={12} />
        <span>{displayText(entry.message)}</span>
      </div>
    </div>
  );
}

export default {
  id: "bubble",
  name: "Bubble",
  tagline: "Mobile chat · tails & typing dots",
  swatch: ["#eef0f4", "#ffffff", "#2e63d3"] as [string, string, string],
  ChatPage: BubblePage,
};
