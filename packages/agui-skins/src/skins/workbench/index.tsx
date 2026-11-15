import { useEffect, useMemo, useState } from "react";
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
import { firstPendingInterrupt, pendingInterrupts } from "../../shared/interrupts";
import {
  conversationGroups,
  foldGroupDuration,
  foldGroupFailures,
  foldGroupOpen,
  foldGroupStats,
} from "../../shared/conversationGroups";
import { toolStage } from "../../shared/toolStatus";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { Icon } from "../../shared/Icon";
import { formatDuration, plainText } from "../../utils";
import { isZh, t } from "../../i18n";
import "./workbench.css";

/**
 * Workbench — the conversation as an editor session.
 *
 * Dark graphite chrome, a file-tree of rounds on the left, a line-numbered
 * transcript in the middle and tool calls running through a collapsible
 * terminal panel at the bottom. Syntax-family accents (blue/violet/cyan)
 * mark the protocol's moving parts.
 */
export function WorkbenchPage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const plugins = useSkinPlugins();
  const zh = isZh();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const scroller = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"tree" | "state" | "meta">("tree");
  const [panelOpen, setPanelOpen] = useState(true);
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [openRounds, setOpenRounds] = useState<Record<string, boolean>>({});
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default
  // (open while the run is working, folded once everything settles).
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  // Fix B shape: editor drafts are keyed by interrupt id — two pending cards
  // never share an editor or submit each other's args.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<Record<string, string>>({});

  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries);
  const firstPending = firstPendingInterrupt(c.entries);
  const tools = useMemo(() => c.entries.filter((entry): entry is ToolEntry => entry.kind === "tool"), [c.entries.length]);
  const stateRows: [string, unknown][] = (() => {
    const rows = entriesOf(c.sharedState);
    if (rows.length > 0) return rows;
    return isEmptyState(c.sharedState) ? [] : [["state", c.sharedState]];
  })();

  // Stable gutter numbers: one pseudo line per transcript entry.
  const lineOf = useMemo(() => new Map(c.entries.map((entry, index) => [entry.id, index + 1])), [c.entries.length]);
  // Consecutive reasoning/tool rows collapse into one fold-group row.
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);
  const groupOfEntry = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of foldItems) {
      if (item.type === "group") for (const entry of item.entries) map.set(entry.id, item.id);
    }
    return map;
  }, [foldItems]);
  // Rounds = "files" in the explorer: a round opens at each user entry.
  const rounds = useMemo(() => {
    const list: { id: string; label: string; entries: Entry[] }[] = [];
    let current: { id: string; label: string; entries: Entry[] } | null = null;
    for (const entry of c.entries) {
      if (entry.kind === "user" || !current) {
        current = { id: entry.id, label: plainText(entry.kind === "user" ? entry.text : "", 26) || "", entries: [] };
        list.push(current);
      }
      current.entries.push(entry);
    }
    return list.map((round, index) => ({
      ...round,
      label: round.label || `${t("wb.round")} ${index + 1}`,
    }));
  }, [c.entries.length]);
  const roundOfEntry = useMemo(() => {
    const map = new Map<string, string>();
    for (const round of rounds) for (const entry of round.entries) map.set(entry.id, round.id);
    return map;
  }, [rounds]);

  // The round being streamed stays open in the tree, like an active file.
  useEffect(() => {
    if (running && rounds.length) {
      const last = rounds[rounds.length - 1];
      setOpenRounds((prev) => (prev[last.id] ? prev : { ...prev, [last.id]: true }));
    }
  }, [running, rounds.length]);

  function reveal(entryId: string, opts: { toolPanel?: boolean } = {}) {
    if (opts.toolPanel) {
      setPanelOpen(true);
      setOpenTools((prev) => ({ ...prev, [entryId]: true }));
    }
    // A tree leaf may point into a folded group: open it first, then scroll
    // once the row exists in the DOM.
    const groupId = groupOfEntry.get(entryId);
    if (groupId) setFoldOverride((prev) => ({ ...prev, [groupId]: true }));
    const scroll = () =>
      document.getElementById(`wb-e-${entryId}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    if (groupId) setTimeout(scroll, 0);
    else scroll();
  }

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
        // an invalid draft degrades to a plain approve instead of blocking
        editedArgs = undefined;
      }
    }
    setEditingId(null);
    c.resolveInterrupt(approved, editedArgs, entry.id);
  }

  // IDE reflexes: Y/N answer the oldest pending approval — but never while
  // the user is typing in a text field.
  useEffect(() => {
    if (!firstPending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      if (event.key.toLowerCase() === "y") c.resolveInterrupt(true, undefined, firstPending.id);
      if (event.key.toLowerCase() === "n") c.resolveInterrupt(false, undefined, firstPending.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firstPending?.id, c]);

  const statusText = (
    c.status === "idle" ? t("status.idle")
    : c.status === "running" ? t("status.running")
    : c.status === "interrupted" ? t("status.interrupted")
    : c.status === "done" ? t("status.done")
    : c.status === "error" ? t("status.error")
    : t("status.stopped")
  );
  const tokenLabel = (n: number) => (n ? (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)) : "—");
  const threadLabel = brand.threadTitle || c.threadId;
  const workspace = brand.workspaceName || "workspace";
  const kindLabel = (kind: Entry["kind"]) => t(`wb.node.${kind}` as never);

  return (
    <div className="skin-workbench">
      {/* ── title bar ─────────────────────────────────────────────── */}
      <header className="wb-titlebar">
        <span className="wb-logo" aria-hidden="true" />
        <strong className="wb-title">{displayText(brand.agentName)}</strong>
        <span className="wb-crumb mono">
          {displayText(workspace)} <i>/</i> {c.threadId}
        </span>
        <span className="wb-titlebar-right">
          <span className="wb-chip mono">{displayText(brand.modelLabel)}</span>
          <span className="wb-chip wb-chip--status mono" data-status={c.status}>{statusText}</span>
          {running && <span className="wb-chip mono">{clock(c.duration())}</span>}
        </span>
      </header>

      <div className="wb-body">
        {/* ── activity bar ────────────────────────────────────────── */}
        <nav className="wb-activity" role="group" aria-label={t("wb.explorer")}>
          <button
            type="button"
            className="wb-act"
            data-active={view === "tree" || undefined}
            aria-pressed={view === "tree"}
            aria-label={t("wb.viewTree")}
            title={t("wb.viewTree")}
            onClick={() => setView("tree")}
          >
            <Icon name="layers" size={16} />
          </button>
          <button
            type="button"
            className="wb-act"
            data-active={view === "state" || undefined}
            aria-pressed={view === "state"}
            aria-label={t("wb.viewState")}
            title={t("wb.viewState")}
            onClick={() => setView("state")}
          >
            <Icon name="braces" size={16} />
          </button>
          <button
            type="button"
            className="wb-act"
            data-active={view === "meta" || undefined}
            aria-pressed={view === "meta"}
            aria-label={t("wb.viewMeta")}
            title={t("wb.viewMeta")}
            onClick={() => setView("meta")}
          >
            <Icon name="activity" size={16} />
          </button>
          <span className="wb-act-spacer" />
          <span className={`wb-act-led wb-act-led--${c.status}`} aria-hidden="true" />
        </nav>

        {/* ── side panel ──────────────────────────────────────────── */}
        <aside className="wb-side">
          {view === "tree" && (
            <div className="wb-side-view">
              <div className="wb-side-head mono">{t("wb.explorer").toUpperCase()} · {t("wb.rounds")}</div>
              <button
                type="button"
                className="wb-tree-root"
                onClick={() => reveal(c.entries[0]?.id ?? "", {})}
                disabled={!c.entries.length}
              >
                <Icon name="globe" size={12} />
                <span className="wb-tree-root-name">{threadLabel}</span>
                <span className={`wb-dot wb-dot--${c.status}`} aria-hidden="true" />
              </button>
              {rounds.length === 0 && <p className="wb-side-empty">{t("wb.empty")}</p>}
              {rounds.map((round, index) => {
                const open = openRounds[round.id] ?? false;
                const last = index === rounds.length - 1;
                return (
                  <div key={round.id} className="wb-round" data-open={open || undefined}>
                    <button
                      type="button"
                      className="wb-tree-row wb-tree-row--round"
                      aria-expanded={open}
                      onClick={() => {
                        setOpenRounds((prev) => ({ ...prev, [round.id]: !prev[round.id] }));
                        reveal(round.entries[0].id);
                      }}
                    >
                      <Icon name="chevron" size={10} className="wb-chev" />
                      <span className="wb-tree-label">{round.label}</span>
                      {last && running && <span className="wb-tree-live mono">{t("status.writing")}</span>}
                    </button>
                    {open && (
                      <div className="wb-tree-children">
                        {round.entries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="wb-tree-row wb-tree-row--leaf"
                            onClick={() => reveal(entry.id, { toolPanel: entry.kind === "tool" })}
                          >
                            <span className={`wb-node-kind wb-node-kind--${entry.kind}`}>{kindLabel(entry.kind)}</span>
                            <span className="wb-tree-label">
                              {entry.kind === "user" || entry.kind === "assistant"
                                ? plainText((entry as AssistantEntry).text, 22) || kindLabel(entry.kind)
                                : entry.kind === "tool"
                                ? displayText((entry as ToolEntry).name)
                                : entry.kind === "error"
                                ? plainText((entry as ErrorEntry).message, 22)
                                : kindLabel(entry.kind)}
                            </span>
                            <span className={`wb-dot wb-dot--${statusDotOf(entry)}`} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {view === "state" && (
            <div className="wb-side-view">
              <div className="wb-side-head mono">{t("wb.state").toUpperCase()}</div>
              {stateRows.length ? (
                <dl className="wb-kv">
                  {stateRows.map(([key, value]) => (
                    <div key={key}>
                      <dt className="mono">{key}</dt>
                      <dd className="mono">{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="wb-side-empty">{zh ? "状态快照为空。" : "No state snapshot yet."}</p>
              )}
              <div className="wb-side-foot mono">STATE v{c.stateVersion}</div>
            </div>
          )}

          {view === "meta" && (
            <div className="wb-side-view">
              <div className="wb-side-head mono">{t("wb.meta").toUpperCase()}</div>
              <dl className="wb-kv">
                <div><dt className="mono">thread</dt><dd className="mono">{c.threadId}</dd></div>
                <div><dt className="mono">run</dt><dd className="mono">{c.runId || "—"}</dd></div>
                <div><dt className="mono">status</dt><dd>{statusText}</dd></div>
                <div><dt className="mono">transport</dt><dd className="mono">{displayText(c.transport) || "—"}</dd></div>
                <div><dt className="mono">{t("chat.tokens")}</dt><dd className="mono">{tokenLabel(c.tokens)}</dd></div>
                <div><dt className="mono">{t("chat.events")}</dt><dd className="mono">{c.events.length}</dd></div>
              </dl>
              <div className="wb-side-head mono">{t("chat.context").toUpperCase()}</div>
              <div className="wb-caps">
                {c.capabilities?.tools?.supported && <span>tools · {c.capabilities.tools.items?.length ?? 0}</span>}
                {c.capabilities?.reasoning?.supported && <span>reasoning</span>}
                {c.capabilities?.state?.supported && <span>state</span>}
                {c.capabilities?.humanInTheLoop?.supported && <span>interrupts</span>}
                {c.capabilities?.subagents?.supported && <span>subagents</span>}
                {!c.capabilities && <span className="wb-side-empty">—</span>}
              </div>
            </div>
          )}
        </aside>

        {/* ── editor column ───────────────────────────────────────── */}
        <section className="wb-editor">
          <div className="wb-tabs">
            <div className="wb-tab" data-active="true">
              <span className={`wb-dot wb-dot--${c.status}`} aria-hidden="true" />
              <span className="wb-tab-name">{threadLabel}</span>
              {running && <span className="wb-tab-dirty" aria-hidden="true" />}
            </div>
            <span className="wb-tabs-meta mono">
              {c.runId ? `${c.runId.slice(0, 18)}` : "—"}{running ? ` · ${clock(c.duration())}` : ""}
            </span>
          </div>

          <main className="wb-transcript" ref={scroller} role="log" aria-live="polite" aria-label={zh ? "对话记录" : "Conversation"}>
            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            {c.entries.length === 0 ? (
              <div className="wb-empty">
                <p className="wb-empty-code mono">
                  <span aria-hidden="true">// </span>
                  {t("wb.empty")}
                </p>
                <p className="wb-empty-hint mono">{t("wb.viewTree")} · {t("wb.terminal")}</p>
              </div>
            ) : (
              <div className="wb-rows">
                {(() => {
                  const rowCtx = { zh, plugins, openTools, setOpenTools, openReasoning, setOpenReasoning, editingId, editJson, setEditJson, setEditingId, beginEdit, approve, reveal };
                  const rowFor = (entry: Entry) => (
                    <div key={entry.id} id={`wb-e-${entry.id}`} className="wb-row" data-kind={entry.kind}>
                      <div className="wb-gutter mono" aria-hidden="true">
                        <span className="wb-line" data-active={entry.kind === "assistant" && (entry as AssistantEntry).streaming ? "true" : undefined}>
                          {lineOf.get(entry.id) ?? 0}
                        </span>
                      </div>
                      <div className="wb-cell">{renderEntry(entry, rowCtx)}</div>
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
                        line={lineOf.get(item.entries[0].id) ?? 0}
                        rowFor={rowFor}
                      />
                    );
                  });
                })()}
              </div>
            )}
          </main>

          {/* ── composer ──────────────────────────────────────────── */}
          <footer className="wb-composer-wrap">
            {!!c.suggestions.length && (
              <div className="wb-suggestions" role="list" aria-label={zh ? "建议" : "Suggestions"}>
                {c.suggestions.slice(0, 4).map((suggestion, index) => (
                  <button
                    key={`suggestion-${index}`}
                    type="button"
                    role="listitem"
                    className="wb-suggestion mono"
                    onClick={() => setDraft(suggestion)}
                  >
                    <Icon name="sparkle" size={11} />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="wb-composer">
              <span className="wb-prompt mono" aria-hidden="true">›</span>
              <textarea
                rows={1}
                value={draft}
                aria-label={zh ? "消息输入框" : "Message composer"}
                placeholder={pending.length ? (zh ? "先处理上方的审批，再继续输入" : "Resolve the approval above first") : t("chat.placeholder")}
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
                <button type="button" className="wb-send" onClick={() => c.stop()} aria-label={t("chat.stop")} title={t("chat.stop")}>
                  <Icon name="stop" size={13} />
                </button>
              ) : (
                <button type="button" className="wb-send" onClick={send} disabled={!draft.trim() || pending.length > 0} aria-label={t("chat.send")} title={t("chat.send")}>
                  <Icon name="send" size={13} />
                </button>
              )}
            </div>
          </footer>

          {/* ── terminal panel (tools) ────────────────────────────── */}
          <section className="wb-panel" data-open={panelOpen || undefined} aria-label={t("wb.terminal")}>
            <button
              type="button"
              className="wb-panel-head"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((open) => !open)}
              onKeyDown={(event) => {
                // Enter/Space activate a native button for free in browsers;
                // spelling the handler out keeps the keydown contract testable
                // (jsdom runs no activation behavior). preventDefault stops the
                // browser's own click so the panel never double-toggles.
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setPanelOpen((open) => !open);
                }
              }}
            >
              <Icon name="chevron" size={10} className="wb-chev" />
              <span className="wb-panel-title mono">{t("wb.terminal").toUpperCase()}</span>
              <span className="wb-panel-count mono">{tools.length ? `${tools.length} ${t("chat.tools")}` : t("wb.terminalEmpty")}</span>
              <span className="wb-panel-meta mono">
                {tools.filter((tool) => tool.status === "error").length > 0 && (
                  <span className="wb-panel-fails">{tools.filter((tool) => tool.status === "error").length} {t("chat.failed")}</span>
                )}
              </span>
            </button>
            {panelOpen && (
              <div className="wb-panel-body">
                {tools.length === 0 && <p className="wb-panel-empty mono">{t("wb.terminalEmpty")}</p>}
                {tools.map((tool) => (
                  <TerminalRow key={tool.id} entry={tool} open={!!openTools[tool.id]} onToggle={() => setOpenTools((prev) => ({ ...prev, [tool.id]: !prev[tool.id] }))} />
                ))}
              </div>
            )}
          </section>
        </section>
      </div>

      {/* ── status bar ─────────────────────────────────────────────── */}
      <footer className="wb-statusbar">
        <span className={`wb-status wb-status--${c.status}`}>
          <i className="wb-status-led" aria-hidden="true" />
          {statusText}
        </span>
        <span className="wb-status-item mono">{displayText(c.transport) || "—"}</span>
        {c.status === "error" && c.entries.filter((entry) => entry.kind === "error").slice(-1).map((entry) => (
          <span key={entry.id} className="wb-status-item wb-status-item--error mono">
            {plainText((entry as ErrorEntry).message, 60)}
          </span>
        ))}
        <span className="wb-status-spacer" />
        {pending.length > 0 && (
          <span className="wb-status-item wb-status-item--kbd mono">
            <kbd>Y</kbd>/<kbd>N</kbd> · {t("intr.paused")}
          </span>
        )}
        <span className="wb-status-item mono">{t("chat.tokens")} {tokenLabel(c.tokens)}</span>
        <span className="wb-status-item mono">{t("chat.events")} {c.events.length}</span>
      </footer>
      <ProtocolDrawer />
    </div>
  );
}

function statusDotOf(entry: Entry): string {
  switch (entry.kind) {
    case "assistant":
      return (entry as AssistantEntry).streaming ? "running" : "done";
    case "tool":
      return (entry as ToolEntry).status === "interrupted" ? "interrupted" : (entry as ToolEntry).status;
    case "interrupt":
      return (entry as InterruptEntry).status === "pending" ? "interrupted" : (entry as InterruptEntry).status;
    case "error":
      return "error";
    case "subagent":
      return (entry as SubagentEntry).status;
    default:
      return "idle";
  }
}

/* ── fold group (consecutive reasoning + tool rows) ────────────────── */

/**
 * One IDE fold region: a mono summary row stands in for the block and the
 * original rows render inside unchanged when unfolded. The header always
 * surfaces failures/interrupts so a collapsed group cannot hide a broken run.
 */
function FoldGroupRow({
  groupId,
  entries,
  open,
  onToggle,
  line,
  rowFor,
}: {
  groupId: string;
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
  line: number;
  rowFor: (entry: Entry) => React.ReactNode;
}) {
  const stats = foldGroupStats(entries);
  const failures = foldGroupFailures(entries);
  const duration = foldGroupDuration(entries);
  const preview = stats.toolNames.slice(0, 3).join(", ");
  const extra = stats.toolNames.length - 3;
  return (
    <>
      <div className="wb-row wb-row--fold" data-kind="fold">
        <div className="wb-gutter mono" aria-hidden="true">
          <span className="wb-line">{line}</span>
        </div>
        <div className="wb-cell">
          <button
            type="button"
            className="wb-fold-head mono"
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
            <Icon name="chevron" size={10} className="wb-chev" />
            <span className="wb-fold-title">{t("fold.group")}</span>
            <span className="wb-fold-summary">
              {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
              {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
              {preview}
              {extra > 0 && ` +${extra} ${t("fold.more")}`}
              {stats.reasoningCount === 0 && stats.toolCount === 0 && `0 ${t("fold.steps")}`}
            </span>
            <span className="wb-fold-meta">
              {duration !== undefined && <span className="wb-fold-time">{formatDuration(duration)}</span>}
              {failures.length > 0 && (
                <span className="wb-fold-flag" data-failure={failures[0]}>
                  {failures.includes("error") ? t("fold.hasFailures") : t("chat.interrupted")}
                </span>
              )}
              {foldGroupOpen(entries) && <span className="wb-fold-flag wb-fold-flag--live">{t("chat.executing")}</span>}
            </span>
          </button>
        </div>
      </div>
      {open && (
        <div className="wb-fold-body" data-fold-id={groupId}>
          {entries.map((entry) => rowFor(entry))}
        </div>
      )}
    </>
  );
}

/* ── transcript rows ───────────────────────────────────────────────── */

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
  reveal: (id: string, opts?: { toolPanel?: boolean }) => void;
}

function renderEntry(entry: Entry, ctx: RowCtx) {
  switch (entry.kind) {
    case "user":
      return <UserRow entry={entry} />;
    case "assistant":
      return <AssistantRow entry={entry} />;
    case "reasoning":
      return <ReasoningRow entry={entry} open={!!ctx.openReasoning[entry.id]} onToggle={() => ctx.setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))} />;
    case "tool":
      // tool calls live in the terminal panel; the transcript keeps a slim jump line
      return (
        <button type="button" className="wb-tool-jump mono" onClick={() => ctx.reveal(entry.id, { toolPanel: true })}>
          <Icon name="chevron" size={10} className="wb-chev" />
          <span className="wb-tool-jump-name">{displayText((entry as ToolEntry).name)}</span>
          <span className={`wb-stage wb-stage--${toolStage((entry as ToolEntry).status)}`}>{stageWord((entry as ToolEntry).status)}</span>
          <span className="wb-tool-jump-hint">{t("wb.openInTerminal")}</span>
        </button>
      );
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

const UserRow = ({ entry }: { entry: Entry & { kind: "user"; text: string } }) => {
  const zh = isZh();
  return (
    <div className="wb-user">
      <span className="wb-user-tag mono">{zh ? "输入" : "in"} · {timeOf(entry.at)}</span>
      <p>{entry.text}</p>
    </div>
  );
};

function AssistantRow({ entry }: { entry: AssistantEntry }) {
  return (
    <div className="wb-assistant">
      <Markdown text={entry.text} className="md wb-md" />
      {!entry.text && entry.streaming && <span className="wb-caret" aria-hidden="true" />}
      {entry.streaming && !!entry.text && <span className="wb-caret wb-caret--inline" aria-hidden="true" />}
      {!entry.streaming && !!entry.text && (
        <button
          type="button"
          className="wb-row-action"
          aria-label={t("chat.copy")}
          title={t("chat.copy")}
          onClick={() => navigator.clipboard?.writeText(entry.text)}
        >
          <Icon name="copy" size={12} />
        </button>
      )}
    </div>
  );
};

function ReasoningRow({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  return (
    <div className="wb-reason">
      <button type="button" className="wb-reason-head mono" aria-expanded={open} onClick={onToggle}>
        <Icon name="brain" size={11} />
        <span>{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
        {!!entry.tokens && <span className="wb-reason-meta">{entry.tokens} {t("chat.tokens")}</span>}
        {entry.encryptedValue && <span className="wb-reason-badge">encrypted</span>}
        <Icon name="chevron" size={9} className="wb-chev" />
      </button>
      {open && (
        <div className="wb-reason-body">
          {entry.text ? <p>{entry.text}</p> : <p className="wb-dim">encrypted reasoning item</p>}
          {entry.encryptedValue && <pre className="wb-pre mono">{entry.encryptedValue.slice(0, 160)}</pre>}
        </div>
      )}
    </div>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className="wb-plan">
      <div className="wb-plan-head">
        <Icon name="layers" size={12} />
        <span className="wb-plan-title">{displayText(entry.title)}</span>
        <span className="wb-plan-count mono">
          {view.steps.filter((step) => step.state === "done").length}/{view.steps.length || 0}
        </span>
      </div>
      {view.rawOnly ? (
        <pre className="wb-pre mono">{planRawText(view)}</pre>
      ) : (
        <ul className="wb-plan-list">
          {view.steps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <span className="wb-plan-check">{step.state === "done" && <Icon name="check" size={10} />}</span>
              <span className="wb-plan-label">{step.label}</span>
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
    <div className="wb-step mono" data-status={entry.status}>
      <span className="wb-step-dot" aria-hidden="true" />
      <span>{displayText(entry.name)}</span>
      <span className="wb-dim">{word}</span>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "error" ? t("chat.failed") : t("chat.done");
  return (
    <div className="wb-subagent mono" data-status={entry.status}>
      <Icon name="activity" size={11} />
      <span>{displayText(entry.name)}</span>
      <span className="wb-dim">{word}</span>
      {entry.detail && <span className="wb-subagent-detail">{displayText(entry.detail)}</span>}
    </div>
  );
}

function CustomRow({ entry, plugins }: { entry: CustomEntry; plugins: ReturnType<typeof useSkinPlugins> }) {
  const plugin = plugins.custom?.(entry);
  if (plugin) return <div className="wb-custom">{plugin}</div>;
  return (
    <details className="wb-custom">
      <summary className="mono">
        <span className="wb-node-kind wb-node-kind--custom">{t("wb.node.custom")}</span>
        <span>{displayText(entry.name)}</span>
        <Icon name="chevron" size={9} className="wb-chev" />
      </summary>
      <pre className="wb-pre mono">{safeJson(entry.value, 2)}</pre>
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
    <div className={`wb-approval ${pendingCard ? "is-pending" : "is-resolved"}`} data-expired={entry.expired || undefined}>
      <div className="wb-approval-head">
        <Icon name={entry.expired ? "clock" : "shield"} size={13} />
        <span className="wb-approval-label">{headWord}</span>
        <span className="wb-approval-time mono">{timeOf(entry.at)}</span>
      </div>
      <p className="wb-approval-msg">{displayText(entry.message)}</p>
      {entry.description && <p className="wb-dim wb-approval-desc">{displayText(entry.description)}</p>}
      {!!entry.details.length && (
        <dl className="wb-kv wb-approval-details">
          {entry.details.map((detail, index) => (
            <div key={`detail-${index}`}>
              <dt className="mono">{displayText(detail.label)}</dt>
              <dd>{displayText(detail.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.responseSchema && <pre className="wb-pre mono">{safeJson(entry.responseSchema, 2)}</pre>}
      {pendingCard && (
        <>
          {ctx.editingId === entry.id && (
            <div className="wb-edit">
              <label className="mono">{t("intr.edit")}</label>
              <textarea
                aria-label={ctx.zh ? "编辑参数" : "Edit arguments"}
                value={ctx.editJson[entry.id] ?? ""}
                onChange={(event) => ctx.setEditJson((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                spellCheck={false}
              />
            </div>
          )}
          <div className="wb-approval-actions">
            <button type="button" className="wb-btn wb-btn--primary" onClick={() => ctx.approve(entry, true, true)}>
              {ctx.editingId === entry.id ? t("intr.approveEdited") : t("intr.approve")}
            </button>
            <button type="button" className="wb-btn" onClick={() => ctx.approve(entry, false, false)}>
              {t("intr.deny")}
            </button>
            <button
              type="button"
              className="wb-btn wb-btn--ghost"
              onClick={() => (ctx.editingId === entry.id ? ctx.setEditingId(null) : ctx.beginEdit(entry.id))}
            >
              {ctx.editingId === entry.id ? t("intr.cancel") : t("intr.edit")}
            </button>
            <span className="wb-kbd-hint mono" aria-hidden="true">{t("wb.ynHint")}</span>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorRow({ entry }: { entry: ErrorEntry }) {
  return (
    <div className="wb-error" role="alert">
      <Icon name="x" size={12} />
      <span>{displayText(entry.message)}</span>
    </div>
  );
}

/* ── terminal panel rows ───────────────────────────────────────────── */

function TerminalRow({ entry, open, onToggle }: { entry: ToolEntry; open: boolean; onToggle: () => void }) {
  const brief = (() => {
    const args = entry.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) return "";
    return Object.entries(args as Record<string, unknown>)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .slice(0, 2)
      .map(([key, value]) => `${key}=${String(value).slice(0, 32)}`)
      .join(" · ");
  })();
  return (
    <div className="wb-term-row" data-stage={toolStage(entry.status)}>
      <button type="button" className="wb-term-head mono" aria-expanded={open} onClick={onToggle}>
        <span className="wb-term-prompt" aria-hidden="true">❯</span>
        <span className="wb-term-name">{displayText(entry.name)}</span>
        {brief && <span className="wb-term-brief">{brief}</span>}
        <span className={`wb-stage wb-stage--${toolStage(entry.status)}`}>{stageWord(entry.status)}</span>
        <span className="wb-term-time">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
        <Icon name="chevron" size={9} className="wb-chev" />
      </button>
      {open && (
        <div className="wb-term-body">
          <pre className="wb-pre mono">{displayText(entry.argsRaw) || safeJson(entry.args, 2)}</pre>
          <ToolResult entry={entry} variant="particle" />
          {entry.error && <p className="wb-term-error">{displayText(entry.error)}</p>}
        </div>
      )}
      {!open && entry.status === "error" && <p className="wb-term-error">{displayText(entry.error) || t("chat.failed")}</p>}
    </div>
  );
}

export default {
  id: "workbench",
  name: "Workbench",
  tagline: "IDE shell · rounds as files",
  swatch: ["#1e2024", "#262930", "#7aa2f7"] as [string, string, string],
  ChatPage: WorkbenchPage,
  tuningSupport: { theme: true },
};
