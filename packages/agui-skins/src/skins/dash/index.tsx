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
    <div className="skin-dash">
      {/* ── header ─────────────────────────────────────────────────── */}
      <header className="ds-header">
        <span className="ds-brand">
          <i className="ds-brand-dot" data-status={c.status} aria-hidden="true" />
          <strong>{displayText(brand.agentName)}</strong>
          <span className="ds-brand-model mono">{displayText(brand.modelLabel)}</span>
        </span>
        <span className="ds-header-meta mono">
          {brand.threadTitle || c.threadId}
          {c.runId ? ` · ${c.runId}` : ""}
        </span>
        <span className={`ds-pill ds-pill--${c.status}`}>
          <i aria-hidden="true" />
          {statusText}
        </span>
      </header>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <section className="ds-kpis" aria-label={t("ds.overview")}>
        <div className="ds-kpi" data-status={c.status}>
          <span className="ds-kpi-label">{t("ds.kpi.status")}</span>
          <span className="ds-kpi-value">{statusText}</span>
          <span className="ds-kpi-sub mono">{displayText(c.transport) || "—"}</span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi-label">{t("ds.kpi.duration")}</span>
          <span className="ds-kpi-value mono">{durationLabel}</span>
          <span className="ds-kpi-sub mono">{c.runId || "—"}</span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi-label">{t("ds.kpi.tools")}</span>
          <span className="ds-kpi-value mono">{tools.length}</span>
          <span className="ds-kpi-sub mono">
            {failedTools > 0 ? `${failedTools} ${t("ds.failed")}` : `${c.events.length} ${t("chat.events")}`}
          </span>
        </div>
        <div className="ds-kpi">
          <span className="ds-kpi-label">{t("ds.kpi.tokens")}</span>
          <span className="ds-kpi-value mono">{tokenLabel(c.tokens)}</span>
          <span className="ds-kpi-sub mono">{t("ds.usage")}</span>
        </div>
      </section>

      <div className="ds-body">
        {/* ── activity feed ────────────────────────────────────────── */}
        <main className="ds-feed-col">
          <div className="ds-feed-head">
            <span className="ds-feed-title">{t("ds.feed")}</span>
            <span className="ds-feed-count mono">{c.events.length} {t("chat.events")}</span>
          </div>
          <div className="ds-feed" ref={feed} role="log" aria-live="polite" aria-label={zh ? "活动流" : "Activity feed"}>
            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            {c.entries.length === 0 ? (
              <div className="ds-empty">
                <Icon name="activity" size={16} />
                <p>{t("ds.empty")}</p>
              </div>
            ) : (
              <div className="ds-rows">
                {(() => {
                  const rowCtx = { zh, plugins, openTools, setOpenTools, openReasoning, setOpenReasoning, editingId, editJson, setEditJson, setEditingId, beginEdit, approve };
                  const rowFor = (entry: Entry) => (
                    <div key={entry.id} className="ds-row" data-kind={entry.kind}>
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
                  <div className="ds-run-end" data-testid="ds-run-end">
                    <span>{t("ds.runSummary")}</span>
                    <span className="mono">
                      {formatDuration(c.duration())} · {c.tokens} {t("chat.tokens")} · {c.events.length} {t("chat.events")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <footer className="ds-composer">
            {!!c.suggestions.length && (
              <div className="ds-suggestions" role="list" aria-label={zh ? "建议" : "Suggestions"}>
                {c.suggestions.slice(0, 4).map((suggestion, index) => (
                  <button
                    key={`suggestion-${index}`}
                    type="button"
                    role="listitem"
                    className="ds-suggestion"
                    onClick={() => setDraft(suggestion)}
                  >
                    <Icon name="sparkle" size={11} />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="ds-input">
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
              />
              {running ? (
                <button type="button" className="ds-send ds-send--stop" onClick={() => c.stop()} aria-label={t("chat.stop")}>
                  <Icon name="stop" size={13} />
                </button>
              ) : (
                <button type="button" className="ds-send" onClick={send} disabled={!draft.trim() || pending.length > 0} aria-label={t("chat.send")}>
                  <Icon name="send" size={13} />
                </button>
              )}
            </div>
          </footer>
        </main>

        {/* ── rail panels ───────────────────────────────────────────── */}
        <aside className="ds-rail">
          <section className="ds-panel">
            <h3>{t("ds.telemetry").toUpperCase()}</h3>
            {metadata.length ? (
              <dl className="ds-kv">
                {metadata.slice(0, 8).map(([key, value]) => (
                  <div key={key}>
                    <dt className="mono">{key}</dt>
                    <dd className="mono">{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="ds-rail-empty">{zh ? "暂无遥测数据" : "No telemetry yet"}</p>
            )}
          </section>

          <section className="ds-panel">
            <h3>{t("chat.stateTab").toUpperCase()}</h3>
            {stateRows.length ? (
              <dl className="ds-kv">
                {stateRows.slice(0, 10).map(([key, value]) => (
                  <div key={key}>
                    <dt className="mono">{key}</dt>
                    <dd className="mono">{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="ds-rail-empty">{zh ? "暂无快照" : "No snapshot yet"}</p>
            )}
            <p className="ds-panel-foot mono">STATE v{c.stateVersion}</p>
          </section>

          <section className="ds-panel">
            <h3>{t("ds.capabilities").toUpperCase()}</h3>
            <div className="ds-caps">
              {c.capabilities?.tools?.supported && <span>tools · {c.capabilities.tools.items?.length ?? 0}</span>}
              {c.capabilities?.reasoning?.supported && <span>reasoning</span>}
              {c.capabilities?.state?.supported && <span>state</span>}
              {c.capabilities?.humanInTheLoop?.supported && <span>interrupts</span>}
              {c.capabilities?.subagents?.supported && <span>subagents</span>}
              {!c.capabilities && <span className="ds-rail-empty">—</span>}
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
      <div className="ds-row ds-row--fold" data-kind="fold" data-fold-id={groupId}>
        <button
          type="button"
          className="ds-fold-head"
          data-fold-head=""
          aria-expanded={open}
          aria-label={t("fold.group")}
          onClick={onToggle}
          onKeyDown={(event) => {
            // explicit for the keydown contract test (jsdom runs no activation)
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggle();
            }
          }}
        >
          <span className="ds-tag ds-tag--fold mono">{t("fold.group")}</span>
          <span className="ds-fold-summary mono">
            {entries.length} {t("fold.steps")}
            {duration !== undefined ? ` · ${formatDuration(duration)}` : ""}
          </span>
          {failure ? (
            <span className={`ds-stage ds-stage--${failure === "error" ? "error" : "interrupted"}`}>
              {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
            </span>
          ) : foldGroupOpen(entries) ? (
            <span className="ds-stage ds-stage--running">{t("chat.executing")}</span>
          ) : null}
          <Icon name="chevron" size={9} className="ds-chev" />
        </button>
      </div>
      {open && <div className="ds-fold-body">{entries.map((entry) => rowFor(entry))}</div>}
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
        <div className="ds-user">
          <span className="ds-row-meta">{t("chat.you")} · {timeOf(entry.at)}</span>
          <p>{entry.text}</p>
        </div>
      );
    case "assistant":
      return <AssistantRow entry={entry} />;
    case "reasoning":
      return (
        <div className="ds-reason">
          <button
            type="button"
            className="ds-reason-head"
            aria-expanded={!!ctx.openReasoning[entry.id]}
            onClick={() => ctx.setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
          >
            <Icon name="brain" size={11} />
            <span>{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
            {!!entry.tokens && <span className="ds-reason-meta mono">{entry.tokens} {t("chat.tokens")}</span>}
            {entry.encryptedValue && <span className="ds-badge ds-badge--violet">encrypted</span>}
            <Icon name="chevron" size={9} className="ds-chev" />
          </button>
          {!!ctx.openReasoning[entry.id] && (
            <div className="ds-reason-body">{entry.text || "encrypted reasoning item"}</div>
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
    <div className="ds-assistant">
      <span className="ds-row-meta">{t("chat.assistant")} · {timeOf(entry.at)}{entry.streaming ? ` · ${t("status.writing")}` : ""}</span>
      <Markdown text={entry.text} className="md ds-md" />
      {!entry.text && entry.streaming && <span className="ds-caret" aria-hidden="true" />}
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
    <div className={`ds-tool ${open ? "is-open" : ""}`} data-stage={toolStage(entry.status)}>
      <button type="button" className="ds-tool-row" aria-expanded={open} onClick={onToggle}>
        <span className="ds-tag ds-tag--tool mono">{t("ds.tool")}</span>
        <span className="ds-tool-name mono">{displayText(entry.name)}</span>
        <span className="ds-tool-brief mono">{brief}</span>
        <span className={`ds-stage ds-stage--${toolStage(entry.status)}`}>{stageWord(entry.status)}</span>
        <span className="ds-tool-time mono">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
        <Icon name="chevron" size={9} className="ds-chev" />
      </button>
      {open && (
        <div className="ds-tool-body">
          <pre className="ds-pre mono">{displayText(entry.argsRaw) || safeJson(entry.args, 2)}</pre>
          <ToolResult entry={entry} variant="particle" />
          {entry.error && <p className="ds-tool-error">{displayText(entry.error)}</p>}
        </div>
      )}
      {!open && entry.status === "error" && <p className="ds-tool-error">{displayText(entry.error) || t("chat.failed")}</p>}
    </div>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className="ds-plan">
      <div className="ds-plan-head">
        <span className="ds-tag ds-tag--plan mono">{t("wb.node.plan")}</span>
        <span className="ds-plan-title">{displayText(entry.title)}</span>
        <span className="ds-plan-count mono">
          {view.steps.filter((step) => step.state === "done").length}/{view.steps.length || 0}
        </span>
      </div>
      {view.rawOnly ? (
        <pre className="ds-pre mono">{planRawText(view)}</pre>
      ) : (
        <ul className="ds-plan-list">
          {view.steps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <span className="ds-plan-check">{step.state === "done" && <Icon name="check" size={10} />}</span>
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
    <div className="ds-step" data-status={entry.status}>
      <span className="ds-step-dot" aria-hidden="true" />
      <span>{displayText(entry.name)}</span>
      <span className="ds-row-meta">{word}</span>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "error" ? t("chat.failed") : t("chat.done");
  return (
    <div className="ds-subagent" data-status={entry.status}>
      <span className="ds-tag ds-tag--sub mono">{t("wb.node.subagent")}</span>
      <span>{displayText(entry.name)}</span>
      <span className={`ds-stage ds-stage--${entry.status === "running" ? "running" : entry.status === "error" ? "error" : "done"}`}>{word}</span>
      {entry.detail && <span className="ds-subagent-detail">{displayText(entry.detail)}</span>}
    </div>
  );
}

function CustomRow({ entry, plugins }: { entry: CustomEntry; plugins: ReturnType<typeof useSkinPlugins> }) {
  const plugin = plugins.custom?.(entry);
  if (plugin) return <div className="ds-custom">{plugin}</div>;
  return (
    <details className="ds-custom">
      <summary className="mono">
        <span className="ds-tag ds-tag--custom mono">{t("wb.node.custom")}</span>
        <span>{displayText(entry.name)}</span>
        <Icon name="chevron" size={9} className="ds-chev" />
      </summary>
      <pre className="ds-pre mono">{safeJson(entry.value, 2)}</pre>
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
  return (
    <div className={`ds-approval ${pendingCard ? "is-pending" : "is-resolved"}`} data-expired={entry.expired || undefined}>
      <div className="ds-approval-head">
        <Icon name={entry.expired ? "clock" : "shield"} size={13} />
        <span>{headWord}</span>
        <span className="ds-approval-time mono">{timeOf(entry.at)}</span>
      </div>
      <p className="ds-approval-msg">{displayText(entry.message)}</p>
      {entry.description && <p className="ds-approval-desc">{displayText(entry.description)}</p>}
      {!!entry.details.length && (
        <dl className="ds-kv ds-approval-details">
          {entry.details.map((detail, index) => (
            <div key={`detail-${index}`}>
              <dt>{displayText(detail.label)}</dt>
              <dd className="mono">{displayText(detail.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.responseSchema && <pre className="ds-pre mono">{safeJson(entry.responseSchema, 2)}</pre>}
      {pendingCard && (
        <>
          {ctx.editingId === entry.id && (
            <div className="ds-edit">
              <label className="mono">{t("intr.edit")}</label>
              <textarea
                aria-label={ctx.zh ? "编辑参数" : "Edit arguments"}
                value={ctx.editJson[entry.id] ?? ""}
                onChange={(event) => ctx.setEditJson((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                spellCheck={false}
              />
            </div>
          )}
          <div className="ds-approval-actions">
            <button type="button" className="ds-btn ds-btn--primary" onClick={() => ctx.approve(entry, true, true)}>
              {ctx.editingId === entry.id ? t("intr.approveEdited") : t("intr.approve")}
            </button>
            <button type="button" className="ds-btn" onClick={() => ctx.approve(entry, false, false)}>
              {t("intr.deny")}
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
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
    <div className="ds-error" role="alert">
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
