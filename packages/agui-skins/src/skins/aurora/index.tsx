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
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { useStickToBottom } from "../../shared/useStickToBottom";
import "./aurora.css";

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

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  return (
    <div className="skin-aurora">
      <div className="bg" aria-hidden="true">
        <div className="bg-orb bg-orb--mint" />
        <div className="bg-orb bg-orb--cyan" />
        <div className="bg-orb bg-orb--violet" />
        <div className="bg-grid" />
        <div className="bg-noise" />
        <div className="bg-vignette" />
      </div>

      <div className="app">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark"><span /></div>
            <div className="brand-word">
              <span className="brand-name">AG-UI</span>
              <span className="brand-sub">Studio</span>
            </div>
            <span className="brand-version">protocol 1.0</span>
          </div>

          <div className="topbar-center">
            <div className="conn">
              <span className="conn-dot" />
              <span className="conn-label">SSE</span>
              <span className="conn-sep">·</span>
              <span className="conn-host mono">agent.local/run</span>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="run-pill" data-status={c.status}>
              <span className="run-pill-dot" />
              <span className="run-pill-text">{t(("status." + c.status) as never)}{pendingInterrupts(c.entries).length > 1 ? ` ×${pendingInterrupts(c.entries).length}` : ""}</span>
              <span className="run-pill-meta mono">{c.status === "idle" ? "" : formatDuration(c.duration())}</span>
            </div>
            <div className="avatar" title="noexcs">N</div>
          </div>
        </header>

        <div className="workspace">

          {/* chat */}
          <main className="panel chat">
            <div className="chat-head">
              <div className="chat-id">
                <div className="agent-orb agent-orb--mint agent-orb--lg">
                  <span className="agent-orb-pulse" />
                </div>
                <div className="chat-id-text">
                  <div className="chat-title">
                    <span>{brand.agentName}</span>
                    <span className="verified"><Icon name="check" /></span>
                  </div>
                  <div className="chat-sub mono">{brand.modelLabel} · {c.threadId} · {c.runId}</div>
                </div>
              </div>
              <div className="chat-caps">
                {c.capabilities?.tools?.supported && (
                  <span className="cap"><Icon name="wrench" />{t("chat.tools")} <b>{c.capabilities.tools.items?.length ?? 0}</b></span>
                )}
                {c.capabilities?.reasoning?.supported && <span className="cap"><Icon name="brain" />{t("chat.reasoning")}</span>}
                {c.capabilities?.state?.supported && <span className="cap"><Icon name="layers" />{t("chat.state")}</span>}
                {c.capabilities?.humanInTheLoop?.supported && (
                  <span className="cap cap--hitl"><Icon name="shield" />{t("chat.interrupts")}</span>
                )}
              </div>
            </div>

            <div className="chat-scroll" ref={scroller}>
              {c.entries.length === 0 && (
                <div className="block" style={{ opacity: 0.6, textAlign: "center", paddingTop: 40 }}>
                  <span className="mono" style={{ fontSize: 11 }}>{t("aurora.waiting")}</span>
                </div>
              )}

              {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
              {visible.map((entry) => (
                <EntryView
                  key={entry.id}
                  entry={entry}
                  open={!!openReasoning[entry.id]}
                  onToggleReasoning={() => setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                  interrupt={entry.kind === "interrupt" ? interrupt : undefined}
                  onApprove={(editedArgs) => c.resolveInterrupt(true, editedArgs, entry.id)}
                  onDeny={() => c.resolveInterrupt(false, undefined, entry.id)}
                />
              ))}

              {(c.status === "done" || c.status === "stopped") && c.entries.length > 2 && (
                <RunSummary />
              )}
            </div>

            <div className="composer-wrap">
              {c.suggestions.length > 0 && (
                <div className="suggestions">
                  {c.suggestions.map((text) => (
                    <button key={text} className="suggestion" onClick={() => { setDraft(text); textarea.current?.focus(); }}>
                      <Icon name="sparkle" />
                      <span>{text}</span>
                    </button>
                  ))}
                </div>
              )}

              <form
                className="composer"
                onSubmit={(e) => { e.preventDefault(); send(); }}
              >
                <div className="composer-glow" aria-hidden="true" />
                <textarea
                  ref={textarea}
                  rows={1}
                  value={draft}
                  aria-label={t("chat.placeholder")}
                  placeholder={t("chat.placeholder")}
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
                <div className="composer-bar">
                  <div className="composer-tools">
                    <button type="button" className="tool-btn" aria-label="Attach"><Icon name="paperclip" /></button>
                    <button type="button" className="tool-btn"><Icon name="wrench" /><span>{t("chat.tools")}</span></button>
                    <button type="button" className="tool-btn"><Icon name="command" /><span>{t("chat.commands")}</span></button>
                  </div>
                  <div className="composer-right">
                    <span className="model-chip mono">{brand.modelLabel}</span>
                    {running ? (
                      <button type="button" className="send" onClick={() => c.stop()} aria-label="Stop"> <Icon name="stop" /></button>
                    ) : (
                      <button type="submit" className="send" disabled={!draft.trim()} aria-label="Send"><Icon name="send" /></button>
                    )}
                  </div>
                </div>
              </form>

              <div className="composer-hint">
                <span><kbd className="kbd">⏎</kbd> send · <kbd className="kbd">⇧⏎</kbd> newline · <kbd className="kbd">esc</kbd> stop</span>
                <span className="hint-right mono">events stream over SSE</span>
              </div>
            </div>
          </main>

          {/* inspector */}
          <aside className="panel inspector">
            <RadixTabs.Root className="insp-root" value={tab} onValueChange={(value) => setTab(value as "events" | "state")}>
            <div className="insp-head">
              <RadixTabs.List className="tabs" aria-label="Inspector">
                <RadixTabs.Trigger className="tab" value="events">
                  {t("chat.eventsTab")}<span className="tab-count mono">{c.events.length}</span>
                </RadixTabs.Trigger>
                <RadixTabs.Trigger className="tab" value="state">
                  {t("chat.stateTab")}<span className="tab-count mono">v{c.stateVersion}</span>
                </RadixTabs.Trigger>
              </RadixTabs.List>
              <button className="icon-btn icon-btn--sm" title="Clear log" onClick={() => { setSelected(null); }}><Icon name="x" /></button>
            </div>

            {Object.keys(c.metadata ?? {}).length > 0 && (
              <div className="insp-meta" title={JSON.stringify(c.metadata, null, 2)}>
                <span className="insp-meta-k mono">META</span>
                {Object.entries(c.metadata ?? {}).slice(0, 4).map(([key, value]) => (
                  <span key={key} className="insp-meta-chip mono">
                    {key}={typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </span>
                ))}
              </div>
            )}

            <RadixTabs.Content className="insp-pane" value="events">
                <div className="ev-filters">
                  {[
                    ["all", t("filter.all")],
                    ["lifecycle", t("filter.lifecycle")],
                    ["text", t("filter.text")],
                    ["tool", t("filter.tool")],
                    ["state", t("filter.state")],
                    ["reasoning", t("filter.reasoning")],
                    ["special", t("filter.special")],
                  ].map(([id, label]) => (
                    <button key={id} className={`filter ${filter === id ? "is-active" : ""}`} onClick={() => { setFilter(id); setEvLimit(200); }}>
                      {id !== "all" && <i className={`fdot fdot--${id.slice(0, 4)}`} />}
                      {label}
                    </button>
                  ))}
                </div>

                <div className="ev-list" ref={eventList}>
                  {events.length > visibleEvents.length && (
                    <button
                      type="button"
                      className="ev-more"
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
                        className={`ev-row ${selected === seq ? "is-selected" : ""}`}
                        data-cat={cat}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                      >
                        <div className="ev-main">
                          <div className="ev-top">
                            <span className="ev-type">{event.type}</span>
                            <span className="ev-time">{offset}</span>
                          </div>
                          <div className="ev-preview">{eventPreview(event as Record<string, unknown>)}</div>
                          {selected === seq && (
                            <div className="ev-json">
                              <JsonView data={event as Record<string, unknown>} style={darkStyles} shouldExpandNode={(level) => level < 3} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="insp-foot">
                  <span className="mono">
                    {events.length} events{events.length > visibleEvents.length ? ` · ${visibleEvents.length} shown` : ""}
                  </span>
                  <span className="mono">mock SSE · {c.tokens || 0} tokens</span>
                </div>
            </RadixTabs.Content>

            <RadixTabs.Content className="insp-pane" value="state">
                <div className="state-head">
                  <div>
                    <div className="state-title">Shared state</div>
                    <div className="state-sub mono">STATE_SNAPSHOT + JSON Patch</div>
                  </div>
                  <span className="state-version mono">v{c.stateVersion}</span>
                </div>
                <div className="state-tree">
                  {isEmptyState(c.sharedState) ? (
                    <div className="state-empty">
                      <Icon name="braces" />
                      No snapshot yet
                    </div>
                  ) : (
                    <StateNode name="thread" value={c.sharedState} pointer="" touched={c.touchedPaths} />
                  )}
                </div>
                <div className="insp-foot">
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
      <div className="block block--user">
        <div className="msg-user">
          <div className="msg-user-name mono">YOU · {timeOf(entry.at)}</div>
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
      <div className="block">
        <div className="tool" data-status="error" style={{ padding: 12 }}>
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
    <div className="block block--agent">
      <div className="msg-avatar" />
      <div className="msg-main">
        <div className="msg-meta">
          <span className="msg-author">{brand.agentName}</span>
          <span className="msg-time">{timeOf(entry.at)}</span>
          {entry.streaming && <span className="msg-byline"><Icon name="activity" size={10} />{t("status.generating")}</span>}
        </div>
        {entry.text ? (
          <Markdown className={`prose ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
        ) : (
          <div className="prose"><span className="caret" /></div>
        )}
        {!entry.streaming && (
          <div className="msg-actions">
            <button className="msg-action" onClick={() => navigator.clipboard?.writeText(entry.text)}>
              <Icon name="copy" />{t("chat.copy")}
            </button>
            <span className="msg-action mono" style={{ opacity: 0.6 }}>{estimateTokens(entry.text)} tok</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ReasoningBlock({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  return (
    <div className="block">
      <div className={`reason ${open ? "is-open" : ""} ${entry.streaming ? "is-streaming" : ""}`}>
        <button className="reason-toggle" onClick={onToggle}>
          <Icon name="brain" className="icon-brain" />
          <span className="reason-dot" />
          <span className="reason-label">{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
          <span className="reason-meta mono">
            {entry.streaming ? "…" : formatDuration(entry.durationMs ?? 0)}
          </span>
          <Icon name="chevron" className="chev" />
        </button>
        {open && (
          <div className="reason-body" data-skin-text="">
            <div className="reason-text">
              {entry.text}
              {entry.streaming && <span className="caret" />}
            </div>
            <div className="reason-tokens">
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
    <div className="block">
      <div className="tool" data-status={entry.status}>
        <div className="tool-head">
          <div className="tool-icon"><Icon name="wrench" /></div>
          <span className="tool-name"><span className="tool-namespace">{ns}</span>{shortName}</span>
          <div className="tool-meta">
            <span className="mono">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
            <span className="tool-status">
              {entry.status === "args" && <><span className="spinner" />{t("chat.streamingArgs")}</>}
              {entry.status === "executing" && <><span className="spinner" />{t("chat.executing")}</>}
              {entry.status === "interrupted" && <><Icon name="pause" />{t("chat.interrupted")}</>}
              {entry.status === "done" && <><Icon name="check" />{t("chat.done")}</>}
              {entry.status === "error" && <><Icon name="x" />{t("chat.failed")}</>}
            </span>
          </div>
        </div>
        <div className="tool-body">
          {entry.argsRaw && <div className="tool-args" data-skin-text="">{safeJson(entry.args ?? entry.argsRaw, 2)}</div>}
          <ToolResult entry={entry} variant="aurora" />
        </div>
      </div>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  return (
    <div className="block">
      <div className="reason">
        <div className="reason-toggle">
          <Icon name="layers" className="icon-brain" />
          <span className="reason-label">{displayText(entry.name)}</span>
          <span className="reason-meta mono">{entry.status}</span>
        </div>
        {entry.detail && <div className="reason-body" data-skin-text="">{entry.detail}</div>}
      </div>
    </div>
  );
}

function StepRow({ entry }: { entry: StepEntry }) {
  return (
    <div className="block">
      <div className="reason">
        <div className="reason-toggle">
          <Icon name="activity" className="icon-brain" />
          <span className="reason-label">{displayText(entry.name)}</span>
          <span className="reason-meta mono">{entry.status}</span>
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
    <div className="block">
      <div className="reason">
        <div className="reason-toggle">
          <Icon name="braces" className="icon-brain" />
          <span className="reason-label">{displayText(entry.name)}</span>
          <span className="reason-meta mono">{safeJson(entry.value, 0)}</span>
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
    <div className="block">
      <div className="plan">
        <div className="plan-head">
          <span className="plan-icon"><Icon name="activity" /></span>
          <span className="plan-title">{displayText(entry.title)}</span>
          <span className="plan-tag">ACTIVITY · {displayText(entry.activityType)}</span>
        </div>
        {view.rawOnly ? (
          <pre className="tool-args" data-skin-text="">{planRawText(view)}</pre>
        ) : (
        <div className="plan-steps">
          {view.steps.map((step) => (
            <div key={step.id} className="plan-step" data-state={step.state}>
              <span className="plan-check">{step.state === "done" && <Icon name="check" />}</span>
              <span className="plan-step-label">{step.label}</span>
              {step.state === "active" && <span className="plan-step-time mono">{t("chat.executing")}</span>}
            </div>
          ))}
        </div>
        )}
        <div className="plan-bar"><span style={{ width: pct + "%" }} /></div>
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
    <div className="block">
      <div className={`interrupt ${pending ? "" : entry.expired ? "interrupt--expired" : "interrupt--resolved"}`}>
        <div className="interrupt-head">
          <span className="interrupt-icon"><Icon name={pending ? "shield" : entry.expired ? "clock" : "check"} /></span>
          <span className="interrupt-kicker">{pending ? t("intr.paused") : t("intr.resolved")}</span>
          <span className="interrupt-time mono">{timeOf(entry.at)}</span>
        </div>
        <div className="interrupt-title">{entry.message}</div>
        {entry.description && <div className="interrupt-desc">{entry.description}</div>}

        {entry.details.length > 0 && (
          <div className="interrupt-detail">
            {entry.details.map((d) => (
              <div key={d.label}>
                <span>{d.label}</span>
                <span>{d.value}</span>
              </div>
            ))}
          </div>
        )}

        {pending && (
          <>
            <div className="interrupt-actions">
              <button className="btn btn--approve" onClick={approve}><Icon name="check" />{t("intr.approve")}</button>
              <button className="btn btn--deny" onClick={props.onDeny}><Icon name="x" />{t("intr.deny")}</button>
              <button className="btn btn--ghost" onClick={openEdit}>{t("intr.edit")}</button>
              <span className="interrupt-hint">resume[0].payload</span>
            </div>
            {editing && (
              <div className="interrupt-edit">
                <textarea value={editJson} onChange={(e) => setEditJson(e.target.value)} spellCheck={false} />
                <div className="interrupt-actions">
                  <button className="btn btn--approve" onClick={approve}>{t("intr.approveEdited")}</button>
                  <button className="btn btn--ghost" onClick={() => setEditing(false)}>{t("intr.cancel")}</button>
                </div>
              </div>
            )}
          </>
        )}

        {!pending && (
          <div className="resolved-row">
            <Icon name={entry.expired ? "clock" : "check"} />
            <span>{entry.status === "approved" ? t("intr.approvedBy") : entry.expired ? t("intr.expired") : t("intr.deniedBy")}</span>
            <time>{timeOf(entry.resolvedAt)}</time>
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
    <div className="summary">
      <div className="summary-line" />
      <div className="summary-body">
        <Icon name="check" />
        <span>{t("chat.endOfRun")}</span>
        <span className="summary-stat"><b>{formatDuration(c.duration())}</b></span>
        <span className="summary-stat"><b>{c.tokens}</b> {t("chat.tokens")}</span>
        <span className="summary-stat"><b>{c.events.length}</b> {t("chat.events")}</span>
        <span className="summary-dots">
          {Object.entries(counts).flatMap(([cat, n]) =>
            Array.from({ length: Math.min(n, 12) }, (_, i) => <i key={`${cat}-${i}`} className={`summary-dot fdot--${cat.slice(0, 4)}`} />)
          )}
        </span>
      </div>
      <div className="summary-line" />
    </div>
  );
}

/* ── state tree ───────────────────────────────────────────────────── */

function StateNode({ name, value, pointer, touched }: { name: string; value: unknown; pointer: string; touched: string[] }) {
  const isObject = value !== null && typeof value === "object";
  const flash = touched.some((t) => t === "*" || t === pointer || (t && pointer.startsWith(t.replace(/\/-$/, "")) && t !== pointer));

  const row = (
    <div className={`node-row ${flash ? "flash" : ""}`}>
      <span className="node-key">{name}</span>
      {isObject ? (
        <span className="node-brace">
          {Array.isArray(value) ? "[" : "{"}
          <span className="node-count">{Array.isArray(value) ? value.length : Object.keys(value as object).length}</span>
        </span>
      ) : (
        <span className={valueTypeClass(value)}>{renderValue(value)}</span>
      )}
    </div>
  );

  if (!isObject) return <div className="node">{row}</div>;

  return (
    <div className="node">
      {row}
      <div className="node-branch">
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
          <StateNode key={key} name={key} value={child} pointer={`${pointer}/${key}`} touched={touched} />
        ))}
      </div>
    </div>
  );
}

function valueTypeClass(value: unknown) {
  if (value === null) return "node-null";
  if (typeof value === "number") return "node-num";
  if (typeof value === "boolean") return "node-bool";
  return "node-str";
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

