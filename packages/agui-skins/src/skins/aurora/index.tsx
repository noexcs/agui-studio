import { useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "../../host";
import type { AssistantEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, SubagentEntry, ToolEntry } from "../../contract";
import { formatDuration, estimateTokens } from "../../utils";
import { Icon } from "../../shared/Icon";
import { t } from "../../i18n";
import { useSkinBranding } from "../../host";
import * as RadixTabs from "@radix-ui/react-tabs";
import { JsonView, darkStyles } from "react-json-view-lite";
import { Markdown, timeOf } from "../../shared/Markdown";
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
  const brand = useSkinBranding();
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"events" | "state">("events");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useStickToBottom<HTMLDivElement>();
  const eventList = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);


  useEffect(() => {
    const el = eventList.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c.events.length, filter]);

  const events = useMemo(
    () => (filter === "all" ? c.events : c.events.filter((e) => categoryOf(e.event.type) === filter)),
    [c.events.length, filter, c.getVersion()]
  );

  const running = c.status === "running";
  const interrupt = c.entries.find((e): e is InterruptEntry => e.kind === "interrupt" && e.status === "pending");

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
              <span className="run-pill-text">{t(("status." + c.status) as never)}</span>
              <span className="run-pill-meta mono">{c.status === "idle" ? "" : formatDuration(c.duration())}</span>
            </div>
            <button className="icon-btn" title="Replay run" onClick={() => c.replay()}>
              <Icon name="refresh" />
            </button>
            <div className="avatar" title="noexcs">N</div>
          </div>
        </header>

        <div className="workspace">
          {/* sidebar */}
          <aside className="panel sidebar">
            <div className="side-top">
              <button className="new-thread" onClick={() => c.replay()}>
                <Icon name="plus" />
                {t("chat.newThread")}
                <kbd className="kbd">⌘N</kbd>
              </button>
              <label className="search">
                <Icon name="search" />
                <input type="text" placeholder={t("chat.search")} />
              </label>
            </div>

            <div className="side-scroll">
              <div className="side-group">
                <div className="side-label">{t("chat.threads")}</div>
                {[
                  [t("thread.trip"), "thread_01J9F2 · now", "mint", true],
                  [t("thread.auth"), "thread_01J9C7 · 1h", "violet", false],
                  [t("thread.digest"), "thread_01J8QX · 3h", "cyan", false],
                  [t("thread.budget"), "thread_01J7M1 · Tue", "amber", false],
                ].map(([title, meta, tone, active]) => (
                  <button key={String(title)} className={`thread ${active ? "is-active" : ""}`}>
                    <span className={`thread-dot thread-dot--${tone}`} />
                    <span className="thread-body">
                      <span className="thread-title">{title}</span>
                      <span className="thread-meta mono">{meta}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="side-group">
                <div className="side-label">{t("chat.agents")}</div>
                <div className="agent-row is-active">
                  <div className="agent-orb agent-orb--mint" />
                  <div className="agent-body">
                    <span className="agent-name">{brand.agentName}</span>
                    <span className="agent-meta mono">langgraph · sse</span>
                  </div>
                  <span className="agent-badge">{t("chat.live")}</span>
                </div>
                <div className="agent-row">
                  <div className="agent-orb agent-orb--violet" />
                  <div className="agent-body">
                    <span className="agent-name">Research Scout</span>
                    <span className="agent-meta mono">mastra · sse</span>
                  </div>
                </div>
                <div className="agent-row">
                  <div className="agent-orb agent-orb--amber" />
                  <div className="agent-body">
                    <span className="agent-name">Ops Agent</span>
                    <span className="agent-meta mono">adk · ws</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="side-foot">
              <div className="usage">
                <div className="usage-head">
                  <span className="usage-label">{t("chat.context")}</span>
                  <span className="usage-num mono">{c.tokens ? Math.round(c.tokens / 100) / 10 + "k" : "4.2k"} / 200k</span>
                </div>
                <div className="usage-track">
                  <span style={{ width: Math.min(100, 8 + c.tokens / 40) + "%" }} />
                </div>
              </div>
              <div className="user-row">
                <div className="avatar avatar--sm">N</div>
                <div className="user-body">
                  <span className="user-name">noexcs</span>
                  <span className="user-plan">{t("chat.designPreview")}</span>
                </div>
                <button className="icon-btn icon-btn--sm" aria-label="More"><Icon name="more" /></button>
              </div>
            </div>
          </aside>

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
                  <span className="mono" style={{ fontSize: 11 }}>waiting for RUN_STARTED…</span>
                </div>
              )}

              {c.entries.map((entry) => (
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
                    <button key={id} className={`filter ${filter === id ? "is-active" : ""}`} onClick={() => setFilter(id)}>
                      {id !== "all" && <i className={`fdot fdot--${id.slice(0, 4)}`} />}
                      {label}
                    </button>
                  ))}
                </div>

                <div className="ev-list" ref={eventList}>
                  {events.map(({ seq, event, at }) => {
                    const cat = categoryOf(event.type);
                    const firstTs = Date.parse(String(c.events[0]?.event.timestamp ?? ""));
                    const evTs = Date.parse(String(event.timestamp ?? ""));
                    const offset = isFinite(firstTs) && isFinite(evTs) ? "+" + ((evTs - firstTs) / 1000).toFixed(2) + "s" : "";
                    return (
                      <div
                        key={seq}
                        className={`ev-row ${selected === seq ? "is-selected" : ""}`}
                        data-cat={cat}
                        onClick={() => setSelected(selected === seq ? null : seq)}
                      >
                        <div className="ev-main">
                          <div className="ev-top">
                            <span className="ev-type">{event.type}</span>
                            <span className="ev-time">{offset}</span>
                          </div>
                          <div className="ev-preview">{eventPreview(event as Record<string, unknown>)}</div>
                          <div className="ev-json"><JsonView data={event as Record<string, unknown>} style={darkStyles} shouldExpandNode={(level) => level < 3} /></div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="insp-foot">
                  <span className="mono">{events.length} events</span>
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
                  {Object.keys(c.sharedState).length === 0 ? (
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
  return <AssistantBlock entry={entry} />;
}

function AssistantBlock({ entry }: { entry: AssistantEntry }) {
  const brand = useSkinBranding();
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
            <button className="msg-action"><Icon name="refresh" />{t("chat.retry")}</button>
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
          <div className="reason-body">
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
  const dot = entry.name.lastIndexOf(".");
  const ns = dot > -1 ? entry.name.slice(0, dot + 1) : "";
  const name = dot > -1 ? entry.name.slice(dot + 1) : entry.name;
  const result = entry.result as { results?: { title: string; url: string; detail?: string }[]; reservation?: string; status?: string } | undefined;

  return (
    <div className="block">
      <div className="tool" data-status={entry.status}>
        <div className="tool-head">
          <div className="tool-icon"><Icon name="wrench" /></div>
          <span className="tool-name"><span className="tool-namespace">{ns}</span>{name}</span>
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
          {entry.argsRaw && <div className="tool-args">{JSON.stringify(entry.args ?? entry.argsRaw, null, 2)}</div>}
          {result?.results && (
            <div className="tool-result">
              <div className="tool-result-head"><Icon name="globe" />{result.results.length} {t("chat.sources")}</div>
              <div className="tool-result-list">
                {result.results.map((r, i) => (
                  <a key={r.url} className="tool-source" href={r.url} target="_blank" rel="noreferrer">
                    <span className="tool-source-num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="tool-source-title">{r.title}</span>
                    <Icon name="arrow-up-right" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {result && !result.results && (
            <div className="tool-result">
              <div className="tool-result-head"><Icon name="check" />result</div>
              <div className="tool-args">{JSON.stringify(result, null, 2)}</div>
            </div>
          )}
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
          <span className="reason-label">{entry.name}</span>
          <span className="reason-meta mono">{entry.status}</span>
        </div>
        {entry.detail && <div className="reason-body">{entry.detail}</div>}
      </div>
    </div>
  );
}

function PlanBlock({ entry }: { entry: PlanEntry }) {
  const done = entry.steps.filter((s) => s.state === "done").length;
  const pct = entry.steps.length ? Math.round((done / entry.steps.length) * 100) : 0;
  return (
    <div className="block">
      <div className="plan">
        <div className="plan-head">
          <span className="plan-icon"><Icon name="activity" /></span>
          <span className="plan-title">{entry.title}</span>
          <span className="plan-tag">ACTIVITY · {entry.activityType}</span>
        </div>
        {entry.steps.length === 0 && entry.content ? (
          <pre className="tool-args">{JSON.stringify(entry.content, null, 2)}</pre>
        ) : (
        <div className="plan-steps">
          {entry.steps.map((step) => (
            <div key={step.id} className="plan-step" data-state={step.state}>
              <span className="plan-check">{step.state === "done" && <Icon name="check" />}</span>
              <span className="plan-step-label">{step.label}</span>
              {step.state === "active" && <span className="plan-step-time mono">running</span>}
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
      <div className={`interrupt ${pending ? "" : entry.expired ? "interrupt--expired" : "interrupt--resolved"} ${!live && pending ? "is-busy" : ""}`}>
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

