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
import { Markdown, clock, timeOf } from "../../shared/Markdown";
import { ProtocolDrawer } from "../../shared/ProtocolDrawer";
import { ToolResult } from "../../shared/ToolResult";
import { planRawText, planView } from "../../shared/plan";
import { displayText, entriesOf, isEmptyState, safeJson } from "../../shared/safe";
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { pendingInterrupts } from "../../shared/interrupts";
import {
  conversationGroups,
  foldGroupDuration,
  foldGroupFailures,
  foldGroupOpen,
} from "../../shared/conversationGroups";
import { toolStage } from "../../shared/toolStatus";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { Icon } from "../../shared/Icon";
import { formatDuration, plainText } from "../../utils";
import { isZh, t } from "../../i18n";
import "./dash.css";

/* ═══ Tailwind migration (task-13 Phase 2b) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-dash tokens via arbitrary var shorthand, so --sk-accent
   tuning and the --sk-font/--sk-mono hooks keep flowing. dash.css keeps only
   tokens, keyframes, the .mono font-family consumption, .ds-md generated
   typography, .ds-tool-body .tool-result* overrides of the shared aurora
   variant, scrollbars, the two textarea focus overrides (they must beat the
   skin ring), and the reduced-motion fallback.
   Same-property state branches are branch-exclusive (§1.6-1): brand dot,
   status pill, KPI value color/size, tag, stage badge, tool border-left,
   plan-state li/check, step dot, approval pending/resolved/expired, button
   and send kinds each write full values. Chevrons are ternaries. */

const HEADER = "ds-header flex-none flex items-center gap-[14px] h-[44px] px-[16px] bg-(--ds-panel) border-b border-(--ds-line)";
const BRAND_DOT_BASE = "ds-brand-dot flex-none w-[8px] h-[8px] rounded-full";
const BRAND_DOT: Record<string, string> = {
  running: "bg-(--ds-blue) animate-[ds-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  done: "bg-(--ds-accent)",
  error: "bg-(--ds-red)",
  interrupted: "bg-(--ds-amber)",
};
const BRAND_DOT_IDLE = "bg-(--ds-faint)";
const PILL_BASE = "ds-pill flex-none inline-flex items-center gap-[6px] px-[10px] py-[3px] rounded-full text-[10.5px] font-semibold";
const PILL_KIND: Record<string, string> = {
  idle: "text-(--ds-dim) bg-[#eef1f5]",
  running:
    "text-(--ds-blue-ink) bg-[rgba(37,99,235,0.08)] [&>i]:animate-[ds-pulse_1.6s_ease-in-out_infinite] motion-reduce:[&>i]:animate-none",
  done: "text-(--ds-green) bg-[rgba(13,148,136,0.09)]",
  error: "text-(--ds-red-ink) bg-[rgba(220,38,38,0.08)]",
  interrupted: "text-(--ds-amber) bg-[rgba(180,83,9,0.09)]",
  stopped: "text-(--ds-dim) bg-[#eef1f5]",
};

const KPI_GRID = "ds-kpis flex-none grid grid-cols-4 gap-[8px] px-[16px] py-[8px] max-[720px]:grid-cols-2";
const KPI_BASE = "ds-kpi min-w-0 px-[14px] pt-[10px] pb-[9px] bg-(--ds-panel) border border-(--ds-line) rounded-[10px] flex flex-col gap-[2px]";
const KPI_LABEL = "ds-kpi-label text-(--ds-faint) text-[9px] font-bold tracking-[0.12em] uppercase";
const KPI_VALUE_BASE = "ds-kpi-value font-[650] leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis";
const KPI_VALUE_MONO = "text-[17px]";
const KPI_VALUE_PLAIN = "text-[14px]";
const KPI_STATUS_COLOR: Record<string, string> = {
  running: "text-(--ds-blue-ink)",
  done: "text-(--ds-green)",
  error: "text-(--ds-red-ink)",
  interrupted: "text-(--ds-amber)",
};
const KPI_SUB = "ds-kpi-sub text-(--ds-faint) text-[9.5px] whitespace-nowrap overflow-hidden text-ellipsis";

const BODY = "ds-body flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_264px] max-[1080px]:grid-cols-[minmax(0,1fr)]";
const FEED_COL = "ds-feed-col flex flex-col min-w-0 min-h-0";
const FEED_HEAD = "ds-feed-head flex-none flex items-baseline gap-[10px] px-[20px] pt-[10px] pb-[8px]";
const FEED_TITLE = "ds-feed-title text-[10px] font-bold tracking-[0.12em] uppercase text-(--ds-dim)";
const FEED_COUNT = "ds-feed-count ml-auto text-(--ds-faint) text-[10px]";
const FEED = "ds-feed flex-1 min-h-0 overflow-y-auto px-[20px] pt-0 pb-[14px] max-[720px]:px-[12px] max-[720px]:pb-[10px]";
const EMPTY =
  "ds-empty flex flex-col items-center gap-[8px] mx-auto mt-[72px] max-w-[380px] px-[24px] py-[20px] border border-dashed border-(--ds-line) rounded-[12px] bg-(--ds-panel) text-(--ds-dim) text-center text-[12px] [&_p]:m-0";
const ROWS = "ds-rows flex flex-col";
const ROW = "ds-row pt-[9px] pb-[8px] border-b border-(--ds-line-soft) min-w-0 last:border-b-0";
const ROW_META = "ds-row-meta block mb-[3px] text-(--ds-faint) text-[9.5px] tracking-[0.04em]";

const TAG_BASE = "ds-tag flex-none px-[6px] py-px rounded-[4px] text-[8.5px] tracking-[0.08em] uppercase";
const TAG_KIND: Record<string, string> = {
  tool: "text-[#6d28d9] bg-[rgba(109,40,217,0.08)]",
  plan: "text-(--ds-blue) bg-[rgba(37,99,235,0.08)]",
  sub: "text-(--ds-accent-ink) bg-[rgba(13,148,136,0.09)]",
  custom: "text-(--ds-dim) bg-[#eef1f5]",
  fold: "text-(--ds-dim) bg-[#f0f2f5]",
};
const STAGE_BASE = "ds-stage flex-none px-[7px] py-px rounded-full text-[9.5px] font-semibold";
const STAGE_KIND: Record<string, string> = {
  streaming: "text-(--ds-blue-ink) bg-[rgba(37,99,235,0.08)]",
  running: "text-(--ds-blue-ink) bg-[rgba(37,99,235,0.08)] animate-[ds-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  done: "text-(--ds-green) bg-[rgba(13,148,136,0.09)]",
  interrupted: "text-(--ds-amber) bg-[rgba(180,83,9,0.1)]",
  error: "text-(--ds-red-ink) bg-[rgba(220,38,38,0.08)]",
};
const CHEV = "ds-chev opacity-50 [transition:transform_0.15s_ease]";

const FOLD_ROW = "ds-row ds-row--fold py-[3px] min-w-0";
const FOLD_HEAD_BASE =
  "ds-fold-head flex items-center gap-[8px] w-full px-[10px] py-[6px] border border-(--ds-line-soft) rounded-[8px] bg-transparent text-(--ds-ink) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[11px] cursor-pointer text-left min-w-0 hover:bg-[#f6f8fa] hover:border-(--ds-line) active:bg-[#eef1f5]";
const FOLD_SUMMARY = "ds-fold-summary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--ds-dim) text-[10.5px]";
const FOLD_BODY = "ds-fold-body [&_.ds-row:first-child]:pt-[3px]";

const TOOL_BASE =
  "ds-tool border-t border-r border-b border-t-(--ds-line) border-r-(--ds-line) border-b-(--ds-line) border-l-2 rounded-[8px] bg-(--ds-panel) overflow-hidden max-w-[720px]";
const TOOL_BORDER: Record<string, string> = {
  done: "border-l-(--ds-accent)",
  running: "border-l-(--ds-blue)",
  streaming: "border-l-(--ds-blue)",
  interrupted: "border-l-(--ds-amber)",
  error: "border-l-(--ds-red)",
};
const TOOL_BORDER_IDLE = "border-l-(--ds-line)";
const TOOL_ROW =
  "ds-tool-row flex items-center gap-[8px] w-full px-[10px] py-[7px] border-0 bg-transparent text-(--ds-ink) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[11.5px] cursor-pointer text-left min-w-0 hover:bg-[#f6f8fa] active:bg-[#eef1f5]";
const TOOL_NAME = "ds-tool-name flex-none font-semibold text-[11px]";
const TOOL_BRIEF = "ds-tool-brief flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--ds-faint) text-[10px]";
const TOOL_TIME = "ds-tool-time flex-none text-(--ds-faint) text-[10px]";
const TOOL_BODY = "ds-tool-body border-t border-(--ds-line-soft) px-[11px] pt-[9px] pb-[11px]";
const TOOL_ERROR = "ds-tool-error mx-0 mt-[6px] mb-0 px-[11px] pb-[8px] text-(--ds-red-ink) text-[11px]";
const PRE =
  "ds-pre mx-0 mt-[6px] mb-0 px-[11px] py-[9px] border border-(--ds-line) rounded-[7px] bg-[#fbfcfd] text-(--ds-dim) text-[10.5px] leading-[1.6] whitespace-pre-wrap break-words overflow-x-auto min-w-0";

const REASON = "ds-reason max-w-[720px]";
const REASON_HEAD =
  "ds-reason-head inline-flex items-center gap-[7px] px-[10px] py-[4px] border border-(--ds-line) rounded-full bg-transparent text-(--ds-dim) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[10.5px] italic cursor-pointer hover:text-(--ds-ink) hover:bg-[#f6f8fa] active:text-(--ds-ink) active:bg-[#eef1f5]";
const REASON_META = "ds-reason-meta not-italic text-(--ds-faint) text-[9.5px]";
const REASON_BODY =
  "ds-reason-body mx-0 mt-[6px] mb-[2px] ml-[10px] px-0 py-[2px] pl-[12px] border-l-2 border-(--ds-line) text-(--ds-dim) text-[12px] italic whitespace-pre-wrap";

const PLAN =
  "ds-plan max-w-[720px] px-[12px] pt-[9px] pb-[10px] border border-(--ds-line) rounded-[8px] bg-(--ds-panel)";
const PLAN_HEAD = "ds-plan-head flex items-center gap-[8px] mb-[6px]";
const PLAN_TITLE = "ds-plan-title font-[650] text-[12px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";
const PLAN_COUNT = "ds-plan-count ml-auto text-(--ds-dim) text-[10px]";
const PLAN_LIST = "ds-plan-list list-none m-0 p-0 grid gap-[4px]";
const PLAN_LI_BASE = "flex items-baseline gap-[8px] text-[12px]";
const PLAN_LI: Record<string, string> = {
  done: "text-(--ds-green)",
  active: "text-(--ds-ink)",
  cancelled: "text-(--ds-faint) line-through",
};
const PLAN_LI_IDLE = "text-(--ds-dim)";
const PLAN_CHECK_BASE = "ds-plan-check flex-none inline-flex w-[13px] h-[13px] border rounded-[3px] items-center justify-center";
const PLAN_CHECK_KIND: Record<string, string> = {
  done: "border-(--ds-green)",
  active: "border-(--ds-blue) animate-[ds-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
};
const PLAN_CHECK_IDLE = "border-(--ds-line)";

const STEP = "ds-step flex items-center gap-[8px] max-w-[720px] text-[11px] text-(--ds-dim)";
const STEP_DOT_BASE = "ds-step-dot flex-none w-[6px] h-[6px] rounded-full";
const STEP_DOT: Record<string, string> = { done: "bg-(--ds-accent)", failed: "bg-(--ds-red)" };
const STEP_DOT_IDLE = "bg-(--ds-blue)";
const SUBAGENT = "ds-subagent flex items-center gap-[8px] max-w-[720px] text-[11px] min-w-0";
const SUBAGENT_DETAIL = "ds-subagent-detail ml-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--ds-faint) text-[10px]";

const CUSTOM =
  "ds-custom max-w-[720px] text-[11px] [&>summary]:flex [&>summary]:items-center [&>summary]:gap-[8px] [&>summary]:px-[10px] [&>summary]:py-[5px] [&>summary]:border [&>summary]:border-dashed [&>summary]:border-(--ds-line) [&>summary]:rounded-[7px] [&>summary]:cursor-pointer [&>summary]:list-none [&>summary]:text-(--ds-dim) [&>summary]:bg-(--ds-panel) [&>summary:hover]:text-(--ds-ink) [&>summary:active]:text-(--ds-ink) [&>summary:active]:bg-[#f6f8fa] open:[&>summary]:rounded-b-none [&_.ds-pre]:-mt-px [&_.ds-pre]:rounded-t-none";

const APPROVAL_BASE = "ds-approval max-w-[720px] px-[14px] pt-[11px] pb-[12px] border rounded-[10px] [&_.ds-pre]:mt-[8px]";
const APPROVAL_KIND: Record<string, string> = {
  pending: "border-[#ecd9b6] bg-[#fffcf3]",
  resolved: "border-(--ds-line) bg-(--ds-panel) opacity-80",
  expired: "border-(--ds-line) bg-(--ds-panel)",
};
const APPROVAL_HEAD = "ds-approval-head flex items-center gap-[8px] text-[11px] font-bold tracking-[0.02em]";
const APPROVAL_HEAD_KIND: Record<string, string> = {
  pending: "text-(--ds-amber)",
  resolved: "text-(--ds-dim)",
  expired: "text-(--ds-dim)",
};
const APPROVAL_TIME = "ds-approval-time ml-auto text-(--ds-faint) text-[9.5px] font-normal";
const APPROVAL_MSG = "ds-approval-msg mx-0 mt-[7px] mb-0 text-[12.5px] break-words";
const APPROVAL_DESC = "ds-approval-desc mx-0 mt-[4px] mb-0 text-[11.5px] text-(--ds-dim)";
const APPROVAL_DETAILS = "ds-approval-details px-0 py-[6px] border-y";
const APPROVAL_DETAILS_KIND: Record<string, string> = {
  pending: "border-[#f2e6c8]",
  resolved: "border-(--ds-line-soft)",
  expired: "border-(--ds-line-soft)",
};
const APPROVAL_ACTIONS = "ds-approval-actions flex items-center flex-wrap gap-[8px] mt-[10px]";
const BTN_BASE = "ds-btn px-[13px] py-[5px] border rounded-[8px] text-[11.5px] font-semibold [font-family:inherit] [line-height:inherit] cursor-pointer";
const BTN_KIND: Record<string, string> = {
  default:
    "border-(--ds-line) bg-(--ds-panel) text-(--ds-ink) hover:border-[#c9d2dd] hover:bg-[#f6f8fa] active:border-[#b9c4d0] active:bg-[#eef1f5]",
  primary:
    "border-transparent bg-(--ds-accent) text-(--ds-accent-fg) hover:bg-(--ds-accent) hover:brightness-[1.06] active:brightness-[0.93]",
  ghost:
    "border-transparent bg-transparent text-(--ds-dim) font-medium hover:text-(--ds-ink) hover:bg-[#f6f8fa] active:text-(--ds-ink) active:bg-[#eef1f5]",
};
const EDIT = "ds-edit mt-[9px] [&_label]:block [&_label]:mb-[4px] [&_label]:text-(--ds-faint) [&_label]:text-[9px] [&_label]:tracking-[0.12em] [&_label]:uppercase";
const EDIT_AREA =
  "ds-edit-area w-full min-h-[80px] px-[10px] py-[8px] border border-(--ds-line) rounded-[8px] bg-[#fbfcfd] text-(--ds-ink) [font-family:var(--ds-mono)] text-[11px] leading-[1.55] resize-y outline-none";

const ERROR = "ds-error flex items-start gap-[8px] max-w-[720px] px-[12px] py-[8px] border border-[#f3c6c6] rounded-[8px] bg-[#fef5f5] text-(--ds-red-ink) text-[12px] [&_svg]:flex-none [&_svg]:mt-[3px]";

const RUN_END =
  "ds-run-end flex items-baseline justify-between gap-[12px] mt-[4px] px-[12px] py-[9px] border-t-2 border-(--ds-accent) bg-(--ds-panel) rounded-b-[8px] text-[11.5px] font-semibold min-w-0";

const COMPOSER = "ds-composer flex-none px-[20px] pt-[8px] pb-[14px] border-t border-(--ds-line) bg-(--ds-bg) max-[720px]:px-[12px] max-[720px]:pb-[12px]";
const SUGGESTIONS = "ds-suggestions flex flex-wrap gap-[6px] max-w-[760px] mx-auto mb-[8px]";
const SUGGESTION =
  "ds-suggestion inline-flex items-center gap-[6px] px-[10px] py-[4px] border border-(--ds-line) rounded-full bg-(--ds-panel) text-(--ds-dim) [font-family:inherit] [line-height:inherit] [font-weight:inherit] text-[10.5px] cursor-pointer min-w-0 hover:text-(--ds-ink) hover:border-(--ds-accent-ink) active:text-(--ds-ink) active:border-(--ds-accent-ink) active:bg-[#f6f8fa] [&_svg]:text-(--ds-accent-ink)";
const INPUT =
  "ds-input flex items-end gap-[10px] max-w-[760px] mx-auto px-[10px] py-[8px] pl-[14px] border border-(--ds-line) rounded-[12px] bg-(--ds-panel) focus-within:border-(--ds-accent-ink) focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.12)]";
const INPUT_AREA =
  "flex-1 min-w-0 min-h-[20px] max-h-[110px] px-0 py-[3px] border-0 outline-none resize-none bg-transparent text-(--ds-ink) [font-family:inherit] [font-weight:inherit] text-[12.5px] leading-[1.55] placeholder:text-(--ds-faint) disabled:opacity-60";
const SEND_BASE = "ds-send flex-none inline-flex items-center justify-center w-[30px] h-[30px] border-0 rounded-[9px] cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed active:not-disabled:brightness-[0.93]";
const SEND_KIND: Record<string, string> = {
  send: "bg-(--ds-accent) text-(--ds-accent-fg)",
  stop: "bg-(--ds-red) text-(--ds-accent-fg)",
};

const RAIL = "ds-rail overflow-y-auto p-[8px] border-l border-(--ds-line) bg-(--ds-bg) flex flex-col gap-[8px] max-[1080px]:hidden";
const PANEL = "ds-panel px-[12px] pt-[10px] pb-[12px] bg-(--ds-panel) border border-(--ds-line) rounded-[10px] [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[8px] [&>h3]:text-(--ds-faint) [&>h3]:text-[9px] [&>h3]:font-bold [&>h3]:tracking-[0.14em]";
const KV = "ds-kv grid gap-0 m-0 [&>div]:grid [&>div]:grid-cols-[minmax(64px,0.4fr)_minmax(0,1fr)] [&>div]:gap-[8px] [&>div]:py-[4px] [&>div]:border-b [&>div]:border-(--ds-line-soft) [&>div]:items-baseline [&>div:last-child]:border-b-0 [&_dt]:text-(--ds-dim) [&_dt]:text-[10px] [&_dt]:overflow-hidden [&_dt]:text-ellipsis [&_dt]:whitespace-nowrap [&_dd]:m-0 [&_dd]:text-(--ds-ink) [&_dd]:text-[10px] [&_dd]:whitespace-pre-wrap [&_dd]:break-words [&_dd]:min-w-0 [&_dd]:max-h-[88px] [&_dd]:overflow-auto";
const RAIL_EMPTY = "ds-rail-empty m-0 text-(--ds-faint) text-[11px]";
const PANEL_FOOT = "ds-panel-foot mx-0 mt-[8px] mb-0 text-(--ds-faint) text-[9px] text-right";
const CAPS = "ds-caps flex flex-wrap gap-[5px] [&>span]:px-[8px] [&>span]:py-[2px] [&>span]:border [&>span]:border-(--ds-line) [&>span]:rounded-full [&>span]:text-(--ds-dim) [&>span]:text-[9.5px] [&>span]:[font-family:var(--ds-mono)]";


/**
 * Dash — the run as a light operations dashboard.
 *
 * A KPI strip (status / duration / tool calls / tokens) sits above a dense,
 * hairline-ruled activity feed; tools render as expandable data rows; a rail
 * on the right panelizes telemetry, shared state and capabilities. Blue-green
 * data accent, 4px spacing grid, mono numerals. Empty stores read "—", never
 * NaN.
 */
export function DashPage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const plugins = useSkinPlugins();
  const zh = isZh();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const feed = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<Record<string, string>>({});

  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries);
  // Consecutive reasoning/tool rows collapse into one hairline fold row.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);
  const tools = c.entries.filter((entry): entry is ToolEntry => entry.kind === "tool");
  const failedTools = tools.filter((tool) => tool.status === "error").length;
  const metadata = entriesOf(c.metadata ?? {});
  const stateRows: [string, unknown][] = (() => {
    const rows = entriesOf(c.sharedState);
    if (rows.length > 0) return rows;
    return isEmptyState(c.sharedState) ? [] : [["state", c.sharedState]];
  })();

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
        editedArgs = undefined; // invalid draft degrades to a plain approve
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
  const tokenLabel = (n: number) => (n ? (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)) : "—");
  const durationLabel = c.duration() ? clock(c.duration()) : "—";

  return (
    <div className="skin-dash relative flex flex-col h-full min-h-0 overflow-hidden bg-(--ds-bg) text-(--ds-ink) [font-family:var(--sk-font,Geist,Inter,system-ui,sans-serif)] text-[13px] leading-[1.55] isolate">
      {/* ── header ─────────────────────────────────────────────────── */}
      <header className={HEADER}>
        <span className="ds-brand flex items-center gap-[8px] min-w-0 text-[13px]">
          <i className={`${BRAND_DOT_BASE} ${BRAND_DOT[c.status] ?? BRAND_DOT_IDLE}`} data-status={c.status} aria-hidden="true" />
          <strong className="font-[650] whitespace-nowrap overflow-hidden text-ellipsis">{displayText(brand.agentName)}</strong>
          <span className="ds-brand-model px-[7px] py-px border border-(--ds-line) rounded-full text-(--ds-dim) text-[9.5px] mono">{displayText(brand.modelLabel)}</span>
        </span>
        <span className="ds-header-meta ml-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--ds-faint) text-[10px] mono max-[720px]:hidden">
          {brand.threadTitle || c.threadId}
          {c.runId ? ` · ${c.runId}` : ""}
        </span>
        <span className={`${PILL_BASE} ds-pill--${c.status} ${PILL_KIND[c.status] ?? PILL_KIND.idle}`}>
          <i className="w-[6px] h-[6px] rounded-full bg-current" aria-hidden="true" />
          {statusText}
        </span>
      </header>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <section className={KPI_GRID} aria-label={t("ds.overview")}>
        <div className={KPI_BASE} data-status={c.status}>
          <span className={KPI_LABEL}>{t("ds.kpi.status")}</span>
          <span className={`${KPI_VALUE_BASE} ${KPI_VALUE_PLAIN} ${KPI_STATUS_COLOR[c.status] ?? ""}`}>{statusText}</span>
          <span className={`${KPI_SUB} mono`}>{displayText(c.transport) || "—"}</span>
        </div>
        <div className={KPI_BASE}>
          <span className={KPI_LABEL}>{t("ds.kpi.duration")}</span>
          <span className={`${KPI_VALUE_BASE} ${KPI_VALUE_MONO} mono`}>{durationLabel}</span>
          <span className={`${KPI_SUB} mono`}>{c.runId || "—"}</span>
        </div>
        <div className={KPI_BASE}>
          <span className={KPI_LABEL}>{t("ds.kpi.tools")}</span>
          <span className={`${KPI_VALUE_BASE} ${KPI_VALUE_MONO} mono`}>{tools.length}</span>
          <span className={`${KPI_SUB} mono`}>
            {failedTools > 0 ? `${failedTools} ${t("ds.failed")}` : `${c.events.length} ${t("chat.events")}`}
          </span>
        </div>
        <div className={KPI_BASE}>
          <span className={KPI_LABEL}>{t("ds.kpi.tokens")}</span>
          <span className={`${KPI_VALUE_BASE} ${KPI_VALUE_MONO} mono`}>{tokenLabel(c.tokens)}</span>
          <span className={`${KPI_SUB} mono`}>{t("ds.usage")}</span>
        </div>
      </section>

      <div className={BODY}>
        {/* ── activity feed ────────────────────────────────────────── */}
        <main className={FEED_COL}>
          <div className={FEED_HEAD}>
            <span className={FEED_TITLE}>{t("ds.feed")}</span>
            <span className={`${FEED_COUNT} mono`}>{c.events.length} {t("chat.events")}</span>
          </div>
          <div className={FEED} ref={feed} role="log" aria-live="polite" aria-label={zh ? "活动流" : "Activity feed"}>
            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            {c.entries.length === 0 ? (
              <div className={EMPTY}>
                <Icon name="activity" size={16} className="text-(--ds-accent-ink)" />
                <p>{t("ds.empty")}</p>
              </div>
            ) : (
              <div className={ROWS}>
                {(() => {
                  const rowCtx = { zh, plugins, openTools, setOpenTools, openReasoning, setOpenReasoning, editingId, editJson, setEditJson, setEditingId, beginEdit, approve };
                  const rowFor = (entry: Entry) => (
                    <div key={entry.id} className={ROW} data-kind={entry.kind}>
                      {renderEntry(entry, rowCtx)}
                    </div>
                  );
                  return foldItems.map((item) => {
                    if (item.type === "entry") return rowFor(item.entry);
                    const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
                    return (
                      <FoldGroupRow
                        key={item.id}
                        groupId={item.id}
                        entries={item.entries}
                        open={open}
                        onToggle={() => setFoldOverride((prev) => ({ ...prev, [item.id]: !open }))}
                        rowFor={rowFor}
                      />
                    );
                  });
                })()}
                {c.status === "done" && (
                  <div className={RUN_END} data-testid="ds-run-end">
                    <span>{t("ds.runSummary")}</span>
                    <span className="mono text-(--ds-dim) font-normal text-[10px]">
                      {formatDuration(c.duration())} · {c.tokens} {t("chat.tokens")} · {c.events.length} {t("chat.events")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <footer className={COMPOSER}>
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
                    <Icon name="sparkle" size={11} />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className={INPUT}>
              <textarea
                rows={1}
                value={draft}
                aria-label={zh ? "消息输入框" : "Message composer"}
                placeholder={pending.length ? (zh ? "先处理上方的审批" : "Resolve the approval above first") : t("chat.placeholder")}
                disabled={pending.length > 0}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                  if (event.key === "Escape") c.stop();
                }}
                className={INPUT_AREA}
              />
              {running ? (
                <button type="button" className={`${SEND_BASE} ds-send--stop ${SEND_KIND.stop}`} onClick={() => c.stop()} aria-label={t("chat.stop")}>
                  <Icon name="stop" size={13} />
                </button>
              ) : (
                <button type="button" className={`${SEND_BASE} ${SEND_KIND.send}`} onClick={send} disabled={!draft.trim() || pending.length > 0} aria-label={t("chat.send")}>
                  <Icon name="send" size={13} />
                </button>
              )}
            </div>
          </footer>
        </main>

        {/* ── rail panels ───────────────────────────────────────────── */}
        <aside className={RAIL}>
          <section className={PANEL}>
            <h3>{t("ds.telemetry").toUpperCase()}</h3>
            {metadata.length ? (
              <dl className={KV}>
                {metadata.slice(0, 8).map(([key, value]) => (
                  <div key={key}>
                    <dt className="mono">{key}</dt>
                    <dd className="mono">{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className={RAIL_EMPTY}>{zh ? "暂无遥测数据" : "No telemetry yet"}</p>
            )}
          </section>

          <section className={PANEL}>
            <h3>{t("chat.stateTab").toUpperCase()}</h3>
            {stateRows.length ? (
              <dl className={KV}>
                {stateRows.slice(0, 10).map(([key, value]) => (
                  <div key={key}>
                    <dt className="mono">{key}</dt>
                    <dd className="mono">{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className={RAIL_EMPTY}>{zh ? "暂无快照" : "No snapshot yet"}</p>
            )}
            <p className={`${PANEL_FOOT} mono`}>STATE v{c.stateVersion}</p>
          </section>

          <section className={PANEL}>
            <h3>{t("ds.capabilities").toUpperCase()}</h3>
            <div className={CAPS}>
              {c.capabilities?.tools?.supported && <span>tools · {c.capabilities.tools.items?.length ?? 0}</span>}
              {c.capabilities?.reasoning?.supported && <span>reasoning</span>}
              {c.capabilities?.state?.supported && <span>state</span>}
              {c.capabilities?.humanInTheLoop?.supported && <span>interrupts</span>}
              {c.capabilities?.subagents?.supported && <span>subagents</span>}
              {!c.capabilities && <span className={RAIL_EMPTY}>—</span>}
            </div>
          </section>
        </aside>
      </div>
      <ProtocolDrawer />
    </div>
  );
}

/* ── feed rows ─────────────────────────────────────────────────────── */

/**
 * One hairline data row standing in for a run of consecutive thinking/tool
 * rows. Numeric summary (N steps · duration); failures always surface on the
 * row so a collapsed group cannot hide a broken tool.
 */
function FoldGroupRow({
  groupId,
  entries,
  open,
  onToggle,
  rowFor,
}: {
  groupId: string;
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
  rowFor: (entry: Entry) => React.ReactNode;
}) {
  const failures = foldGroupFailures(entries);
  const duration = foldGroupDuration(entries);
  const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
  return (
    <>
      <div className={`${FOLD_ROW}`} data-kind="fold" data-fold-id={groupId}>
        <button
          type="button"
          className={FOLD_HEAD_BASE}
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
          <span className={`${TAG_BASE} ds-tag--fold ${TAG_KIND.fold} mono`}>{t("fold.group")}</span>
          <span className={`${FOLD_SUMMARY} mono`}>
            {entries.length} {t("fold.steps")}
            {duration !== undefined ? ` · ${formatDuration(duration)}` : ""}
          </span>
          {failure ? (
            <span className={`${STAGE_BASE} ds-stage--${failure === "error" ? "error" : "interrupted"} ${STAGE_KIND[failure === "error" ? "error" : "interrupted"]}`}>
              {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
            </span>
          ) : foldGroupOpen(entries) ? (
            <span className={`${STAGE_BASE} ds-stage--running ${STAGE_KIND.running}`}>{t("chat.executing")}</span>
          ) : null}
          <Icon name="chevron" size={9} className={`${CHEV} ${open ? "rotate-[-90deg]" : "rotate-0"}`} />
        </button>
      </div>
      {open && <div className={FOLD_BODY}>{entries.map((entry) => rowFor(entry))}</div>}
    </>
  );
}

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

function renderEntry(entry: Entry, ctx: RowCtx) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="ds-user max-w-[720px] px-[12px] py-[8px] rounded-[8px] bg-[rgba(13,148,136,0.06)] border-l-2 border-(--ds-accent-ink)">
          <span className={ROW_META}>{t("chat.you")} · {timeOf(entry.at)}</span>
          <p className="m-0 whitespace-pre-wrap break-words">{entry.text}</p>
        </div>
      );
    case "assistant":
      return <AssistantRow entry={entry} />;
    case "reasoning":
      return (
        <div className={REASON}>
          <button
            type="button"
            className={REASON_HEAD}
            aria-expanded={!!ctx.openReasoning[entry.id]}
            onClick={() => ctx.setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
          >
            <Icon name="brain" size={11} />
            <span>{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
            {!!entry.tokens && <span className={`${REASON_META} mono`}>{entry.tokens} {t("chat.tokens")}</span>}
            {entry.encryptedValue && <span className={`ds-badge ds-badge--violet px-[5px] py-0 rounded-[3px] text-[8.5px] tracking-[0.06em] ${TAG_KIND.tool}`}>encrypted</span>}
            <Icon name="chevron" size={9} className={`${CHEV} ${ctx.openReasoning[entry.id] ? "rotate-[-90deg]" : "rotate-90"}`} />
          </button>
          {!!ctx.openReasoning[entry.id] && (
            <div className={REASON_BODY}>{entry.text || "encrypted reasoning item"}</div>
          )}
        </div>
      );
    case "tool":
      return <ToolRow entry={entry} open={!!ctx.openTools[entry.id]} onToggle={() => ctx.setOpenTools((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} />;
    case "plan":
      return <PlanRow entry={entry} />;
    case "step":
      return <StepRow entry={entry} />;
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

function AssistantRow({ entry }: { entry: AssistantEntry }) {
  return (
    <div className="ds-assistant max-w-[720px]">
      <span className={ROW_META}>{t("chat.assistant")} · {timeOf(entry.at)}{entry.streaming ? ` · ${t("status.writing")}` : ""}</span>
      <Markdown text={entry.text} className="md ds-md" />
      {!entry.text && entry.streaming && <span className="ds-caret inline-block w-[7px] h-[13px] bg-(--ds-accent) animate-[ds-blink_1s_steps(2)_infinite] motion-reduce:animate-none" aria-hidden="true" />}
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
  const brief = (() => {
    const args = entry.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) return "";
    return Object.entries(args as Record<string, unknown>)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .slice(0, 2)
      .map(([key, value]) => `${key}=${String(value).slice(0, 36)}`)
      .join(" · ");
  })();
  return (
    <div className={`${TOOL_BASE} ${TOOL_BORDER[toolStage(entry.status)] ?? TOOL_BORDER_IDLE}${open ? " is-open" : ""}`} data-stage={toolStage(entry.status)}>
      <button type="button" className={TOOL_ROW} aria-expanded={open} onClick={onToggle}>
        <span className={`${TAG_BASE} ds-tag--tool ${TAG_KIND.tool} mono`}>{t("ds.tool")}</span>
        <span className={`${TOOL_NAME} mono`}>{displayText(entry.name)}</span>
        <span className={`${TOOL_BRIEF} mono`}>{brief}</span>
        <span className={`${STAGE_BASE} ds-stage--${toolStage(entry.status)} ${STAGE_KIND[toolStage(entry.status)] ?? STAGE_KIND.done}`}>{stageWord(entry.status)}</span>
        <span className={`${TOOL_TIME} mono`}>{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
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

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className={PLAN}>
      <div className={PLAN_HEAD}>
        <span className={`${TAG_BASE} ds-tag--plan ${TAG_KIND.plan} mono`}>{t("wb.node.plan")}</span>
        <span className={PLAN_TITLE}>{displayText(entry.title)}</span>
        <span className={`${PLAN_COUNT} mono`}>
          {view.steps.filter((step) => step.state === "done").length}/{view.steps.length || 0}
        </span>
      </div>
      {view.rawOnly ? (
        <pre className={`${PRE} mono`}>{planRawText(view)}</pre>
      ) : (
        <ul className={PLAN_LIST}>
          {view.steps.map((step) => (
            <li key={step.id} data-state={step.state} className={`${PLAN_LI_BASE} ${PLAN_LI[step.state] ?? PLAN_LI_IDLE}`}>
              <span className={`${PLAN_CHECK_BASE} ${PLAN_CHECK_KIND[step.state] ?? PLAN_CHECK_IDLE}`}>{step.state === "done" && <Icon name="check" size={10} />}</span>
              {step.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepRow({ entry }: { entry: StepEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "failed" ? t("chat.failed") : t("chat.done");
  return (
    <div className={STEP} data-status={entry.status}>
      <span className={`${STEP_DOT_BASE} ${STEP_DOT[entry.status] ?? STEP_DOT_IDLE}`} aria-hidden="true" />
      <span>{displayText(entry.name)}</span>
      <span className={ROW_META}>{word}</span>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "error" ? t("chat.failed") : t("chat.done");
  const stage = entry.status === "running" ? "running" : entry.status === "error" ? "error" : "done";
  return (
    <div className={SUBAGENT} data-status={entry.status}>
      <span className={`${TAG_BASE} ds-tag--sub ${TAG_KIND.sub} mono`}>{t("wb.node.subagent")}</span>
      <span>{displayText(entry.name)}</span>
      <span className={`${STAGE_BASE} ds-stage--${stage} ${STAGE_KIND[stage]}`}>{word}</span>
      {entry.detail && <span className={SUBAGENT_DETAIL}>{displayText(entry.detail)}</span>}
    </div>
  );
}

function CustomRow({ entry, plugins }: { entry: CustomEntry; plugins: ReturnType<typeof useSkinPlugins> }) {
  const plugin = plugins.custom?.(entry);
  if (plugin) return <div className={CUSTOM}>{plugin}</div>;
  return (
    <details className={CUSTOM}>
      <summary className="mono">
        <span className={`${TAG_BASE} ds-tag--custom ${TAG_KIND.custom} mono`}>{t("wb.node.custom")}</span>
        <span>{displayText(entry.name)}</span>
        <Icon name="chevron" size={9} className={`${CHEV} rotate-0`} />
      </summary>
      <pre className={`${PRE} mono`}>{safeJson(entry.value, 2)}</pre>
    </details>
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
    <div className={`${APPROVAL_BASE} ${APPROVAL_KIND[kind]}${pendingCard ? " is-pending" : " is-resolved"}`} data-expired={entry.expired || undefined}>
      <div className={`${APPROVAL_HEAD} ${APPROVAL_HEAD_KIND[kind]}`}>
        <Icon name={entry.expired ? "clock" : "shield"} size={13} />
        <span>{headWord}</span>
        <span className={`${APPROVAL_TIME} mono`}>{timeOf(entry.at)}</span>
      </div>
      <p className={APPROVAL_MSG}>{displayText(entry.message)}</p>
      {entry.description && <p className={APPROVAL_DESC}>{displayText(entry.description)}</p>}
      {!!entry.details.length && (
        <dl className={`${KV} ${APPROVAL_DETAILS} ${APPROVAL_DETAILS_KIND[kind]}`}>
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
            <button type="button" className={`${BTN_BASE} ds-btn--primary ${BTN_KIND.primary}`} onClick={() => ctx.approve(entry, true, true)}>
              {ctx.editingId === entry.id ? t("intr.approveEdited") : t("intr.approve")}
            </button>
            <button type="button" className={`${BTN_BASE} ${BTN_KIND.default}`} onClick={() => ctx.approve(entry, false, false)}>
              {t("intr.deny")}
            </button>
            <button
              type="button"
              className={`${BTN_BASE} ds-btn--ghost ${BTN_KIND.ghost}`}
              onClick={() => (ctx.editingId === entry.id ? ctx.setEditingId(null) : ctx.beginEdit(entry.id))}
            >
              {ctx.editingId === entry.id ? t("intr.cancel") : t("intr.edit")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorRow({ entry }: { entry: ErrorEntry }) {
  return (
    <div className={ERROR} role="alert">
      <Icon name="x" size={12} />
      <span>{displayText(entry.message)}</span>
    </div>
  );
}

export default {
  id: "dash",
  name: "Dash",
  tagline: "Ops dashboard · KPI run strip",
  swatch: ["#f7f8fa", "#ffffff", "#0f766e"] as [string, string, string],
  ChatPage: DashPage,
};
