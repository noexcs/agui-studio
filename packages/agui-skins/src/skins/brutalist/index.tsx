import { useState } from "react";
import { useConversation } from "../../host";
import type { AssistantEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, SubagentEntry, ToolEntry } from "../../contract";
import { formatDuration } from "../../utils";
import { plainText } from "../../utils";
import { toolStage } from "../../shared/toolStatus";
import { Markdown, timeOf } from "../../shared/Markdown";
import { pendingInterrupts } from "../../shared/interrupts";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { t } from "../../i18n";
import { useSkinBranding } from "../../host";
import "./brutalist.css";

export function BrutalistPage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const scroller = useStickToBottom<HTMLDivElement>();
  const [draft, setDraft] = useState("");
  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries)[0];

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  return (
    <div className="skin-brut">
      <header className="bru-top">
        <div className="bru-wordmark">
          <span className="bru-mark">AG</span>
          <span className="bru-mark bru-mark--alt">UI</span>
          <span className="bru-top-sub">conversation system / v1.0</span>
        </div>
        <div className="bru-top-right">
          <span className="bru-top-meta">thread {c.threadId.slice(-8)}</span>
          <span className={`bru-state bru-state--${c.status}`}>{c.status}{pendingInterrupts(c.entries).length > 1 ? ` ×${pendingInterrupts(c.entries).length}` : ""}</span>
        </div>
      </header>

      <div className="bru-body">
        <aside className="bru-index">
          <div className="bru-label">{t("bru.index")}</div>
          {[
            ["01", t("thread.trip"), true],
            ["02", t("thread.auth"), false],
            ["03", t("thread.digest"), false],
            ["04", t("thread.budget"), false],
          ].map(([n, title, active]) => (
            <button key={String(n)} className={`bru-item ${active ? "is-active" : ""}`}>
              <span className="bru-item-no">{n}</span>
              <span>{title}</span>
            </button>
          ))}
          <button className="bru-new" onClick={() => c.replay()}>
            <span>{t("bru.newThread")}</span>
          </button>
          <div className="bru-index-foot">
            <span>agent</span>
            <span className="bru-strong">{brand.agentName}</span>
            <span>transport</span>
            <span className="bru-strong">SSE · mock</span>
          </div>
        </aside>

        <main className="bru-chat">
          <div className="bru-chat-head">
            <div>
              <h1>{brand.agentName}</h1>
              <p className="bru-sub">{brand.modelLabel} · tools (4) · reasoning · state · interrupts</p>
            </div>
            <div className="bru-run">
              <span className="bru-run-label">run</span>
              <span className="bru-run-id">{c.runId}</span>
            </div>
          </div>

          <div className="bru-scroll" ref={scroller}>
            <div className="bru-stack">
              {c.entries.length === 0 && (
                <div className="bru-empty">
                  <span className="bru-empty-big">{t("bru.awaiting")}</span>
                  <span className="bru-empty-cursor" aria-hidden="true" />
                </div>
              )}

              {c.entries.map((entry) => (
                <BruEntry key={entry.id} entry={entry} pending={pending} />
              ))}

              {c.status === "done" && c.entries.length > 0 && (
                <div className="bru-summary">
                  <span>■ {t("bru.endOfRun")}</span>
                  <span>{formatDuration(c.duration())} / {c.tokens} tok / {c.events.length} events</span>
                  <button className="bru-replay" onClick={() => c.replay()}>{t("bru.replay")}</button>
                </div>
              )}
            </div>
          </div>

          <footer className="bru-composer">
            {c.suggestions.length > 0 && (
              <div className="bru-suggest">
                {c.suggestions.map((text) => (
                  <button key={text} className="bru-suggest-chip" onClick={() => setDraft(text)}>
                    {text}
                  </button>
                ))}
              </div>
            )}
            <div className="bru-composer-row">
              <textarea
                rows={1}
                value={draft}
                placeholder={t("bru.write")}
                onChange={(e) => setDraft(e.target.value)}
                onInput={(e) => {
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 110) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  if (e.key === "Escape") c.stop();
                }}
              />
              {running ? (
                <button className="bru-send bru-send--stop" onClick={() => c.stop()}>{t("bru.stop")}</button>
              ) : (
                <button className="bru-send" onClick={send} disabled={!draft.trim()}>{t("bru.send")}</button>
              )}
            </div>
          </footer>
        </main>

        <aside className="bru-side">
          <div className="bru-side-block">
            <div className="bru-label bru-label--light">{t("bru.sharedState")}</div>
            <div className="bru-stat">
              <span>budget</span><b>€{(c.sharedState as any).trip?.budget ?? "—"}</b>
            </div>
            <div className="bru-stat"><span>spent</span><b>€{(c.sharedState as any).budget?.total ?? 0}</b></div>
            <div className="bru-stat"><span>days</span><b>{((c.sharedState as any).itinerary ?? []).length}</b></div>
            <div className="bru-stat"><span>bookings</span><b>{((c.sharedState as any).bookings ?? []).length}</b></div>
            <div className="bru-stat"><span>state ver.</span><b>v{c.stateVersion}</b></div>
          </div>

          <div className="bru-side-block">
            <div className="bru-label bru-label--light">{t("bru.events")}</div>
            <div className="bru-evcount">{c.events.length}</div>
            <div className="bru-evlist">
              {c.events.slice(-7).reverse().map(({ seq, event }) => (
                <div key={seq} className="bru-ev" data-cat={cat(event.type)}>
                  <span>{event.type}</span>
                </div>
              ))}
            </div>
            <div className="bru-transport">mock SSE · {c.tokens} tokens</div>
          </div>

          <div className="bru-side-foot">
            <span>protocol 1.0</span>
            <a href="https://docs.ag-ui.com/introduction" target="_blank" rel="noreferrer">docs ↗</a>
          </div>
        </aside>
      </div>
    </div>
  );
}

const cat = (type: string) => {
  if (type.startsWith("RUN_") || type.startsWith("STEP_")) return "life";
  if (type.startsWith("TOOL_CALL")) return "tool";
  if (type.startsWith("STATE_")) return "state";
  if (type.startsWith("REASONING")) return "reason";
  if (type.startsWith("TEXT_MESSAGE")) return "text";
  return "special";
};

function BruEntry({ entry, pending }: { entry: Entry; pending?: InterruptEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="bru-user">
        <div className="bru-tag bru-tag--dark">USER · {timeOf(entry.at)}</div>
        <p>{entry.text}</p>
      </div>
    );
  }
  if (entry.kind === "assistant") return <BruAssistant entry={entry} />;
  if (entry.kind === "reasoning") return <BruReasoning entry={entry} />;
  if (entry.kind === "tool") return <BruTool entry={entry} />;
  if (entry.kind === "plan") return <BruPlan entry={entry} />;
  if (entry.kind === "interrupt") return <BruInterrupt entry={entry} live={pending?.id === entry.id} />;
  if (entry.kind === "error") return <div className="bru-error">RUN_ERROR · {entry.message}</div>;
  if (entry.kind === "subagent") return <BruSubagent entry={entry} />;
  return null;
}

function BruSubagent({ entry }: { entry: SubagentEntry }) {
  return (
    <div className="bru-subagent" data-status={entry.status}>
      <div className="bru-subagent-head">
        <span className="bru-subagent-tag">{t("bru.subagent")}</span>
        <span className="bru-subagent-name">{entry.name}</span>
        <span className="bru-subagent-status">{entry.status.toUpperCase()}</span>
      </div>
      {entry.detail && <p className="bru-subagent-detail">{entry.detail}</p>}
    </div>
  );
}

function BruAssistant({ entry }: { entry: AssistantEntry }) {
  return (
    <div className="bru-agent">
      <div className="bru-tag">AGENT</div>
      <Markdown className={`bru-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
    </div>
  );
}

function BruReasoning({ entry }: { entry: ReasoningEntry }) {
  return (
    <div className="bru-think" data-skin-text="">
      <div className="bru-think-head">
        <span>{t("bru.thinking")}</span>
        <span>{entry.streaming ? "…" : formatDuration(entry.durationMs ?? 0)}</span>
      </div>
      <p>{plainText(entry.text, 240)}</p>
    </div>
  );
}

function BruTool({ entry }: { entry: ToolEntry }) {
  const stage = toolStage(entry.status);
  const result = entry.result as { results?: { title: string; url: string }[]; reservation?: string } | undefined;
  return (
    <div className="bru-tool">
      <div className="bru-tool-head">
        <span className="bru-tool-name">{entry.name.toUpperCase()}</span>
        <span className="bru-tool-status">
          {stage === "done" ? "■ DONE" : stage === "interrupted" ? "‖ INTERRUPTED" : stage === "error" ? "✕ ERROR" : "▶ " + entry.status.toUpperCase()}
        </span>
      </div>
      <pre className="bru-tool-args" data-skin-text="">{entry.argsRaw ? JSON.stringify(entry.args ?? entry.argsRaw, null, 1) : "…"}</pre>
      {result?.results && (
        <div className="bru-tool-results">
          {result.results.map((r, i) => (
            <a key={r.url} href={r.url} target="_blank" rel="noreferrer">
              {String(i + 1).padStart(2, "0")} {plainText(r.title, 54)} ↗
            </a>
          ))}
        </div>
      )}
      {result?.reservation && <div className="bru-tool-results">{t("bru.held")} · {result.reservation}</div>}
    </div>
  );
}

function BruPlan({ entry }: { entry: PlanEntry }) {
  return (
    <div className="bru-plan">
      <div className="bru-plan-head">
        <span>{t("bru.plan")}</span>
        <span>{entry.title.toUpperCase()}</span>
      </div>
      {entry.steps.map((s) => (
        <div key={s.id} className="bru-step" data-state={s.state}>
          <span className="bru-box">{s.state === "done" ? "■" : s.state === "active" ? "▣" : "□"}</span>
          {s.label.toUpperCase()}
        </div>
      ))}
    </div>
  );
}

function BruInterrupt({ entry, live }: { entry: InterruptEntry; live: boolean }) {
  const c = useConversation();
  const pending = entry.status === "pending";
  return (
    <div className={`bru-approve ${pending ? "" : entry.expired ? "bru-approve--expired" : "bru-approve--done"}`}>
      <div className="bru-approve-head">
        {pending ? "▲ " + t("bru.approvalRequired") : entry.expired ? "■ " + t("bru.expired") : "■ " + t("bru.resolved")}
        <span>{timeOf(entry.at)}</span>
      </div>
      <h3>{entry.message}</h3>
      {entry.description && <p className="bru-approve-desc">{entry.description}</p>}
      <div className="bru-approve-terms">
        {entry.details.map((d) => (
          <div key={d.label}>
            <span>{d.label}</span>
            <b>{d.value}</b>
          </div>
        ))}
      </div>
      {pending ? (
        <div className="bru-approve-actions">
          <button className="bru-btn bru-btn--ok" onClick={() => c.resolveInterrupt(true, undefined, entry.id)}>{t("bru.approve")}</button>
          <button className="bru-btn bru-btn--no" onClick={() => c.resolveInterrupt(false, undefined, entry.id)}>{t("bru.deny")}</button>
          <span className="bru-approve-note">{t("bru.paused")} · {live ? t("bru.waiting") : t("bru.interrupt")}</span>
        </div>
      ) : (
        <div className={`bru-approve-resolved ${entry.expired ? "bru-approve-resolved--expired" : ""}`}>
          {entry.expired
            ? timeOf(entry.resolvedAt)
            : `✓ ${entry.status === "approved" ? t("bru.approvedByYou") : t("bru.deniedByYou")} · ${timeOf(entry.resolvedAt)}`}
        </div>
      )}
    </div>
  );
}

export default {
  id: "brutalist",
  name: "Brutalist",
  tagline: "Hard borders · loud approvals",
  swatch: ["#f2efe6", "#111111", "#ffe14d"] as [string, string, string],
  ChatPage: BrutalistPage,
};
