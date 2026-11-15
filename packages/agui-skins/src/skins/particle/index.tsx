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
import "./particle.css";

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
    <div className="skin-particle">
      <div className="pt-bg" aria-hidden="true">
        <i className="pt-orb pt-orb--a" />
        <i className="pt-orb pt-orb--b" />
        <div className="pt-grid" />
      </div>

      <div className="pt-shell">
        <header className="pt-topbar">
          <div className="pt-brand">
            <span className="pt-hero-dot" data-status={c.status} />
            <strong>{displayText(brand.agentName || "AG-UI")}</strong>
            <span className="pt-brand-sub">{displayText(brand.modelLabel || c.transport)}</span>
          </div>
          <div className="pt-topmeta">
            <span className="pt-run mono">{displayText(c.runId)}</span>
            <span>{c.tokens ? `${Math.round(c.tokens / 100) / 10}k tokens` : "— tokens"}</span>
            <span>{running ? clock(c.duration()) : c.status}</span>
          </div>
        </header>

        <div className="pt-main">
          <main className="pt-transcript" ref={scroller} role="log" aria-live="polite" aria-label="Conversation">
            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            <div className="pt-feed">
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
                    <div key={item.entry.id} className="pt-entry" data-kind={item.entry.kind}>
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
                  <div key={item.id} className="pt-entry pt-entry--fold" data-kind="fold" data-fold-id={item.id}>
                    <div className="pt-fold">
                      <button
                        type="button"
                        className="pt-fold-head"
                        data-fold-head=""
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
                        <Icon name="layers" size={12} />
                        <span>{t("fold.group")}</span>
                        <span className="pt-fold-summary">
                          {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
                          {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
                          {preview}
                          {extra > 0 && ` +${extra} ${t("fold.more")}`}
                        </span>
                        {failure ? (
                          <span className={`pt-fold-flag pt-fold-flag--${failure}`}>
                            {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
                          </span>
                        ) : foldGroupOpen(item.entries) ? (
                          <span className="pt-fold-flag pt-fold-flag--live">{t("chat.executing")}</span>
                        ) : null}
                        <Icon name="chevron" size={11} className="pt-chev" />
                      </button>
                      {open && (
                        <div className="pt-fold-items">
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
              <p className="pt-empty">
                {zh ? "问点什么，粒子会先替你把答案聚拢。" : "Ask something — the field will gather the answer first."}
              </p>
            )}
            </div>
          </main>

          <aside className="pt-aside">
            {!!metadata.length && (
              <section className="pt-panel">
                <h3>{zh ? "元数据" : "Metadata"}</h3>
                <dl className="pt-kv">
                  {metadata.slice(0, 8).map(([key, value]) => (
                    <div key={key}>
                      <dt>{displayText(key)}</dt>
                      <dd>{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className="pt-panel">
              <h3>{zh ? "共享状态" : "Shared state"}</h3>
              {stateEntries.length ? (
                <dl className="pt-kv">
                  {stateEntries.slice(0, 10).map(([key, value]) => (
                    <div key={key}>
                      <dt>{displayText(key)}</dt>
                      <dd>{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : !isEmptyState(c.sharedState) ? (
                <pre className="pt-pre">{displayText(c.sharedState)}</pre>
              ) : (
                <p className="pt-muted">{zh ? "暂无状态" : "No state yet"}</p>
              )}
              <p className="pt-version">v{c.stateVersion}</p>
            </section>

            <section className="pt-panel pt-capabilities">
              <h3>{zh ? "能力" : "Capabilities"}</h3>
              <div className="pt-chips">
                {c.capabilities?.tools?.supported && <span>tools</span>}
                {c.capabilities?.reasoning?.supported && <span>reasoning</span>}
                {c.capabilities?.state?.supported && <span>state</span>}
                {c.capabilities?.humanInTheLoop?.supported && <span>interrupts</span>}
                {!c.capabilities && <span className="pt-muted">—</span>}
              </div>
            </section>
          </aside>
        </div>

        <footer className="pt-composer-wrap">
          {!!c.suggestions.length && (
            <div className="pt-suggestions">
              {c.suggestions.slice(0, 4).map((suggestion, index) => (
                <button
                  key={`suggestion-${index}`}
                  type="button"
                  className="pt-suggestion"
                  onClick={() => setDraft(suggestion)}
                >
                  <Icon name="sparkle" size={12} />
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <div className={`pt-composer ${running ? "is-running" : ""}`}>
            <span className="pt-prompt">›</span>
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
            />
            {running ? (
              <button type="button" className="pt-send" onClick={() => c.stop()} aria-label={zh ? "停止" : "Stop"}>
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="button" className="pt-send" onClick={send} disabled={!draft.trim() || !!pending.length} aria-label={t("chat.send")}>
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
        <div className="pt-row pt-row--user">
          <div className="pt-user">{entry.text}</div>
          <span className="pt-time">{timeOf(entry.at)}</span>
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
    <div className="pt-row pt-row--assistant">
      <span className="pt-avatar" aria-hidden="true" />
      <div className="pt-bubble">
        <Markdown text={entry.text} className="md pt-markdown" />
        {entry.streaming && <span className="pt-caret" aria-hidden="true" />}
        <span className="pt-time">{timeOf(entry.at)}</span>
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
    <div className="pt-row pt-row--reasoning">
      <button
        type="button"
        className="pt-reason-toggle"
        aria-expanded={open}
        onClick={() => setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
      >
        <Icon name="brain" size={12} />
        <span>{entry.streaming ? "thinking" : "reasoning"}</span>
        <span className="pt-dim">· {entry.tokens} tokens</span>
        {entry.encryptedValue && <span className="pt-badge">encrypted</span>}
        <Icon name="chevron" size={11} className="pt-chev" />
      </button>
      {open && (
        <div className="pt-reason-body">
          {entry.text ? <p>{entry.text}</p> : <p className="pt-muted">encrypted reasoning item</p>}
          {entry.encryptedValue && <pre className="pt-pre">{entry.encryptedValue.slice(0, 160)}</pre>}
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
    <div className="pt-tool" data-status={entry.status}>
      <button type="button" className="pt-tool-head" onClick={() => setOpenTools((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} aria-expanded={open}>
        <Icon name="wrench" size={12} />
        <span className="pt-tool-kicker">tool</span>
        <span className="pt-tool-name">{displayText(entry.name)}</span>
        {brief && <span className="pt-tool-brief">{brief}</span>}
        <span className="pt-tool-status">{status}</span>
        <span className="pt-time">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
        <Icon name="chevron" size={11} className="pt-chev" />
      </button>
      {open && (
        <div className="pt-tool-body">
          <pre className="pt-pre">{displayText(entry.argsRaw) || safeJson(entry.args, 2)}</pre>
          <ToolResult entry={entry} variant="particle" />
        </div>
      )}
      {!open && entry.error && <p className="pt-error">{displayText(entry.error)}</p>}
      {!open && entry.status === "error" && !entry.error && <p className="pt-error">{zh ? "工具失败" : "Tool failed"}</p>}
    </div>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className="pt-plan-card">
      <div className="pt-plan-card-head">
        <Icon name="layers" size={12} />
        <span>{displayText(entry.title)}</span>
        <span className="pt-badge">{displayText(entry.activityType)}</span>
      </div>
      {view.rawOnly ? (
        <pre className="pt-pre">{planRawText(view)}</pre>
      ) : (
        <ol>
          {view.steps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <span className="pt-step-dot" />
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
    <div className="pt-step" data-status={entry.status}>
      <span className="pt-step-dot" />
      <span>{displayText(entry.name)}</span>
      <span className="pt-dim">{entry.status === "running" ? (zh ? "进行中" : "running") : entry.status}</span>
    </div>
  );
}

function SubagentRow({ entry, zh }: { entry: SubagentEntry; zh: boolean }) {
  return (
    <div className="pt-subagent" data-status={entry.status}>
      <Icon name="activity" size={12} />
      <span>{displayText(entry.name)}</span>
      <span className="pt-dim">{entry.status === "running" ? (zh ? "运行中" : "running") : entry.status}</span>
      {entry.detail && <span className="pt-subagent-detail">{displayText(entry.detail)}</span>}
    </div>
  );
}

function CustomRow({ entry, plugins }: { entry: CustomEntry; plugins: ReturnType<typeof useSkinPlugins> }) {
  if (entry.display === "debug") return null;
  const plugin = plugins.custom?.(entry);
  if (plugin) return <div className="pt-custom">{plugin}</div>;
  const kind =
    entry.value === null
      ? "null"
      : Array.isArray(entry.value)
      ? `array[${entry.value.length}]`
      : typeof entry.value === "object"
      ? "object"
      : typeof entry.value;
  return (
    <details className="pt-custom">
      <summary>
        <span className="pt-badge">{displayText(entry.name)}</span>
        <span className="pt-dim">{kind}</span>
        <Icon name="chevron" size={11} className="pt-chev" />
      </summary>
      <pre className="pt-pre">{safeJson(entry.value, 2)}</pre>
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
  return (
    <div className={`pt-interrupt ${pending ? "is-pending" : "is-resolved"}`}>
      <div className="pt-interrupt-head">
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
        {entry.expiresAt && <span className="pt-dim">{new Date(entry.expiresAt).toLocaleTimeString()}</span>}
      </div>
      <p className="pt-interrupt-msg">{displayText(entry.message)}</p>
      {entry.description && <p className="pt-muted">{displayText(entry.description)}</p>}
      {!!entry.details.length && (
        <dl className="pt-kv">
          {entry.details.map((detail, index) => (
            <div key={`detail-${index}`}>
              <dt>{displayText(detail.label)}</dt>
              <dd>{displayText(detail.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.responseSchema && <pre className="pt-pre">{safeJson(entry.responseSchema, 2)}</pre>}
      {pending && (
        <>
          {editing === entry.id && (
            <textarea
              className="pt-edit"
              aria-label={zh ? "编辑参数" : "Edit arguments"}
              value={edits[entry.id] ?? ""}
              onChange={(event) => setEdits((prev) => ({ ...prev, [entry.id]: event.target.value }))}
              spellCheck={false}
            />
          )}
          <div className="pt-interrupt-actions">
            <button type="button" className="pt-btn pt-btn--primary" onClick={() => approve(entry, true)}>
              {zh ? "批准" : "Approve"}
            </button>
            <button type="button" className="pt-btn" onClick={() => approve(entry, false)}>
              {zh ? "拒绝" : "Deny"}
            </button>
            <button
              type="button"
              className="pt-btn pt-btn--ghost"
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
    <div className="pt-error-row" role="alert">
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
