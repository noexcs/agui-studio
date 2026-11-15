import { useMemo, useState } from "react";
import { useConversation, useSkinPlugins } from "../../host";
import type { Entry, InterruptEntry, PlanEntry, ReasoningEntry, ToolEntry } from "../../contract";
import { formatDuration } from "../../utils";
import { plainText } from "../../utils";
import { ToolResult } from "../../shared/ToolResult";
import { planView, planRawText } from "../../shared/plan";
import { displayText, entriesOf, isEmptyState, safeJson } from "../../shared/safe";
import { t, isZh } from "../../i18n";
import { useSkinBranding } from "../../host";
import { Icon } from "../../shared/Icon";
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
import "./classic.css";

/* ═══ Tailwind migration (task-13 Phase 2b) ═══
   Element styling became utilities beside the semantic class names; values
   reference the .skin-classic tokens via arbitrary var shorthand, so
   --sk-accent tuning and the guarded accent variables keep flowing.
   classic.css keeps only tokens/keyframes/the box-sizing reset/.mono/
   .cl-md/scrollbar/focus ring/reduced-motion plus the accent-guard color
   rules. Same-property state branches are written branch-exclusive
   (§1.6-1): status / btn / approval / tool-status / fold-flag /
   subagent-status / plan-state maps carry full values, base strings keep
   none of those properties. Chevron rotation stays a ternary, never a
   shared constant plus an appended rotate-0. */

const ROW_BASE = "cl-row gap-[10px] animate-[cl-in_0.28s_ease]";
const ROW_KIND: Record<string, string> = {
  user: "flex justify-end",
  assistant: "flex items-start group",
  wide: "block pl-[36px]",
};
const AVATAR =
  "cl-avatar cl-avatar--sm h-[26px] w-[26px] rounded-full grid place-items-center flex-none text-[10px] font-semibold bg-(--accent-soft) text-[var(--accent-ink,var(--accent))]";

const STATUS_BASE =
  "cl-status inline-flex items-center gap-[5px] h-[24px] px-[9px] rounded-full text-[11px] border whitespace-nowrap";
const STATUS_KIND: Record<string, string> = {
  running: "text-[var(--accent-ink,var(--accent))] bg-(--accent-soft) border-[#bfdbfe]",
  interrupted: "text-(--warn-text) bg-(--warn-bg) border-(--warn-border)",
  done: "text-(--success) bg-[#eff6ff] border-[#bfdbfe]",
  error: "text-(--danger) bg-[#fef2f2] border-[#fecaca]",
  stopped: "text-[#52525b] bg-[#f4f4f5] border-[#d4d4d8]",
};
const STATUS_IDLE = "text-(--text-2) bg-[#f3f4f6] border-(--border)";
const STATUS_DOT: Record<string, string> = {
  running: "bg-(--accent)",
  interrupted: "bg-[#d97706]",
  done: "bg-(--success)",
  error: "bg-(--danger)",
  stopped: "bg-[#71717a]",
};
const STATUS_DOT_IDLE = "bg-(--faint)";

/* primary keeps only layout here — its text color lives in the test-anchored
   .cl-btn--primary residual rule (accent guard) */
const BTN_BASE =
  "cl-btn inline-flex items-center gap-[6px] h-[30px] px-[11px] rounded-[7px] border text-[12px] font-medium cursor-pointer disabled:opacity-45 disabled:cursor-default";
const BTN_KIND: Record<string, string> = {
  default: "border-(--border-2) bg-(--surface) text-(--text) hover:bg-[#f9fafb] hover:border-[#9ca3af]",
  primary: "cl-btn--primary border-(--accent) bg-(--accent) hover:bg-(--accent-2) hover:border-(--accent-2)",
};

const APPROVAL_BASE = "cl-approval rounded-[8px] px-[14px] py-[12px] border";
const APPROVAL_KIND: Record<string, string> = {
  pending: "border-(--warn-border) border-l-[3px] border-l-[#d97706] bg-(--warn-bg)",
  resolved: "border-(--border) border-l-[3px] border-l-(--success) bg-[#f9fafb]",
  expired: "border-dashed border-(--border) border-l-[3px] border-l-[#71717a] bg-[#f9fafb]",
};
const APPROVAL_HEAD = "cl-approval-head flex items-center gap-[7px] text-[12px] mb-[6px] [&_strong]:font-semibold";
const APPROVAL_HEAD_KIND: Record<string, string> = {
  pending: "text-(--warn-text)",
  resolved: "text-(--success)",
  expired: "text-[#52525b]",
};
const APPROVAL_TIME = "cl-approval-time ml-auto text-[10px] text-(--faint)";
const APPROVAL_TITLE = "cl-approval-title mt-0 mb-[3px] text-[13.5px] font-semibold text-(--text)";
const APPROVAL_DESC = "cl-approval-desc mt-0 mb-[10px] text-[12px] text-(--text-2)";
const APPROVAL_TERMS =
  "cl-approval-terms grid grid-cols-3 gap-px mx-0 mt-0 mb-[12px] bg-(--border) border border-(--border) rounded-[6px] overflow-hidden [&>div]:bg-(--surface) [&>div]:px-[10px] [&>div]:py-[7px] [&_dt]:text-[10px] [&_dt]:text-(--muted) [&_dt]:mb-px [&_dd]:m-0 [&_dd]:text-[12.5px] [&_dd]:font-medium [&_dd]:text-(--text)";
const APPROVAL_ACTIONS = "cl-approval-actions flex items-center gap-[8px]";
const LINK = "cl-link border-0 bg-transparent text-[11.5px] cursor-pointer underline underline-offset-2";

const TOOL_STATUS: Record<string, string> = {
  done: "text-(--success)",
  executing: "text-[var(--accent-ink,var(--accent))]",
  error: "text-(--danger)",
};
const TOOL_STATUS_IDLE = "text-(--muted)";

const FOLD_HEAD =
  "cl-fold-head flex items-center gap-[7px] w-full px-[10px] py-[7px] border border-dashed border-(--border-2) rounded-[7px] bg-[#fafbfc] text-(--muted) text-[11.5px] text-left cursor-pointer min-w-0 [font-family:inherit] hover:bg-[#f3f4f6] active:bg-[#eef0f3]";
const FOLD_SUMMARY = "cl-fold-summary text-(--faint) overflow-hidden text-ellipsis whitespace-nowrap min-w-0";
const FOLD_FLAG = "cl-fold-flag flex-none px-[7px] py-px rounded-full text-[10px]";
const FOLD_FLAG_KIND: Record<string, string> = {
  error: "text-(--danger) bg-[rgba(220,38,38,0.07)]",
  interrupted: "text-(--warn-text) bg-(--warn-bg)",
  live: "text-(--accent) bg-(--accent-soft)",
};
const FOLD_COUNT = "cl-fold-count ml-auto text-(--faint) text-[10px]";

const REASON =
  "cl-reason flex items-center gap-[7px] w-full px-[10px] py-[7px] border border-dashed border-(--border-2) rounded-[7px] bg-[#fafbfc] text-(--muted) text-[11.5px] text-left cursor-pointer hover:bg-[#f3f4f6]";
const REASON_META = "cl-reason-meta ml-auto text-(--faint)";
const REASON_BODY =
  "cl-reason-body mt-[6px] px-[11px] py-[9px] border-l-2 border-(--border-2) text-(--text-2) text-[12px] leading-[1.6] whitespace-pre-wrap";
const CHEV = "cl-chev [transition:transform_0.2s]";

const TOOL_BOX = "cl-tool border border-(--border) rounded-[8px] bg-(--surface) overflow-hidden";
const TOOL_HEAD =
  "cl-tool-head flex items-center gap-[9px] w-full px-[11px] py-[8px] border-0 bg-[#fafbfc] text-left cursor-pointer hover:bg-[#f3f4f6]";
const TOOL_NAME = "cl-tool-name text-[11.5px] text-(--text) font-medium";
const TOOL_TIME = "cl-tool-time ml-auto text-(--faint) text-[10px]";
const TOOL_ARGS =
  "cl-tool-args m-0 px-[12px] py-[10px] border-t border-(--border) bg-[#f9fafb] [font-family:var(--mono)] text-[11px] leading-[1.55] text-(--text-2) max-h-[150px] overflow-auto whitespace-pre-wrap";

const PLAN_LI_BASE = "flex items-center gap-[8px] text-[12px]";
const PLAN_LI: Record<string, string> = {
  active: "text-(--text)",
  done: "text-(--text-2)",
  pending: "text-(--muted)",
};
const CHECK_BASE = "cl-check w-[14px] h-[14px] border rounded-[4px] grid place-items-center flex-none text-[#fff]";
const CHECK_KIND: Record<string, string> = {
  done: "border-(--success) bg-(--success)",
  other: "border-(--border-2)",
};

const MUTED = "cl-muted m-0 text-[11.5px] text-(--faint)";
const CAPS =
  "cl-caps flex flex-wrap gap-[5px] [&>span]:px-[7px] [&>span]:py-[2px] [&>span]:border [&>span]:border-(--border) [&>span]:rounded-full [&>span]:bg-[#f9fafb] [&>span]:text-[10.5px] [&>span]:text-(--text-2)";
const SUBAGENT = "cl-subagent flex items-center gap-[8px] px-[10px] py-[7px] border border-(--border) rounded-[7px] bg-[#fafbfc] text-[12px]";
const SUB_STATUS_BASE =
  "cl-subagent-status text-[10px] px-[6px] py-px rounded-full border uppercase tracking-[0.04em]";
const SUB_STATUS_KIND: Record<string, string> = {
  running: "text-[var(--accent-ink,var(--accent))] border-[#bfdbfe] bg-(--accent-soft)",
  done: "text-[var(--accent-ink,var(--accent))] border-(--border)",
  error: "text-(--danger) border-[#fecaca] bg-[#fef2f2]",
};


/**
 * Classic — the conservative, enterprise-safe surface.
 * Light neutral canvas, system font, 1px borders, one blue accent.
 */
export function ClassicPage() {
  const c = useConversation();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const plugins = useSkinPlugins();
  const brand = useSkinBranding();
  const scroller = useStickToBottom<HTMLDivElement>();
  const zh = isZh();
  const [draft, setDraft] = useState("");
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<Record<string, string>>({});

  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries)[0];
  // Consecutive reasoning/tool rows collapse into one neutral fold row.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);
  // Multiple ACTIVITY_SNAPSHOTs are allowed: list every plan, not just the first.
  const plans = c.entries.filter((e): e is PlanEntry => e.kind === "plan");
  const interrupts = c.entries.filter((e): e is InterruptEntry => e.kind === "interrupt");
  const lastAssistant = [...c.entries].reverse().find((e) => e.kind === "assistant");
  // A shared-state snapshot is not guaranteed to be a plain object. `entriesOf`
  // returns [] for scalars and index keys for arrays; the scalar row keeps real
  // data visible without ever calling Object.keys on a non-object.
  const stateRows: [string, unknown][] = (() => {
    const entries = entriesOf(c.sharedState);
    if (entries.length > 0) return entries;
    return isEmptyState(c.sharedState) ? [] : [["state", c.sharedState]];
  })();

  const statusText = running
    ? zh
      ? "运行中"
      : "Running"
    : c.status === "interrupted"
    ? zh
      ? "等待确认"
      : "Awaiting approval"
    : c.status === "done"
    ? zh
      ? "已完成"
      : "Completed"
    : c.status === "error"
    ? zh
      ? "出错"
      : "Error"
    : c.status === "stopped"
    ? zh
      ? "已停止"
      : "Stopped"
    : zh
    ? "空闲"
    : "Idle";

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  function beginEdit(id?: string) {
    const target = id
      ? c.entries.find((e): e is InterruptEntry => e.kind === "interrupt" && e.id === id && e.status === "pending")
      : pending;
    if (!target) return;
    const tool = c.entries.find((e): e is ToolEntry => e.kind === "tool" && e.id === target.toolCallId);
    // Draft state is keyed by interrupt id: several pending cards must never
    // share an editor or submit each other's args.
    setEditJson((prev) => ({ ...prev, [target.id]: JSON.stringify(tool?.args ?? {}, null, 2) }));
    setEditingId(target.id);
  }

  function approve(id?: string) {
    if (id && editingId === id) {
      try {
        c.resolveInterrupt(true, JSON.parse(editJson[id] ?? ""), id);
      } catch {
        c.resolveInterrupt(true, undefined, id);
      }
    } else {
      c.resolveInterrupt(true, undefined, id);
    }
    setEditingId(null);
  }

  return (
    <div className="skin-classic grid grid-cols-[minmax(0,1fr)_300px] h-full bg-(--bg) text-(--text) [font-family:var(--sans)] text-[13.5px] leading-[1.55] [-webkit-font-smoothing:antialiased] max-[1280px]:grid-cols-[minmax(0,1fr)]">

      {/* ── conversation ──────────────────────────────────────────── */}
      <main className="cl-main flex flex-col min-w-0 min-h-0">
        <header className="cl-head flex items-center justify-between gap-[16px] h-[64px] px-[20px] bg-(--surface) border-b border-(--border)">
          <div className="cl-head-id flex items-center gap-[10px] min-w-0">
            <span className="cl-agent-avatar grid h-[34px] w-[34px] place-items-center rounded-[8px] bg-(--accent-soft) text-[var(--accent-ink,var(--accent))] text-[11px] font-semibold flex-none">AI</span>
            <div>
              <div className="cl-head-title text-[13.5px] font-semibold">{brand.agentName}</div>
              <div className="cl-head-sub text-[10.5px] text-(--faint) mono">
                {brand.modelLabel} · {c.threadId} · {c.runId}
              </div>
            </div>
          </div>
          <div className="cl-head-actions flex items-center gap-[8px]">
            <span className={`${STATUS_BASE} cl-status--${c.status} ${STATUS_KIND[c.status] ?? STATUS_IDLE}`}>
              <i className={`h-[5px] w-[5px] rounded-full ${STATUS_DOT[c.status] ?? STATUS_DOT_IDLE}`} />
              {statusText}
            </span>
          </div>
        </header>

        <div className="cl-scroll flex-1 min-h-0 overflow-y-auto px-[24px] pt-[20px] pb-[8px] max-[860px]:px-[14px] max-[860px]:pt-[16px] max-[860px]:pb-[6px]" ref={scroller}>
          <div className="cl-stack max-w-[760px] mx-auto flex flex-col gap-[18px]">
            {c.entries.length === 0 && (
              <div className="cl-empty text-center text-(--muted) py-[60px] text-[12.5px]">
                <Icon name="activity" size={18} className="mx-auto mb-[10px] text-(--faint)" />

                <p>{zh ? "输入一条消息开始对话。" : "Send a message to start the conversation."}</p>
              </div>
            )}

            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            {(() => {
              const ctx: ClCtx = {
                zh,
                brand,
                plugins,
                openReasoning,
                setOpenReasoning,
                openTools,
                setOpenTools,
                editingId,
                editJson,
                setEditJson,
                setEditingId,
                beginEdit,
                approve,
                deny: (id: string) => c.resolveInterrupt(false, undefined, id),
              };
              return foldItems.map((item) => {
                if (item.type === "entry") return entryRow(item.entry, ctx);
                const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
                return (
                  <FoldGroupRow
                    key={item.id}
                    groupId={item.id}
                    entries={item.entries}
                    open={open}
                    onToggle={() => setFoldOverride((prev) => ({ ...prev, [item.id]: !open }))}
                    ctx={ctx}
                  />
                );
              });
            })()}

            {c.status === "done" && c.entries.length > 0 && (
              <div className="cl-run-end pl-[36px] flex items-center justify-between gap-[12px] pt-[6px] border-t border-(--border) text-[10.5px] text-(--faint)">
                <span>{zh ? "本轮结束" : "Run finished"}</span>
                <span className="mono">
                  {formatDuration(c.duration())} · {c.tokens} tokens · {c.events.length} events
                </span>
              </div>
            )}
          </div>
        </div>

        <footer className="cl-composer px-[24px] pt-[10px] pb-[16px] bg-(--bg) max-[860px]:px-[12px] max-[860px]:pt-[8px] max-[860px]:pb-[12px]">
          {c.suggestions.length > 0 && (
            <div className="cl-suggestions flex items-center flex-wrap gap-[6px] px-[2px] pb-[8px]" role="list" aria-label={zh ? "建议" : "Suggestions"}>
              {c.suggestions.map((text) => (
                <button
                  key={text}
                  role="listitem"
                  className="cl-suggestion inline-flex items-center gap-[6px] max-w-full h-[26px] px-[10px] border border-(--border) rounded-full bg-(--surface) text-(--text-2) text-[11.5px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap [transition:border-color_0.15s,background_0.15s,color_0.15s] hover:border-(--accent) hover:bg-[#f0f6ff] hover:text-[var(--accent-ink,var(--accent))]"
                  title={zh ? "填入输入框" : "Insert into the composer"}
                  onClick={() => setDraft(text)}
                >
                  <Icon name="sparkle" size={12} />
                  {text}
                </button>
              ))}
            </div>
          )}
          <div className="cl-composer-box max-w-[760px] mx-auto border border-(--border-2) rounded-[10px] bg-(--surface) shadow-[0_1px_2px_rgba(16,24,40,0.04)] [transition:border-color_0.15s,box-shadow_0.15s] focus-within:border-(--accent) focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]">
            <textarea
              rows={1}
              value={draft}
              aria-label={zh ? "消息输入框" : "Message composer"}
              placeholder={zh ? "输入消息，Enter 发送，Shift+Enter 换行" : "Message the assistant — Enter to send, Shift+Enter for a new line"}
              onChange={(e) => setDraft(e.target.value)}
              className="block w-full min-h-[40px] max-h-[132px] px-[12px] pt-[11px] pb-[4px] border-0 outline-none resize-none bg-transparent [font-family:inherit] text-[13.5px] leading-[1.55] text-(--text) placeholder:text-(--faint)"

              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 132) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") c.stop();
              }}
            />
            <div className="cl-composer-bar flex items-center justify-between pl-[10px] pr-[8px] pt-[4px] pb-[8px]">
            <div className="cl-composer-tools flex items-center gap-[4px]">
              <button className="cl-tool-chip inline-flex items-center gap-[5px] h-[24px] px-[8px] border border-(--border) rounded-[6px] bg-[#fafbfc] text-(--muted) text-[11px] cursor-pointer hover:bg-[#f3f4f6] hover:text-(--text)"><Icon name="wrench" size={12} />{zh ? "工具" : "Tools"} · 4</button>
              <button className="cl-tool-chip mono inline-flex items-center gap-[5px] h-[24px] px-[8px] border border-(--border) rounded-[6px] bg-[#fafbfc] text-(--muted) text-[11px] cursor-pointer hover:bg-[#f3f4f6] hover:text-(--text)">{brand.modelLabel}</button>
            </div>
              {running ? (
                <button className={`${BTN_BASE} ${BTN_KIND.default}`} onClick={() => c.stop()}>
                  <Icon name="stop" size={12} />
                  {t("chat.stop")}
                </button>
              ) : (
                <button className={`${BTN_BASE} ${BTN_KIND.primary}`} onClick={send} disabled={!draft.trim()}>
                  {t("chat.send")}
                  <Icon name="send" size={13} />
                </button>
              )}
            </div>
          </div>
        </footer>
      </main>

      {/* ── context / details ─────────────────────────────────────── */}
        <aside className="cl-details flex flex-col min-h-0 overflow-y-auto bg-(--surface) border-l border-(--border) max-[1280px]:hidden">
          <div className="cl-details-head flex items-center justify-between h-[56px] px-[14px] border-b border-(--border) text-[12.5px]">
            <strong>{zh ? "会话详情" : "Session details"}</strong>
          </div>

        <section className="cl-panel px-[14px] py-[12px] border-b border-(--border) [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[8px] [&>h3]:text-[10.5px] [&>h3]:font-semibold [&>h3]:tracking-[0.06em] [&>h3]:uppercase [&>h3]:text-(--faint)">
          <h3>{zh ? "运行" : "Run"}</h3>
          <dl className="cl-kv m-0 flex flex-col gap-px [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-[10px] [&>div]:py-[3px] [&_dt]:text-[11px] [&_dt]:text-(--muted) [&_dd]:m-0 [&_dd]:text-[11px] [&_dd]:text-(--text) [&_dd]:text-right [&_dd]:overflow-hidden [&_dd]:text-ellipsis [&_dd]:whitespace-nowrap [&_dd]:max-w-[62%]">
            <div><dt>{zh ? "会话" : "Thread"}</dt><dd className="mono">{c.threadId}</dd></div>
            <div><dt>{zh ? "轮次" : "Run"}</dt><dd className="mono">{c.runId}</dd></div>
            <div><dt>{zh ? "状态" : "Status"}</dt><dd>{statusText}</dd></div>
            <div><dt>{zh ? "事件" : "Events"}</dt><dd className="mono">{c.events.length}</dd></div>
            <div><dt>{zh ? "词元" : "Tokens"}</dt><dd className="mono">{c.tokens}</dd></div>
          </dl>
        </section>

        <section className="cl-panel px-[14px] py-[12px] border-b border-(--border) [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[8px] [&>h3]:text-[10.5px] [&>h3]:font-semibold [&>h3]:tracking-[0.06em] [&>h3]:uppercase [&>h3]:text-(--faint)">
          <h3>{zh ? "元数据" : "Metadata"}</h3>
          {Object.keys(c.metadata ?? {}).length ? (
            <dl className="cl-kv m-0 flex flex-col gap-px [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-[10px] [&>div]:py-[3px] [&_dt]:text-[11px] [&_dt]:text-(--muted) [&_dd]:m-0 [&_dd]:text-[11px] [&_dd]:text-(--text) [&_dd]:text-right [&_dd]:overflow-hidden [&_dd]:text-ellipsis [&_dd]:whitespace-nowrap [&_dd]:max-w-[62%]">
              {Object.entries(c.metadata ?? {}).map(([key, value]) => (
                <div key={key}>
                  <dt className="mono">{key}</dt>
                  <dd className="mono">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={MUTED}>{zh ? "暂无元数据" : "No metadata yet"}</p>
          )}
        </section>

        <section className="cl-panel px-[14px] py-[12px] border-b border-(--border) [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[8px] [&>h3]:text-[10.5px] [&>h3]:font-semibold [&>h3]:tracking-[0.06em] [&>h3]:uppercase [&>h3]:text-(--faint)">
          <h3>{zh ? "能力" : "Capabilities"}</h3>
          <div className={CAPS}>
            {c.capabilities?.tools?.supported && <span>tools · {c.capabilities.tools.items?.length ?? 0}</span>}
            {c.capabilities?.reasoning?.supported && <span>reasoning</span>}
            {c.capabilities?.state?.supported && <span>state</span>}
            {c.capabilities?.humanInTheLoop?.supported && <span>interrupts</span>}
            {c.capabilities?.subagents?.supported && <span>subagents</span>}
          </div>
        </section>

        <section className="cl-panel px-[14px] py-[12px] border-b border-(--border) [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[8px] [&>h3]:text-[10.5px] [&>h3]:font-semibold [&>h3]:tracking-[0.06em] [&>h3]:uppercase [&>h3]:text-(--faint)">
          <h3>{zh ? "计划" : "Plan"}</h3>
          {plans.length ? (
            plans.map((plan, index) => {
              const view = planView(plan);
              return (
                <div key={plan.id} className={`cl-plan-block border border-(--border) rounded-[8px] bg-(--surface) overflow-hidden${index ? " mt-[10px]" : ""}`}>
                  <div className="cl-plan-title px-[12px] py-[7px] bg-[#fafbfc] border-b border-(--border) text-[11px] text-(--muted) mono">{displayText(plan.title)}</div>
                  {view.rawOnly ? (
                    <pre className="cl-plan-raw m-0 px-[12px] py-[10px] bg-[#f9fafb] [font-family:var(--mono)] text-[11px] leading-[1.55] text-(--text-2) whitespace-pre-wrap break-words" data-skin-text="">{planRawText(view)}</pre>
                  ) : (
                    <ul className="cl-plan m-0 px-[12px] py-[8px] list-none flex flex-col gap-[4px]">
                      {view.steps.map((step) => (
                        <li key={step.id} data-state={step.state} className={`${PLAN_LI_BASE} ${PLAN_LI[step.state] ?? PLAN_LI.pending}`}>
                          <span className={`${CHECK_BASE} ${CHECK_KIND[step.state === "done" ? "done" : "other"]}`}>
                            {step.state === "done" ? <Icon name="check" size={10} /> : null}
                          </span>
                          {step.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          ) : (
            <p className={MUTED}>{zh ? "暂无计划" : "No plan yet"}</p>
          )}
        </section>

        <section className="cl-panel px-[14px] py-[12px] border-b border-(--border) [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[8px] [&>h3]:text-[10.5px] [&>h3]:font-semibold [&>h3]:tracking-[0.06em] [&>h3]:uppercase [&>h3]:text-(--faint)">
          <h3>{zh ? "共享状态" : "Shared state"}</h3>
          {stateRows.length ? (
            <dl className="cl-kv m-0 flex flex-col gap-px [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-[10px] [&>div]:py-[3px] [&_dt]:text-[11px] [&_dt]:text-(--muted) [&_dd]:m-0 [&_dd]:text-[11px] [&_dd]:text-(--text) [&_dd]:text-right [&_dd]:overflow-hidden [&_dd]:text-ellipsis [&_dd]:whitespace-nowrap [&_dd]:max-w-[62%]">
              {stateRows.map(([key, value]) => (
                <div key={key}>
                  <dt className="mono">{key}</dt>
                  <dd className="mono">
                    {value && typeof value === "object"
                      ? Array.isArray(value)
                        ? `[${value.length}]`
                        : `{${Object.keys(value).length}}`
                      : displayText(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={MUTED}>{zh ? "暂无快照" : "No snapshot yet"}</p>
          )}
          <div className="cl-version mt-[8px] text-[9.5px] text-(--faint) tracking-[0.04em] mono">STATE v{c.stateVersion}</div>
        </section>

        <section className="cl-panel px-[14px] py-[12px] border-b border-(--border) [&>h3]:mx-0 [&>h3]:mt-0 [&>h3]:mb-[8px] [&>h3]:text-[10.5px] [&>h3]:font-semibold [&>h3]:tracking-[0.06em] [&>h3]:uppercase [&>h3]:text-(--faint)">
          <h3>{zh ? "需要你处理" : "Needs you"}</h3>
          {interrupts.filter((i) => i.status === "pending").length ? (
            interrupts
              .filter((i) => i.status === "pending")
              .map((i) => (
                <p key={i.id} className="cl-attention flex items-start gap-[6px] mx-0 mt-0 mb-[6px] px-[9px] py-[7px] border border-(--warn-border) bg-(--warn-bg) rounded-[6px] text-[11.5px] text-(--warn-text) leading-[1.45]">
                  <Icon name="shield" size={12} />
                  {plainText(i.message, 60)}
                </p>
              ))
          ) : (
            <p className={MUTED}>{zh ? "没有待处理项" : "Nothing pending"}</p>
          )}
        </section>
      </aside>
      <ProtocolDrawer />
    </div>
  );
}

/* ── rows ─────────────────────────────────────────────────────────── */

interface ClCtx {
  zh: boolean;
  brand: ReturnType<typeof useSkinBranding>;
  plugins: ReturnType<typeof useSkinPlugins>;
  openReasoning: Record<string, boolean>;
  setOpenReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  openTools: Record<string, boolean>;
  setOpenTools: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingId: string | null;
  editJson: Record<string, string>;
  setEditJson: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  beginEdit: (id?: string) => void;
  approve: (id?: string) => void;
  deny: (id: string) => void;
}

/** The transcript row for one entry, exactly as rendered before fold groups
    existed — fold group bodies reuse this verbatim. */
function entryRow(entry: Entry, ctx: ClCtx): React.ReactNode {
  const { zh } = ctx;
  if (entry.kind === "user") {
    return (
      <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.user}`}>
        <div className="cl-bubble max-w-[76%] bg-[#f3f4f6] border border-(--border) rounded-[10px_10px_3px_10px] px-[12px] py-[9px]">
          <div className="cl-bubble-meta text-[10px] text-(--faint) mb-[3px]">{zh ? "你" : "You"} · {timeOf(entry.at)}</div>
          <p className="m-0 text-[13.5px] text-(--text) whitespace-pre-wrap">{entry.text}</p>
        </div>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.assistant}`}>
        <span className={AVATAR}>AI</span>
        <div className="cl-msg flex-1 min-w-0">
          <div className="cl-msg-meta flex items-center gap-[8px] mb-[4px] text-[11px] text-(--faint) [&_strong]:text-[12px] [&_strong]:text-(--text) [&_strong]:font-semibold">
            <strong>{ctx.brand.agentName}</strong>
            <span>{timeOf(entry.at)}</span>
            {entry.streaming && <span className="cl-streaming text-[var(--accent-ink,var(--accent))]">{zh ? "生成中…" : "streaming…"}</span>}
          </div>
          {entry.text ? (
            <Markdown className={`cl-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
          ) : (
            <div className="cl-md"><span className="cl-caret inline-block w-[2px] h-[1em] bg-(--accent) animate-[cl-blink_1s_steps(2)_infinite] motion-reduce:animate-none" /></div>
          )}
          {!entry.streaming && (
            <div className="cl-msg-actions flex gap-[4px] mt-[8px] opacity-0 [transition:opacity_0.2s] group-hover:opacity-100">
              <button className="inline-flex items-center gap-[4px] h-[24px] px-[8px] border border-transparent rounded-[6px] bg-transparent text-(--muted) text-[11px] cursor-pointer hover:bg-[#f3f4f6] hover:border-(--border) hover:text-(--text)" onClick={() => navigator.clipboard?.writeText(entry.text)}>
                <Icon name="copy" size={12} />
                {t("chat.copy")}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (entry.kind === "reasoning") {
    return (
      <ReasoningRow
        key={entry.id}
        entry={entry}
        open={!!ctx.openReasoning[entry.id]}
        onToggle={() => ctx.setOpenReasoning((p) => ({ ...p, [entry.id]: !p[entry.id] }))}
      />
    );
  }
  if (entry.kind === "tool") {
    return (
      <ToolRow
        key={entry.id}
        entry={entry}
        open={!!ctx.openTools[entry.id]}
        onToggle={() => ctx.setOpenTools((p) => ({ ...p, [entry.id]: !p[entry.id] }))}
      />
    );
  }
  if (entry.kind === "plan") {
    return <PlanRow key={entry.id} entry={entry} />;
  }
  if (entry.kind === "interrupt") {
    const approvalKind = entry.status === "pending" ? "pending" : entry.expired ? "expired" : "resolved";
    return (
      <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.wide}`}>
        <div className={`${APPROVAL_BASE} ${APPROVAL_KIND[approvalKind]}`}>
          <div className={`${APPROVAL_HEAD} ${APPROVAL_HEAD_KIND[approvalKind]}`}>
            <Icon name={entry.status === "pending" ? "shield" : entry.expired ? "clock" : "check"} size={14} />
            <strong>
              {entry.status === "pending"
                ? zh
                  ? "需要你的确认"
                  : "Approval required"
                : entry.status === "approved"
                ? zh
                  ? "已批准"
                  : "Approved"
                : entry.expired
                ? zh
                  ? "已过期"
                  : "Expired"
                : zh
                ? "已拒绝"
                : "Declined"}
            </strong>
            <span className={APPROVAL_TIME}>{timeOf(entry.at)}</span>
          </div>
          <p className={APPROVAL_TITLE}>{entry.message}</p>
          {entry.description && <p className={APPROVAL_DESC}>{entry.description}</p>}
          {entry.details.length > 0 && (
            <dl className={APPROVAL_TERMS}>
              {entry.details.map((d) => (
                <div key={d.label}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {entry.status === "pending" ? (
            <>
              <div className={APPROVAL_ACTIONS}>
                <button className={`${BTN_BASE} ${BTN_KIND.primary}`} onClick={() => ctx.approve(entry.id)}>
                  <Icon name="check" size={13} />
                  {t("intr.approve")}
                </button>
                <button className={`${BTN_BASE} ${BTN_KIND.default}`} onClick={() => ctx.deny(entry.id)}>
                  <Icon name="x" size={13} />
                  {t("intr.deny")}
                </button>
                <button className={LINK} onClick={() => ctx.beginEdit(entry.id)}>{t("intr.edit")}</button>
              </div>
              {ctx.editingId === entry.id && (
                <div className="cl-edit mt-[10px] pt-[10px] border-t border-(--warn-border) [&_label]:block [&_label]:text-[10.5px] [&_label]:text-(--muted) [&_label]:mb-[5px]">
                  <label>{zh ? "提交参数（可修改后批准）" : "Arguments submitted on resume"}</label>
                  <textarea
                    value={ctx.editJson[entry.id] ?? ""}
                    onChange={(e) => ctx.setEditJson((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                    spellCheck={false}
                    className="w-full min-h-[90px] resize-y border border-(--border-2) rounded-[6px] px-[10px] py-[8px] [font-family:var(--mono)] text-[11px] leading-[1.55] text-(--text) bg-[#fff] outline-none focus:border-(--accent) focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                  />
                  <div className={APPROVAL_ACTIONS}>
                    <button className={`${BTN_BASE} ${BTN_KIND.primary}`} onClick={() => ctx.approve(entry.id)}>{t("intr.approveEdited")}</button>
                    <button className={`${BTN_BASE} ${BTN_KIND.default}`} onClick={() => ctx.setEditingId(null)}>{t("intr.cancel")}</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className={`cl-approval-resolved flex items-center gap-[6px] m-0 text-[11.5px] ${entry.expired ? "text-(--muted)" : "text-(--success)"}`}>
              <Icon name={entry.expired ? "clock" : "check"} size={12} />
              {entry.status === "approved" ? t("intr.approvedBy") : entry.expired ? t("intr.expired") : t("intr.deniedBy")}
            </p>
          )}
        </div>
      </div>
    );
  }
  if (entry.kind === "subagent") {
    return (
      <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.assistant}`}>
        <span className={AVATAR}><Icon name="layers" size={12} /></span>
        <div className="cl-msg flex-1 min-w-0">
          <div className={SUBAGENT}>
            <strong>{displayText(entry.name)}</strong>
            <span className={`${SUB_STATUS_BASE} cl-subagent-status--${entry.status} ${SUB_STATUS_KIND[entry.status] ?? SUB_STATUS_KIND.done}`}>{entry.status}</span>
            {entry.detail && <span className={MUTED}>{entry.detail}</span>}
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === "step") {
    const stepStatus = entry.status === "running" ? "running" : entry.status === "failed" ? "error" : "done";
    return (
      <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.assistant}`}>
        <span className={AVATAR}><Icon name="activity" size={12} /></span>
        <div className="cl-msg flex-1 min-w-0">
          <div className={SUBAGENT}>
            <strong>{displayText(entry.name)}</strong>
            <span className={`${SUB_STATUS_BASE} cl-subagent-status--${stepStatus} ${SUB_STATUS_KIND[stepStatus]}`}>
              {entry.status}
            </span>
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === "custom") {
    const custom = ctx.plugins.custom?.(entry);
    if (custom !== undefined) {
      return (
        <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.wide}`}>
          {custom}
        </div>
      );
    }
    return (
      <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.wide}`}>
        <div className="cl-custom flex flex-col gap-[6px]">
          <span className="cl-custom-name text-[10.5px] text-(--muted) uppercase tracking-[0.06em] mono">{displayText(entry.name)}</span>
          <pre className="cl-custom-args m-0 px-[10px] py-[8px] border border-(--border) rounded-[6px] bg-[#fafbfc] [font-family:var(--mono)] text-[11.5px] leading-[1.5] text-(--text-2) overflow-x-auto" data-skin-text="">{safeJson(entry.value, 2)}</pre>
        </div>
      </div>
    );
  }
  if (entry.kind === "error") {
    return (
      <div key={entry.id} className={`${ROW_BASE} ${ROW_KIND.wide}`}>
        <div className="cl-error border border-[#fecaca] bg-[#fef2f2] text-[#991b1b] rounded-[8px] px-[12px] py-[10px] text-[12px]">{entry.message}</div>
      </div>
    );
  }
  return null;
}

/**
 * One neutral fold row standing in for a run of consecutive thinking/tool
 * rows. Enterprise-plain: chevron + count + failures in words; the original
 * rows render inside when unfolded (right-rail detail panel is unaffected).
 */
function FoldGroupRow({
  groupId,
  entries,
  open,
  onToggle,
  ctx,
}: {
  groupId: string;
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
  ctx: ClCtx;
}) {
  const stats = foldGroupStats(entries);
  const failures = foldGroupFailures(entries);
  const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
  const summary = (
    <>
      {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
      {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
      {stats.toolCount > 0 && `${stats.toolCount} ${t("chat.tools")}`}
      {stats.reasoningCount === 0 && stats.toolCount === 0 && `0 ${t("fold.steps")}`}
    </>
  );
  return (
    <>
      <div key={groupId} className={`${ROW_BASE} ${ROW_KIND.assistant}`}>
        <span className={AVATAR}><Icon name="layers" size={12} /></span>
        <div className="cl-msg flex-1 min-w-0">
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
            <Icon name="chevron" size={11} className={`${CHEV}${open ? " rotate-90" : ""}`} />
            <span>{t("fold.group")}</span>
            <span className={FOLD_SUMMARY}>{summary}</span>
            {failure && (
              <span className={`${FOLD_FLAG} cl-fold-flag--${failure} ${FOLD_FLAG_KIND[failure]}`}>
                {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
              </span>
            )}
            {!failure && foldGroupOpen(entries) && <span className={`${FOLD_FLAG} cl-fold-flag--live ${FOLD_FLAG_KIND.live}`}>{t("chat.executing")}</span>}
            <span className={FOLD_COUNT}>{`${entries.length} ${t("fold.steps")}`}</span>
          </button>
        </div>
      </div>
      {open && <div className="cl-fold-body [&>*:first-child]:mt-[2px]" data-fold-id={groupId}>{entries.map((entry) => entryRow(entry, ctx))}</div>}
    </>
  );
}

/* ── rows ─────────────────────────────────────────────────────────── */

function ReasoningRow({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  const zh = isZh();
  return (
    <div className={`${ROW_BASE} ${ROW_KIND.assistant}`}>
      <span className={AVATAR}>AI</span>
      <div className="cl-msg flex-1 min-w-0">
        <button className={REASON} onClick={onToggle}>
          <Icon name="brain" size={12} />
          <span>{entry.streaming ? (zh ? "思考中…" : "Thinking…") : zh ? "思考过程" : "Reasoning"}</span>
          <span className={`${REASON_META} mono`}>{entry.streaming ? "" : formatDuration(entry.durationMs ?? 0)}</span>
          <Icon name="chevron" size={11} className={`${CHEV}${open ? " rotate-90" : ""}`} />
        </button>
        {open && <div className={REASON_BODY} data-skin-text="">{entry.text}</div>}
      </div>
    </div>
  );
}

function ToolRow({ entry, open, onToggle }: { entry: ToolEntry; open: boolean; onToggle: () => void }) {
  const zh = isZh();
  return (
    <div className={`${ROW_BASE} ${ROW_KIND.assistant}`}>
      <span className={AVATAR}>
        <Icon name="wrench" size={12} />
      </span>
      <div className="cl-msg flex-1 min-w-0">
        <div className={TOOL_BOX}>
          <button className={TOOL_HEAD} onClick={onToggle}>
            <span className={`${TOOL_NAME} mono`}>{displayText(entry.name)}</span>
            <span className={`cl-tool-status cl-tool-status--${entry.status} text-[10px] ${TOOL_STATUS[entry.status] ?? TOOL_STATUS_IDLE}`}>
              {entry.status === "args"
                ? zh
                  ? "接收参数"
                  : "Arguments"
                : entry.status === "executing"
                ? zh
                  ? "执行中"
                  : "Running"
                : entry.status === "interrupted"
                ? zh
                  ? "已暂停"
                  : "Paused"
                : entry.status === "done"
                ? zh
                  ? "已完成"
                  : "Done"
                : zh
                ? "失败"
                : "Failed"}
            </span>
            <span className={`${TOOL_TIME} mono`}>{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
            <Icon name="chevron" size={11} className={`${CHEV}${open ? " rotate-90" : ""}`} />
          </button>
          {open && <pre className={TOOL_ARGS} data-skin-text="">{displayText(entry.argsRaw) || "…"}</pre>}
          <ToolResult entry={entry} variant="classic" />
        </div>
      </div>
    </div>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const zh = isZh();
  const view = planView(entry);
  return (
    <div className={`${ROW_BASE} ${ROW_KIND.assistant}`}>
      <span className={AVATAR}>
        <Icon name="layers" size={12} />
      </span>
      <div className="cl-msg flex-1 min-w-0">
        <div className="cl-plan-card border border-(--border) rounded-[8px] bg-(--surface) overflow-hidden">
          <div className="cl-plan-head flex items-center justify-between px-[12px] py-[8px] bg-[#fafbfc] border-b border-(--border) text-[12px]">
            <strong>{displayText(entry.title)}</strong>
            <span className="mono">
              {view.steps.filter((s) => s.state === "done").length}/{view.steps.length}
            </span>
          </div>
          {view.rawOnly ? (
            <pre className="cl-plan-raw m-0 px-[12px] py-[10px] bg-[#f9fafb] [font-family:var(--mono)] text-[11px] leading-[1.55] text-(--text-2) whitespace-pre-wrap break-words" data-skin-text="">{planRawText(view)}</pre>
          ) : (
            <ul className="cl-plan m-0 px-[12px] py-[8px] list-none flex flex-col gap-[4px]">
              {view.steps.map((step) => (
                <li key={step.id} data-state={step.state} className={`${PLAN_LI_BASE} ${PLAN_LI[step.state] ?? PLAN_LI.pending}`}>
                  <span className={`${CHECK_BASE} ${CHECK_KIND[step.state === "done" ? "done" : "other"]}`}>
                    {step.state === "done" ? <Icon name="check" size={10} /> : null}
                  </span>
                  {step.label}
                  {step.state === "active" && <em className="cl-plan-active ml-auto text-[10px] text-[var(--accent-ink,var(--accent))]">{zh ? "进行中" : "in progress"}</em>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default {
  id: "classic",
  name: "Classic",
  tagline: "Neutral · enterprise-safe",
  swatch: ["#f7f8fa", "#ffffff", "#2563eb"] as [string, string, string],
  ChatPage: ClassicPage,
};
