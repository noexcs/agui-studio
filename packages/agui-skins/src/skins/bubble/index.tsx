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
    <div className="skin-bubble">
      <header className="bb-topbar">
        <span className="bb-avatar" aria-hidden="true">{displayText(brand.agentName).slice(0, 1).toUpperCase()}</span>
        <span className="bb-topbar-id">
          <strong>{displayText(brand.agentName)}</strong>
          <span className={`bb-topbar-status bb-topbar-status--${c.status}`}>{statusText}</span>
        </span>
        <span className="bb-topbar-model mono">{displayText(brand.modelLabel)}</span>
      </header>

      <main className="bb-chat" ref={scroller} role="log" aria-live="polite" aria-label={zh ? "对话" : "Conversation"}>
        <div className="bb-thread">
          {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
          {c.entries.length === 0 && (
            <div className="bb-empty">
              <span className="bb-empty-dot" aria-hidden="true" />
              <p className="bb-empty-title">{t("bb.empty")}</p>
              <p className="bb-empty-sub mono">{displayText(brand.modelLabel)} · {c.threadId}</p>
            </div>
          )}
          {foldItems.map((item) => {
            if (item.type === "entry") {
              return <Row key={item.entry.id} entry={item.entry} ctx={{ zh, plugins, openTools, setOpenTools, openReasoning, setOpenReasoning, editingId, editJson, setEditJson, setEditingId, beginEdit, approve }} />;
            }
            const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
            const failures = foldGroupFailures(item.entries);
            const stats = foldGroupStats(item.entries);
            const preview = stats.toolNames.slice(0, 2).join(", ");
            const extra = stats.toolNames.length - 2;
            const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
            return (
              <div key={item.id} className="bb-row bb-row--in">
                <div className="bb-card bb-card--fold" data-fold-id={item.id}>
                  <button
                    type="button"
                    className="bb-fold-head"
                    aria-expanded={open}
                    aria-label={t("fold.group")}
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
                    <span className="bb-fold-title">{t("fold.group")}</span>
                    <span className="bb-fold-summary mono">
                      {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
                      {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
                      {preview}
                      {extra > 0 && ` +${extra} ${t("fold.more")}`}
                    </span>
                    {failure ? (
                      <span className={`bb-chip bb-chip--${failure}`}>{failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}</span>
                    ) : foldGroupOpen(item.entries) ? (
                      <span className="bb-chip bb-chip--running">{t("chat.executing")}</span>
                    ) : (
                      <span className="bb-chip bb-chip--done">{`${item.entries.length} ${t("fold.steps")}`}</span>
                    )}
                    <Icon name="chevron" size={9} className="bb-chev" />
                  </button>
                  {open && (
                    <div className="bb-fold-items">
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
            <div className="bb-row bb-row--in" data-testid="bb-typing">
              <div className="bb-bubble bb-bubble--in bb-typing" role="status" aria-label={t("bb.typing")}>
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="bb-dock">
        {!!c.suggestions.length && (
          <div className="bb-suggestions" role="list" aria-label={zh ? "建议" : "Suggestions"}>
            {c.suggestions.slice(0, 4).map((suggestion, index) => (
              <button
                key={`suggestion-${index}`}
                type="button"
                role="listitem"
                className="bb-suggestion"
                onClick={() => setDraft(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <div className={`bb-composer ${running ? "is-running" : ""}`}>
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
          />
          {running ? (
            <button type="button" className="bb-send bb-send--stop" onClick={() => c.stop()} aria-label={t("chat.stop")}>
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button type="button" className="bb-send" onClick={send} disabled={!draft.trim() || pending.length > 0} aria-label={t("chat.send")}>
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
    <div className="bb-row bb-row--out">
      <div className="bb-stack">
        <div className="bb-bubble bb-bubble--out">
          <p>{entry.text}</p>
        </div>
        <span className="bb-time">{t("chat.you")} · {timeOf(entry.at)}</span>
      </div>
    </div>
  );
};

function AssistantRow({ entry }: { entry: AssistantEntry }) {
  return (
    <div className="bb-row bb-row--in">
      <div className="bb-stack">
        <div className="bb-bubble bb-bubble--in">
          <Markdown text={entry.text} className="md bb-md" />
          {entry.streaming && !entry.text && <span className="bb-caret" aria-hidden="true" />}
        </div>
        <span className="bb-time">
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
    <div className="bb-row bb-row--in">
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
    <div className={`bb-card bb-card--tool ${open ? "is-open" : ""}`} data-stage={toolStage(entry.status)}>
      <button type="button" className="bb-tool-head" aria-expanded={open} onClick={onToggle}>
        <Icon name="wrench" size={11} />
        <span className="bb-tool-name mono">{displayText(entry.name)}</span>
        {brief && <span className="bb-tool-brief mono">{brief}</span>}
        <span className={`bb-chip bb-chip--${toolStage(entry.status)}`}>{stageWord(entry.status)}</span>
        {entry.durationMs ? <span className="bb-tool-time mono">{formatDuration(entry.durationMs)}</span> : null}
        <Icon name="chevron" size={9} className="bb-chev" />
      </button>
      {open && (
        <div className="bb-tool-body">
          <pre className="bb-pre mono">{displayText(entry.argsRaw) || safeJson(entry.args, 2)}</pre>
          <ToolResult entry={entry} variant="particle" />
          {entry.error && <p className="bb-tool-error">{displayText(entry.error)}</p>}
        </div>
      )}
      {!open && entry.status === "error" && <p className="bb-tool-error">{displayText(entry.error) || t("chat.failed")}</p>}
    </div>
  );
}

function ReasoningRow({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  return (
    <div className="bb-row bb-row--in">
      <div className="bb-stack">
        <ReasonCard entry={entry} open={open} onToggle={onToggle} />
      </div>
    </div>
  );
}

/** The reason pill (+ body) without its chat-row wrapper — reused in fold groups. */
function ReasonCard({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button type="button" className={`bb-reason ${open ? "is-open" : ""}`} aria-expanded={open} onClick={onToggle}>
        <Icon name="brain" size={11} />
        <span>{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
        {!!entry.tokens && <span className="bb-reason-meta mono">{entry.tokens} {t("chat.tokens")}</span>}
        {entry.encryptedValue && <span className="bb-reason-badge">enc</span>}
        <Icon name="chevron" size={9} className="bb-chev" />
      </button>
      {open && (
        <div className="bb-bubble bb-bubble--in bb-reason-body">
          {entry.text || "encrypted reasoning item"}
          {entry.encryptedValue && <pre className="bb-pre mono">{entry.encryptedValue.slice(0, 140)}</pre>}
        </div>
      )}
    </>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className="bb-row bb-row--in">
      <div className="bb-card bb-card--plan">
        <div className="bb-card-head">
          <Icon name="layers" size={11} />
          <span className="bb-card-title">{displayText(entry.title)}</span>
          <span className="bb-chip bb-chip--plan mono">{t("wb.node.plan")}</span>
        </div>
        {view.rawOnly ? (
          <pre className="bb-pre mono">{planRawText(view)}</pre>
        ) : (
          <ul className="bb-plan-list">
            {view.steps.map((step) => (
              <li key={step.id} data-state={step.state}>
                <span className="bb-plan-check">{step.state === "done" && <Icon name="check" size={9} />}</span>
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
    <div className="bb-row bb-row--center">
      <span className="bb-pill" data-status={entry.status}>
        {displayText(entry.name)} · {word}
      </span>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "error" ? t("chat.failed") : t("chat.done");
  return (
    <div className="bb-row bb-row--center">
      <span className="bb-pill" data-status={entry.status}>
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
      <div className="bb-row bb-row--in">
        <div className="bb-card">{plugin}</div>
      </div>
    );
  }
  return (
    <div className="bb-row bb-row--in">
      <details className="bb-card bb-card--custom">
        <summary>
          <span className="bb-chip bb-chip--custom mono">{t("wb.node.custom")}</span>
          <span className="bb-card-title mono">{displayText(entry.name)}</span>
          <Icon name="chevron" size={9} className="bb-chev" />
        </summary>
        <pre className="bb-pre mono">{safeJson(entry.value, 2)}</pre>
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
  return (
    <div className="bb-row bb-row--in">
      <div className={`bb-card bb-card--approval ${pendingCard ? "is-pending" : "is-resolved"}`} data-expired={entry.expired || undefined}>
        <div className="bb-card-head">
          <Icon name={entry.expired ? "clock" : "shield"} size={12} />
          <span className="bb-card-title">{headWord}</span>
          <span className="bb-time mono">{timeOf(entry.at)}</span>
        </div>
        <p className="bb-card-msg">{displayText(entry.message)}</p>
        {entry.description && <p className="bb-card-desc">{displayText(entry.description)}</p>}
        {!!entry.details.length && (
          <dl className="bb-details">
            {entry.details.map((detail, index) => (
              <div key={`detail-${index}`}>
                <dt>{displayText(detail.label)}</dt>
                <dd className="mono">{displayText(detail.value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {entry.responseSchema && <pre className="bb-pre mono">{safeJson(entry.responseSchema, 2)}</pre>}
        {pendingCard && (
          <>
            {ctx.editingId === entry.id && (
              <div className="bb-edit">
                <label className="mono">{t("intr.edit")}</label>
                <textarea
                  aria-label={ctx.zh ? "编辑参数" : "Edit arguments"}
                  value={ctx.editJson[entry.id] ?? ""}
                  onChange={(event) => ctx.setEditJson((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                  spellCheck={false}
                />
              </div>
            )}
            <div className="bb-approval-actions">
              <button type="button" className="bb-btn bb-btn--primary" onClick={() => ctx.approve(entry, true, true)}>
                {ctx.editingId === entry.id ? t("intr.approveEdited") : t("intr.approve")}
              </button>
              <button type="button" className="bb-btn" onClick={() => ctx.approve(entry, false, false)}>
                {t("intr.deny")}
              </button>
              <button
                type="button"
                className="bb-btn bb-btn--ghost"
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
    <div className="bb-row bb-row--in">
      <div className="bb-card bb-card--error" role="alert">
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
