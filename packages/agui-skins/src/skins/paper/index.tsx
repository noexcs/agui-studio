import { useMemo, useRef, useState } from "react";
import { useConversation } from "../../host";
import type { AssistantEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, SubagentEntry, ToolEntry } from "../../contract";
import { formatDuration, estimateTokens } from "../../utils";
import { plainText } from "../../utils";
import { toolStage } from "../../shared/toolStatus";
import { Icon } from "../../shared/Icon";
import { t } from "../../i18n";
import { useSkinBranding } from "../../host";
import { Markdown, timeOf } from "../../shared/Markdown";
import { pendingInterrupts } from "../../shared/interrupts";
import { useStickToBottom } from "../../shared/useStickToBottom";
import "./paper.css";

const fmt = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
};

export function PaperPage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const scroller = useStickToBottom<HTMLDivElement>();
  const notesRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [signingId, setSigningId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<Record<string, string>>({});
  const input = useRef<HTMLTextAreaElement>(null);
  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries)[0];

  const letters = c.entries.filter((e) => e.kind === "user" || e.kind === "assistant" || e.kind === "interrupt" || e.kind === "error");
  const notes = c.entries.filter((e) => e.kind === "reasoning" || e.kind === "tool" || e.kind === "plan" || e.kind === "subagent");
  const firstAssistant = useMemo(() => c.entries.find((e) => e.kind === "assistant")?.id, [c.entries]);
  // While the run is mid-tool the main column would otherwise sit empty
  // (letters only gain an entry as they are written) — name the activity in
  // progress, or keep naming the last artefact in the gaps between events.
  const activeNote = [...c.entries].reverse().find(
    (e): e is ReasoningEntry | ToolEntry | SubagentEntry =>
      (e.kind === "reasoning" && e.streaming) ||
      (e.kind === "tool" && (e.status === "args" || e.status === "executing")) ||
      (e.kind === "subagent" && e.status === "running")
  );
  const lastNote = notes[notes.length - 1];
  const progressNote = activeNote ?? lastNote;
  const progressLabel = progressNote
    ? progressNote.kind === "reasoning"
      ? t("paper.thinking")
      : progressNote.kind === "tool"
      ? `${t("paper.toolCall")} · ${progressNote.name}`
      : progressNote.kind === "plan"
      ? `${t("paper.plan")} · ${progressNote.title}`
      : `${t("paper.subagent")} · ${progressNote.name}`
    : "";

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  function beginSigning(id?: string) {
    const target = id
      ? c.entries.find((e): e is InterruptEntry => e.kind === "interrupt" && e.id === id && e.status === "pending")
      : pending;
    if (!target) return;
    const tool = c.entries.find((e): e is ToolEntry => e.kind === "tool" && e.id === target.toolCallId);
    // Draft state is keyed by interrupt id: several pending cards must never
    // share an editor or submit each other's args.
    setEditJson((prev) => ({ ...prev, [target.id]: JSON.stringify(tool?.args ?? {}, null, 2) }));
    setSigningId(target.id);
  }

  function approve(id?: string) {
    if (id && signingId === id) {
      try {
        c.resolveInterrupt(true, JSON.parse(editJson[id] ?? ""), id);
      } catch {
        c.resolveInterrupt(true, undefined, id);
      }
    } else {
      c.resolveInterrupt(true, undefined, id);
    }
    setSigningId(null);
  }

  return (
    <div className="skin-paper">
      <div className="pap-grain" aria-hidden="true" />
      <div className="pap-shell">
        <header className="pap-masthead">
          <div className="pap-mast-left">
            <span className="pap-kicker">{t("paper.fieldNotes")}</span>
            <span className="pap-rule" />
            <span className="pap-mast-title">{brand.agentName}</span>
          </div>
          <div className="pap-mast-right">
            <span className="pap-meta">{fmt(c.events[0]?.event.timestamp as string)} · {c.threadId.slice(-6).toUpperCase()}</span>
            <span className={`pap-status pap-status--${c.status}`}>
              {c.status === "running" ? t("paper.recording") : c.status === "interrupted" ? t("paper.awaiting") : c.status === "done" ? t("paper.filed") : t(("status." + c.status) as never)}
            </span>
          </div>
        </header>

        <div className="pap-body">
          {/* main column: the correspondence */}
          <div className="pap-main" ref={scroller}>
            <div className="pap-column">
              <div className="pap-lead">
                <p>{t("paper.lead")}</p>
              </div>

              {letters.map((entry) => (
                <div key={entry.id} className="pap-entry">
                  {entry.kind === "user" && (
                    <div className="pap-user">
                      <div className="pap-user-tag">{t("chat.you")} · {timeOf(entry.at)}</div>
                      <p>{entry.text}</p>
                    </div>
                  )}

                  {entry.kind === "assistant" && (
                    <article className={`pap-letter ${entry.id === firstAssistant ? "pap-letter--lede" : ""}`}>
                      <div className="pap-letter-tag">
                        <span className="pap-dotmark" />
                        <span>{t("chat.assistant")}</span>
                        <span className="pap-letter-meta">
                          {entry.streaming ? t("status.writing") : `${estimateTokens(entry.text)} ${t("chat.tokens")}`}
                        </span>
                      </div>
                      <Markdown className={`pap-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
                    </article>
                  )}

                  {entry.kind === "error" && (
                    <article className="pap-error">
                      <div className="pap-error-tag">
                        <span className="pap-dotmark" />
                        <span>{t("paper.errorLabel")}</span>
                        <span className="pap-letter-meta">RUN_ERROR</span>
                      </div>
                      <p className="pap-error-msg">{entry.message}</p>
                    </article>
                  )}

                  {entry.kind === "interrupt" && (
                    <div className={`pap-slip ${entry.status === "pending" ? "pap-slip--open" : entry.expired ? "pap-slip--expired" : "pap-slip--signed"}`}>
                      <div className="pap-slip-head">
                        <span className="pap-slip-label">
                          {entry.status === "pending" ? t("paper.authorisation") : entry.expired ? t("paper.expiredLabel") : entry.status === "approved" ? t("paper.signedLabel") : t("paper.declinedLabel")}
                        </span>
                        <span className="pap-slip-no">{timeOf(entry.at)}</span>
                      </div>
                      <div className="pap-slip-body">
                        <p className="pap-slip-title">{entry.message}</p>
                        {entry.description && <p className="pap-slip-desc">{entry.description}</p>}
                        <div className="pap-slip-terms">
                          {entry.details.map((d) => (
                            <div key={d.label}>
                              <span>{d.label}</span>
                              <b>{d.value}</b>
                            </div>
                          ))}
                        </div>
                      </div>
                      {entry.status === "pending" ? (
                        <div className="pap-slip-actions">
                          <button className="pap-sign" onClick={() => approve(entry.id)} disabled={!pending}>
                            {t("paper.sign")}
                          </button>
                          <button className="pap-decline" onClick={() => c.resolveInterrupt(false, undefined, entry.id)}>
                            {t("paper.decline")}
                          </button>
                          <button className="pap-editlink" onClick={() => beginSigning(entry.id)}>{t("paper.amend")}</button>
                        </div>
                      ) : (
                        <div className="pap-slip-signed">
                          {entry.status === "approved" ? t("paper.signed") : entry.expired ? t("paper.expired") : t("paper.declined")} · {timeOf(entry.resolvedAt)}
                        </div>
                      )}
                      {entry.status === "pending" && signingId === entry.id && (
                        <div className="pap-amend">
                          <label>{t("paper.amendLabel")}</label>
                          <textarea
                            value={editJson[entry.id] ?? ""}
                            onChange={(e) => setEditJson((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                            spellCheck={false}
                          />
                          <div className="pap-slip-actions">
                            <button className="pap-sign" onClick={() => approve(entry.id)}>{t("paper.signEdit")}</button>
                            <button className="pap-editlink" onClick={() => setSigningId(null)}>{t("intr.cancel")}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* P.S. cards: the agent's suggested next lines, clickable */}
              {c.suggestions.length > 0 && (
                <div className="pap-ps">
                  {c.suggestions.map((text) => (
                    <button key={text} className="pap-ps-card" onClick={() => c.send(text)}>
                      <span className="pap-ps-label">{t("paper.ps")}</span>
                      <span className="pap-ps-text">{text}</span>
                      <span className="pap-ps-hint">{t("paper.psHint")}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* the pen is still moving: name what the agent is doing */}
              {c.status === "running" && (activeNote || letters.length === 0) && (
                <div className="pap-progress" aria-live="polite">
                  <span className="pap-progress-rule" aria-hidden="true" />
                  <span className="pap-progress-body">
                    <span className="pap-progress-mark" aria-hidden="true">✎</span>
                    <span className="pap-progress-text">
                      {t("paper.inProgress")}
                      {progressLabel ? ` — ${progressLabel}` : ""}
                    </span>
                    <i className="pap-blink" aria-hidden="true" />
                  </span>
                </div>
              )}

              {c.entries.length > 0 && c.status === "done" && (
                <div className="pap-colophon">
                  <span>{t("paper.end")}</span>
                  <span>{formatDuration(c.duration())} · {c.tokens} tokens · {c.events.length} protocol events</span>
                </div>
              )}
            </div>
          </div>

          {/* margin: protocol artefacts as footnotes */}
          <aside className="pap-rail">
            <div className="pap-rail-head">
              <span>{t("paper.marginNotes")}</span>
              <span className="pap-rail-run">{c.runId}</span>
            </div>
            <div className="pap-rail-scroll" ref={notesRef}>
              {notes.length === 0 && <p className="pap-empty">{t("paper.marginEmpty")}</p>}

              {notes.map((entry, i) => (
                <div key={entry.id} className="pap-note">
                  <span className="pap-note-no">{String(i + 1).padStart(2, "0")}</span>
                  {entry.kind === "reasoning" && <ReasoningNote entry={entry} />}
                  {entry.kind === "tool" && <ToolNote entry={entry} />}
                  {entry.kind === "plan" && <PlanNote entry={entry} />}
                  {entry.kind === "subagent" && <SubagentNote entry={entry} />}
                </div>
              ))}

              {Object.keys(c.sharedState).length > 0 && (
                <div className="pap-note">
                  <span className="pap-note-no">§</span>
                  <div className="pap-note-body">
                    <div className="pap-note-label">{t("paper.sharedState")} · v{c.stateVersion}</div>
                    <dl className="pap-dl">
                      <dt>budget</dt>
                      <dd>€{(c.sharedState as any).trip?.budget ?? "—"}</dd>
                      <dt>lodging</dt>
                      <dd>€{(c.sharedState as any).budget?.lodging ?? 0}</dd>
                      <dt>total</dt>
                      <dd>€{(c.sharedState as any).budget?.total ?? 0}</dd>
                      <dt>days</dt>
                      <dd>{((c.sharedState as any).itinerary ?? []).length}</dd>
                      <dt>bookings</dt>
                      <dd>{((c.sharedState as any).bookings ?? []).length}</dd>
                    </dl>
                  </div>
                </div>
              )}
            </div>
            <div className="pap-rail-foot">
              <span>{c.events.length} events</span>
              <span className="pap-mono">STATE_DELTA × {Math.max(0, c.stateVersion - 1)}</span>
            </div>
          </aside>
        </div>

        <footer className="pap-composer">
          <div className="pap-composer-inner">
            <span className="pap-composer-prompt">{t("chat.reply")}</span>
            <textarea
              ref={input}
              rows={1}
              value={draft}
              placeholder={t("chat.replyPlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                if (e.key === "Escape") c.stop();
              }}
            />
            {running ? (
              <button className="pap-send pap-send--stop" onClick={() => c.stop()}>{t("chat.stop")}</button>
            ) : (
              <button className="pap-send" onClick={send} disabled={!draft.trim()}>{t("chat.send")}</button>
            )}
          </div>
          <div className="pap-composer-hint">
            <span>{t("paper.hint")}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ReasoningNote({ entry }: { entry: ReasoningEntry }) {
  return (
    <div className="pap-note-body">
      <div className="pap-note-label">
        {t("paper.thinking")} {entry.streaming && <i className="pap-blink" />}
        <span className="pap-note-meta">{entry.streaming ? t("paper.inProgress") : formatDuration(entry.durationMs ?? 0)}</span>
      </div>
      <p className="pap-quote">{plainText(entry.text, 220)}</p>
    </div>
  );
}

function ToolNote({ entry }: { entry: ToolEntry }) {
  const stage = toolStage(entry.status);
  const result = entry.result as { results?: { title: string; url: string }[]; reservation?: string; status?: string } | undefined;
  return (
    <div className="pap-note-body">
      <div className="pap-note-label">
        {t("paper.toolCall")} <span className="pap-mono pap-toolname">{entry.name}</span>
      </div>
      <pre className="pap-args">{entry.argsRaw ? JSON.stringify(entry.args ?? entry.argsRaw, null, 1) : "…"}</pre>
      {stage === "error" ? (
        <div className="pap-note-meta pap-note-meta--error">
          <span className="pap-fail">✗</span> {entry.error ?? t("status.error")}
        </div>
      ) : stage !== "done" ? (
        <div className="pap-note-meta">
          {stage === "streaming" ? t("chat.streamingArgs") : stage === "interrupted" ? t("chat.interrupted") : t("chat.executing")}
        </div>
      ) : (
        <div className="pap-result">
          <span className="pap-check">✓</span>
          {result?.results
            ? `${result.results.length} ${t("chat.sources")}`
            : result?.reservation
            ? `${t("chat.held")} · ${result.reservation}`
            : t("chat.done")}
          <span className="pap-note-meta">{formatDuration(entry.durationMs ?? 0)}</span>
        </div>
      )}
      {result?.results && (
        <ol className="pap-sources">
          {result.results.map((r) => (
            <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{plainText(r.title, 46)}</a></li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PlanNote({ entry }: { entry: PlanEntry }) {
  const done = entry.steps.filter((s) => s.state === "done").length;
  return (
    <div className="pap-note-body">
      <div className="pap-note-label">
        {t("paper.plan")} <span className="pap-note-meta">{done}/{entry.steps.length}</span>
      </div>
      <ul className="pap-plan">
        {entry.steps.map((s) => (
          <li key={s.id} data-state={s.state}>
            <span className="pap-plan-box">{s.state === "done" ? "×" : s.state === "active" ? "~" : ""}</span>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubagentNote({ entry }: { entry: SubagentEntry }) {
  return (
    <div className="pap-note-body">
      <div className="pap-note-label">
        {t("paper.subagent")} <span className="pap-mono pap-toolname">{entry.name}</span>
        <span className="pap-note-meta">{entry.status}</span>
      </div>
      {entry.detail && <p className="pap-quote">{plainText(entry.detail, 220)}</p>}
    </div>
  );
}

export default {
  id: "paper",
  name: "Paper",
  tagline: "Editorial light · margin notes",
  swatch: ["#f4efe6", "#e7dfd0", "#b4472c"] as [string, string, string],
  ChatPage: PaperPage,
};

