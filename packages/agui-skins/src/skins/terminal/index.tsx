import { useEffect, useRef, useState } from "react";
import { useConversation } from "../../host";
import type { AssistantEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, ToolEntry } from "../../contract";
import { formatDuration } from "../../utils";
import { plainText } from "../../utils";
import { Icon } from "../../shared/Icon";
import { t } from "../../i18n";
import { Markdown, timeOf } from "../../shared/Markdown";
import { useStickToBottom } from "../../shared/useStickToBottom";
import "./terminal.css";

const catOf = (type: string) => {
  if (type.startsWith("RUN_") || type.startsWith("STEP_")) return "life";
  if (type.startsWith("TEXT_MESSAGE")) return "text";
  if (type.startsWith("TOOL_CALL")) return "tool";
  if (type.startsWith("STATE_") || type === "MESSAGES_SNAPSHOT") return "state";
  if (type.startsWith("REASONING")) return "reason";
  return "special";
};

const preview = (event: Record<string, unknown>) => {
  const s = (v: unknown) => (v === undefined ? "" : String(v));
  if (event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TOOL_CALL_ARGS" || event.type === "REASONING_MESSAGE_CONTENT")
    return JSON.stringify(s(event.delta));
  if (event.type === "TOOL_CALL_START") return s(event.toolCallName);
  if (event.type === "STATE_DELTA") return ((event.delta as { path: string }[]) || []).map((d) => d.path).join(" ");
  if (event.type === "CUSTOM") return s(event.name);
  if (event.type === "RUN_FINISHED") return JSON.stringify((event.outcome as object) || {});
  return "";
};

export function TerminalPage() {
  const c = useConversation();
  const log = useStickToBottom<HTMLDivElement>();
  const trace = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showDeltas, setShowDeltas] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const running = c.status === "running";
  const traceEvents = (showDeltas
    ? c.events
    : c.events.filter(({ event }) => !/CONTENT$|ARGS$/.test(event.type))
  ).slice(-400);
  const pending = c.entries.find((e): e is InterruptEntry => e.kind === "interrupt" && e.status === "pending");

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (e.key.toLowerCase() === "y") c.resolveInterrupt(true);
      if (e.key.toLowerCase() === "n") c.resolveInterrupt(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, c]);

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  return (
    <div className="skin-term">
      <div className="term-scanlines" aria-hidden="true" />

      <div className="term-shell">
        <header className="term-bar">
          <div className="term-bar-left">
            <span className="term-led" />
            <span className="term-brand">agui</span>
            <span className="term-path">~/threads/{c.threadId.slice(-8)}</span>
          </div>
          <div className="term-bar-right">
            <span className="term-chip">[{c.transport.replace(" ", "-")}]</span>
            <span className="term-chip term-chip--dim">{c.runId}</span>
            <span className={`term-chip term-chip--${c.status}`}>{c.status}</span>
          </div>
        </header>

        <div className="term-body">
          <main className="term-log" ref={log}>
            <div className="term-banner">
              <div className="term-banner-line">AG–UI SESSION {c.threadId} · protocol 1.0</div>
              <div className="term-banner-line term-banner-line--dim">
                streaming events · {c.events.length} received · {c.tokens} tokens
              </div>
            </div>

            {c.entries.map((entry) => (
              <LogEntry
                key={entry.id}
                entry={entry}
                open={!!open[entry.id]}
                onToggle={() => setOpen((p) => ({ ...p, [entry.id]: !p[entry.id] }))}
                live={pending?.id === entry.id}
                onResolve={(approved, id) => c.resolveInterrupt(approved, undefined, id)}
              />
            ))}

            {c.status === "done" && c.entries.length > 0 && (
              <div className="term-rule">
                <span>{t("term.runFinished")} · {formatDuration(c.duration())} · {c.tokens} tokens · {c.events.length} events</span>
              </div>
            )}

            {c.entries.length === 0 && (
              <div className="term-line term-dim">
                <span className="term-prompt">❯</span> {t("term.awaiting")}<span className="term-cursor" />
              </div>
            )}
          </main>

          <aside className="term-trace">
            <div className="term-trace-head">
              <span>{t("term.trace")}</span>
              <button className="term-trace-toggle" onClick={() => setShowDeltas(!showDeltas)}>
                {showDeltas ? "− deltas" : "+ deltas"}
              </button>
              <span className="term-trace-live"><i /> {t("term.live")}</span>
            </div>
            <div className="term-trace-list" ref={trace}>
              {traceEvents.map(({ seq, event }) => (
                <div key={seq} className="term-trace-row" data-cat={catOf(event.type)}>
                  <span className="term-trace-type">{event.type}</span>
                  <span className="term-trace-preview">{preview(event as Record<string, unknown>)}</span>
                </div>
              ))}
              {c.events.length === 0 && <div className="term-trace-empty">no events</div>}
            </div>
            <div className="term-trace-foot">
              <span>{c.events.length} events</span>
              <span className="term-dim">state v{c.stateVersion}</span>
            </div>
          </aside>
        </div>

        <footer className="term-composer">
          <div className="term-input-line">
            <span className="term-prompt term-prompt--big">❯</span>
            <textarea
              ref={input}
              rows={1}
              value={draft}
              spellCheck={false}
              placeholder={t("term.typeMessage")}
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 96) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                if (e.key === "Escape") c.stop();
              }}
            />
            <span className="term-enter">⏎</span>
          </div>
          <div className="term-status">
            <span className={`term-status-item term-status-item--${c.status}`}>
              {running ? "● " + t("term.recording") : c.status === "interrupted" ? "● " + t("term.paused") : c.status === "done" ? "● " + t("term.idle") : "○ " + c.status}
            </span>
            <span className="term-status-item">tok {c.tokens}</span>
            <span className="term-status-item">ev {c.events.length}</span>
            <span className="term-status-item term-dim">state v{c.stateVersion}</span>
            <span className="term-status-item term-dim">{formatDuration(c.duration())}</span>
            <span className="term-status-spacer" />
            <span className="term-status-item term-dim">ag-ui/1.0 · mock sse</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function LogEntry({
  entry,
  open,
  onToggle,
  live,
  onResolve,
}: {
  entry: Entry;
  open: boolean;
  onToggle: () => void;
  live: boolean;
  onResolve: (approved: boolean, interruptId?: string) => void;
}) {
  if (entry.kind === "user") {
    return (
      <div className="term-line term-user">
        <span className="term-prompt">❯</span>
        <span className="term-user-body">{entry.text}</span>
        <span className="term-stamp">{timeOf(entry.at)}</span>
      </div>
    );
  }

  if (entry.kind === "reasoning") {
    return (
      <div className={`term-reason ${open ? "is-open" : ""}`}>
        <button className="term-reason-head" onClick={onToggle}>
          <span className="term-caret">{open ? "▾" : "▸"}</span>
          <span className="term-reason-label">thinking</span>
          <span className="term-dim">{entry.streaming ? "streaming…" : formatDuration(entry.durationMs ?? 0)}</span>
          <span className="term-dim">· {entry.tokens} tok</span>
          {entry.streaming && <span className="term-cursor" />}
        </button>
        {open && (
          <div className="term-reason-body">
            {entry.text}
            {entry.streaming && <span className="term-cursor" />}
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === "tool") return <ToolLine entry={entry} />;
  if (entry.kind === "plan") return <PlanLine entry={entry} />;

  if (entry.kind === "interrupt") {
    const pending = entry.status === "pending";
    return (
      <div className={`term-box ${pending ? "" : "term-box--done"}`}>
        <div className="term-box-head">
          {pending ? "┌─ " + t("term.actionRequired") : "┌─ " + t("term.resolved")} {live ? "· interrupt" : ""}
        </div>
        <div className="term-box-title">{entry.message}</div>
        {entry.description && <div className="term-box-desc">{entry.description}</div>}
        {entry.details.length > 0 && (
          <div className="term-box-terms">
            {entry.details.map((d) => (
              <span key={d.label}>
                <em>{d.label.toLowerCase()}</em> {d.value}
              </span>
            ))}
          </div>
        )}
        {pending ? (
          <div className="term-box-actions">
            <button className="term-key term-key--yes" onClick={() => onResolve(true, entry.id)}>{t("term.approve")}</button>
            <button className="term-key term-key--no" onClick={() => onResolve(false, entry.id)}>{t("term.decline")}</button>
            <span className="term-dim">run paused · resume[] required</span>
          </div>
        ) : (
          <div className={`term-box-resolved ${entry.expired ? "term-box-resolved--expired" : ""}`}>
            {entry.expired ? "✗ " + t("term.expired") : "✓ " + entry.status} · {timeOf(entry.resolvedAt)}
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === "error") {
    return <div className="term-line term-error">error: {entry.message}</div>;
  }

  if (entry.kind === "subagent") {
    return (
      <div className="term-line term-dim">
        <span className="term-prompt">↳</span> [{entry.name}] {entry.status}
        {entry.detail ? ` · ${entry.detail}` : ""}
      </div>
    );
  }
  return <AssistantLine entry={entry} />;
}


function AssistantLine({ entry }: { entry: AssistantEntry }) {
  return (
    <div className="term-assistant">
      <div className="term-assistant-bar" />
      <div className="term-assistant-body">
        <div className="term-assistant-head">
          <span className="term-who">agui</span>
          <span className="term-dim">{timeOf(entry.at)}</span>
          {entry.streaming && <span className="term-dim term-blink">writing…</span>}
        </div>
        <Markdown className={`term-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
      </div>
    </div>
  );
}

function ToolLine({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const result = entry.result as { results?: { title: string; url: string }[]; reservation?: string } | undefined;
  return (
    <div className="term-tool">
      <button className="term-tool-head" onClick={() => setOpen(!open)}>
        <span className="term-tool-mark">
          {entry.status === "done" ? "✓" : entry.status === "error" ? "✗" : entry.status === "interrupted" ? "‖" : "⟳"}
        </span>
        <span className="term-tool-name">{entry.name}</span>
        <span className="term-dim term-tool-args">{entry.argsRaw.slice(0, 52)}</span>
        <span className="term-dim term-tool-time">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
      </button>
      {open && (
        <pre className="term-tool-json">{JSON.stringify(entry.args ?? entry.argsRaw, null, 2)}</pre>
      )}
      {entry.status === "done" && result?.results && (
        <div className="term-tool-result">
          {result.results.map((r, i) => (
            <div key={r.url} className="term-tree">
              <span className="term-dim">{i === result.results!.length - 1 ? "└" : "├"}</span>{" "}
              <a href={r.url} target="_blank" rel="noreferrer">{plainText(r.title, 62)}</a>
            </div>
          ))}
        </div>
      )}
      {entry.status === "done" && result?.reservation && (
        <div className="term-tool-result">
          <span className="term-dim">└</span> held · {result.reservation}
        </div>
      )}
    </div>
  );
}

function PlanLine({ entry }: { entry: PlanEntry }) {
  const done = entry.steps.filter((s) => s.state === "done").length;
  const pct = Math.round((done / entry.steps.length) * 100);
  const filled = Math.round((done / entry.steps.length) * 12);
  return (
    <div className="term-plan">
      <div className="term-plan-head">
        <span className="term-plan-title">▸ {t("term.plan")} · {entry.title.toLowerCase()}</span>
        <span className="term-bar-meter">[{"█".repeat(filled)}{"░".repeat(12 - filled)}] {pct}%</span>
      </div>
      {entry.steps.map((s) => (
        <div key={s.id} className="term-plan-step" data-state={s.state}>
          <span className="term-check">{s.state === "done" ? "[x]" : s.state === "active" ? "[~]" : "[ ]"}</span>
          {s.label}
          {s.state === "active" && <span className="term-cursor" />}
        </div>
      ))}
    </div>
  );
}

export default {
  id: "terminal",
  name: "Terminal",
  tagline: "Phosphor CLI · raw event trace",
  swatch: ["#05070a", "#0c1310", "#8cffb0"] as [string, string, string],
  ChatPage: TerminalPage,
};


