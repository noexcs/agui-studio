import { useMemo, useRef, useState } from "react";
import { useConversation } from "../../host";
import type { AssistantEntry, Entry, InterruptEntry, PlanEntry, ReasoningEntry, SubagentEntry, ToolEntry } from "../../contract";
import { formatDuration, estimateTokens } from "../../utils";
import { plainText } from "../../utils";
import { toolStage } from "../../shared/toolStatus";
import { ToolResult, hasToolResultContent } from "../../shared/ToolResult";
import { planView, planRawText } from "../../shared/plan";
import { asArray, asRecord, displayText, isEmptyState, safeJson } from "../../shared/safe";
import { Icon } from "../../shared/Icon";
import { t } from "../../i18n";
import { useSkinBranding } from "../../host";
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
import "./paper.css";

const fmt = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
};

export function PaperPage() {
  const c = useConversation();
  const { visible: visibleEntries, hidden, showEarlier } = useVisibleEntries(c.entries);
  const brand = useSkinBranding();
  const scroller = useStickToBottom<HTMLDivElement>();
  const notesRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [signingId, setSigningId] = useState<string | null>(null);
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [editJson, setEditJson] = useState<Record<string, string>>({});
  const input = useRef<HTMLTextAreaElement>(null);
  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries)[0];
  // The demo state is an object; a third-party snapshot may be a scalar/array.
  // Read it through the guards so `.trip?.budget` never runs on null and the
  // panel shows raw JSON rather than fabricated defaults for an unknown shape.
  const shared = asRecord(c.sharedState);
  const sharedTrip = asRecord(shared?.trip);
  const sharedBudget = asRecord(shared?.budget);
  const itinerary = asArray(shared?.itinerary);
  const bookings = asArray(shared?.bookings);
  const hasDemoState =
    !!shared && ["trip", "budget", "itinerary", "bookings"].some((key) => Object.prototype.hasOwnProperty.call(shared, key));
  const showRawState = !isEmptyState(c.sharedState) && !hasDemoState;

  // Consecutive reasoning/tool artefacts collapse into one margin-note group.
  // Grouping runs on the full stream so only truly adjacent entries merge —
  // then the two columns pick their items from the same list.
  const foldItems = useMemo(() => conversationGroups(visibleEntries), [visibleEntries]);
  const letters = foldItems.flatMap((item) =>
    item.type === "entry" && (item.entry.kind === "user" || item.entry.kind === "assistant" || item.entry.kind === "interrupt" || item.entry.kind === "error")
      ? [item.entry]
      : []
  );
  const noteItems = foldItems.filter(
    (item) =>
      item.type === "group" ||
      (item.type === "entry" && (item.entry.kind === "reasoning" || item.entry.kind === "tool" || item.entry.kind === "plan" || item.entry.kind === "subagent"))
  );
  const notes = noteItems.flatMap((item): (ReasoningEntry | ToolEntry | PlanEntry | SubagentEntry)[] => {
    if (item.type === "group") {
      return item.entries.filter((e): e is ReasoningEntry | ToolEntry => e.kind === "reasoning" || e.kind === "tool");
    }
    return item.entry.kind === "reasoning" || item.entry.kind === "tool" || item.entry.kind === "plan" || item.entry.kind === "subagent"
      ? [item.entry]
      : [];
  });
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
      ? `${t("paper.toolCall")} · ${displayText(progressNote.name)}`
      : progressNote.kind === "plan"
      ? `${t("paper.plan")} · ${displayText(progressNote.title)}`
      : `${t("paper.subagent")} · ${displayText(progressNote.name)}`
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

              {noteItems.map((item, i) => (
                <div key={item.type === "group" ? item.id : item.entry.id} className="pap-note">
                  <span className="pap-note-no">{String(i + 1).padStart(2, "0")}</span>
                  {item.type === "group" ? (
                    <FoldNote
                      entries={item.entries}
                      open={foldOverride[item.id] ?? foldGroupOpen(item.entries)}
                      onToggle={() =>
                        setFoldOverride((prev) => ({ ...prev, [item.id]: !(foldOverride[item.id] ?? foldGroupOpen(item.entries)) }))
                      }
                    />
                  ) : (
                    <>
                      {item.entry.kind === "reasoning" && <ReasoningNote entry={item.entry} />}
                      {item.entry.kind === "tool" && <ToolNote entry={item.entry} />}
                      {item.entry.kind === "plan" && <PlanNote entry={item.entry} />}
                      {item.entry.kind === "subagent" && <SubagentNote entry={item.entry} />}
                    </>
                  )}
                </div>
              ))}

              {!isEmptyState(c.sharedState) && (
                <div className="pap-note">
                  <span className="pap-note-no">§</span>
                  <div className="pap-note-body">
                    <div className="pap-note-label">{t("paper.sharedState")} · v{c.stateVersion}</div>
                    {showRawState ? (
                      <pre className="pap-args" data-skin-text="">{safeJson(c.sharedState)}</pre>
                    ) : (
                      <dl className="pap-dl">
                        <dt>budget</dt>
                        <dd>€{sharedTrip?.budget === undefined || sharedTrip?.budget === null ? "—" : displayText(sharedTrip.budget)}</dd>
                        <dt>lodging</dt>
                        <dd>€{sharedBudget?.lodging === undefined || sharedBudget?.lodging === null ? 0 : displayText(sharedBudget.lodging)}</dd>
                        <dt>total</dt>
                        <dd>€{sharedBudget?.total === undefined || sharedBudget?.total === null ? 0 : displayText(sharedBudget.total)}</dd>
                        <dt>days</dt>
                        <dd>{itinerary.length}</dd>
                        <dt>bookings</dt>
                        <dd>{bookings.length}</dd>
                      </dl>
                    )}
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
              aria-label={t("chat.replyPlaceholder")}
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
      <ProtocolDrawer />
    </div>
  );
}

/**
 * One footnote standing in for a run of consecutive thinking/tool notes.
 * Letterpress fold head (+/− mark); failures surface in the meta line so a
 * collapsed group never reads as "all fine".
 */
function FoldNote({ entries, open, onToggle }: { entries: Entry[]; open: boolean; onToggle: () => void }) {
  const failures = foldGroupFailures(entries);
  const failure = failures.includes("error") ? "error" : failures.includes("interrupted") ? "interrupted" : undefined;
  const stats = foldGroupStats(entries);
  return (
    <div className="pap-note-body">
      <button
        type="button"
        className="pap-fold-head"
        data-fold-head=""
        aria-expanded={open}
        aria-label={t("fold.group")}
        data-failure={failure}
        onClick={onToggle}
        onKeyDown={(e) => {
          // explicit for the keydown contract test (jsdom runs no activation)
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="pap-note-label pap-fold-label">
          {t("fold.group")}
          <span className="pap-note-meta">
            {entries.length} {t("fold.steps")}
            {stats.toolCount > 0 ? ` · ${stats.toolCount} ${t("paper.toolCall")}` : ""}
            {failure ? ` · ${failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}` : foldGroupOpen(entries) ? ` · ${t("paper.inProgress")}` : ""}
          </span>
        </span>
        <span className="pap-fold-mark" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="pap-fold-notes">
          {entries.map((entry) =>
            entry.kind === "reasoning" ? (
              <ReasoningNote key={entry.id} entry={entry} />
            ) : entry.kind === "tool" ? (
              <ToolNote key={entry.id} entry={entry} />
            ) : null
          )}
        </div>
      )}
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
  const hasResult = hasToolResultContent(entry);
  return (
    <div className="pap-note-body">
      <div className="pap-note-label">
        {t("paper.toolCall")} <span className="pap-mono pap-toolname">{displayText(entry.name)}</span>
      </div>
      <pre className="pap-args" data-skin-text="">{entry.argsRaw ? safeJson(entry.args ?? entry.argsRaw, 1) : "…"}</pre>
      {stage !== "done" && stage !== "error" && (
        <div className="pap-note-meta">
          {stage === "streaming" ? t("chat.streamingArgs") : stage === "interrupted" ? t("chat.interrupted") : t("chat.executing")}
        </div>
      )}
      <ToolResult entry={entry} variant="paper" />
      {stage === "done" && !hasResult && (
        <div className="pap-result">
          <span className="pap-check">✓</span>
          {t("chat.done")}
          <span className="pap-note-meta">{formatDuration(entry.durationMs ?? 0)}</span>
        </div>
      )}
    </div>
  );
}

function PlanNote({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  const done = view.steps.filter((s) => s.state === "done").length;
  return (
    <div className="pap-note-body">
      <div className="pap-note-label">
        {t("paper.plan")} <span className="pap-note-meta">{done}/{view.steps.length}</span>
      </div>
      {view.rawOnly ? (
        <pre className="pap-args" data-skin-text="">{planRawText(view)}</pre>
      ) : (
        <ul className="pap-plan">
          {view.steps.map((s) => (
            <li key={s.id} data-state={s.state}>
              <span className="pap-plan-box">{s.state === "done" ? "×" : s.state === "active" ? "~" : ""}</span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubagentNote({ entry }: { entry: SubagentEntry }) {
  return (
    <div className="pap-note-body">
      <div className="pap-note-label">
        {t("paper.subagent")} <span className="pap-mono pap-toolname">{displayText(entry.name)}</span>
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

