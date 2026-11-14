import { useState } from "react";
import { useConversation, useSkinPlugins } from "../../host";
import type { Entry, InterruptEntry, PlanEntry, ReasoningEntry, ToolEntry } from "../../contract";
import { formatDuration } from "../../utils";
import { plainText } from "../../utils";
import { ToolResult } from "../../shared/ToolResult";
import { planView, planRawText } from "../../shared/plan";
import { displayText, entriesOf, isEmptyState, safeJson } from "../../shared/safe";
import { t, isZh } from "../../i18n";
import { useSkinBranding } from "../../host";
import { Icon } from "../../shared/Icon";
import { Markdown, timeOf } from "../../shared/Markdown";
import { pendingInterrupts } from "../../shared/interrupts";
import { HistoryMore, useVisibleEntries } from "../../shared/history";
import { useStickToBottom } from "../../shared/useStickToBottom";
import "./classic.css";

/**
 * Classic — the conservative, enterprise-safe surface.
 * Light neutral canvas, system font, 1px borders, one blue accent.
 */
export function ClassicPage() {
  const c = useConversation();
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const plugins = useSkinPlugins();
  const brand = useSkinBranding();
  const scroller = useStickToBottom<HTMLDivElement>();
  const zh = isZh();
  const [draft, setDraft] = useState("");
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<Record<string, string>>({});

  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries)[0];
  // Multiple ACTIVITY_SNAPSHOTs are allowed: list every plan, not just the first.
  const plans = c.entries.filter((e): e is PlanEntry => e.kind === "plan");
  const interrupts = c.entries.filter((e): e is InterruptEntry => e.kind === "interrupt");
  const lastAssistant = [...c.entries].reverse().find((e) => e.kind === "assistant");
  // A shared-state snapshot is not guaranteed to be a plain object. `entriesOf`
  // returns [] for scalars and index keys for arrays; the scalar row keeps real
  // data visible without ever calling Object.keys on a non-object.
  const stateRows: [string, unknown][] = (() => {
    const entries = entriesOf(c.sharedState);
    if (entries.length > 0) return entries;
    return isEmptyState(c.sharedState) ? [] : [["state", c.sharedState]];
  })();

  const statusText = running
    ? zh
      ? "运行中"
      : "Running"
    : c.status === "interrupted"
    ? zh
      ? "等待确认"
      : "Awaiting approval"
    : c.status === "done"
    ? zh
      ? "已完成"
      : "Completed"
    : c.status === "error"
    ? zh
      ? "出错"
      : "Error"
    : c.status === "stopped"
    ? zh
      ? "已停止"
      : "Stopped"
    : zh
    ? "空闲"
    : "Idle";

  function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    c.send(text);
  }

  function beginEdit(id?: string) {
    const target = id
      ? c.entries.find((e): e is InterruptEntry => e.kind === "interrupt" && e.id === id && e.status === "pending")
      : pending;
    if (!target) return;
    const tool = c.entries.find((e): e is ToolEntry => e.kind === "tool" && e.id === target.toolCallId);
    // Draft state is keyed by interrupt id: several pending cards must never
    // share an editor or submit each other's args.
    setEditJson((prev) => ({ ...prev, [target.id]: JSON.stringify(tool?.args ?? {}, null, 2) }));
    setEditingId(target.id);
  }

  function approve(id?: string) {
    if (id && editingId === id) {
      try {
        c.resolveInterrupt(true, JSON.parse(editJson[id] ?? ""), id);
      } catch {
        c.resolveInterrupt(true, undefined, id);
      }
    } else {
      c.resolveInterrupt(true, undefined, id);
    }
    setEditingId(null);
  }

  const threadTitle = zh ? "里斯本三日" : "Lisbon in three days";

  return (
    <div className="skin-classic">
      {/* ── navigation ─────────────────────────────────────────────── */}
      <aside className="cl-nav">
        <div className="cl-nav-head">
          <div className="cl-logo">
            <span className="cl-logo-mark">AG</span>
            <span className="cl-logo-text">Assistant</span>
          </div>
        </div>

        <button className="cl-new">
          <Icon name="plus" size={14} />
          {t("chat.newThread")}
        </button>

        <div className="cl-search">
          <Icon name="search" size={13} />
          <input placeholder={t("chat.search")} aria-label={t("chat.search")} />
        </div>

        <nav className="cl-nav-body">
          <div className="cl-nav-label">{t("chat.threads")}</div>
          {[
            [threadTitle, "thread_01J9F2", true],
            [zh ? "鉴权中间件重构" : "Auth middleware refactor", "thread_01J9C7", false],
            [zh ? "每周研究简报" : "Weekly research digest", "thread_01J8QX", false],
            [zh ? "Q2 预算复盘" : "Q2 budget review", "thread_01J7M1", false],
          ].map(([title, id, active]) => (
            <button key={String(id)} className={`cl-thread ${active ? "is-active" : ""}`}>
              <span className="cl-thread-title">{title}</span>
              <span className="cl-thread-id mono">{id}</span>
            </button>
          ))}
        </nav>

        <div className="cl-nav-foot">
          <div className="cl-usage">
            <div className="cl-usage-head">
              <span>{t("chat.context")}</span>
              <span className="mono">{c.tokens ? `${(c.tokens / 1000).toFixed(1)}k` : "—"} / 200k</span>
            </div>
            <div className="cl-meter">
              <span style={{ width: `${Math.min(100, 6 + c.tokens / 40)}%` }} />
            </div>
          </div>
          <div className="cl-user">
            <span className="cl-avatar">N</span>
            <span className="cl-user-body">
              <span className="cl-user-name">noexcs</span>
              <span className="cl-user-plan">{t("chat.designPreview")}</span>
            </span>
          </div>
        </div>
      </aside>

      {/* ── conversation ──────────────────────────────────────────── */}
      <main className="cl-main">
        <header className="cl-head">
          <div className="cl-head-id">
            <span className="cl-agent-avatar">AI</span>
            <div>
              <div className="cl-head-title">{brand.agentName}</div>
              <div className="cl-head-sub mono">
                {brand.modelLabel} · {c.threadId} · {c.runId}
              </div>
            </div>
          </div>
          <div className="cl-head-actions">
            <span className={`cl-status cl-status--${c.status}`}>
              <i />
              {statusText}
            </span>
            <button className="cl-btn cl-btn--ghost" onClick={() => c.replay()}>
              <Icon name="refresh" size={13} />
              {zh ? "重新运行" : "Run again"}
            </button>
          </div>
        </header>

        <div className="cl-scroll" ref={scroller}>
          <div className="cl-stack">
            {c.entries.length === 0 && (
              <div className="cl-empty">
                <Icon name="activity" size={18} />
                <p>{zh ? "输入一条消息开始对话。" : "Send a message to start the conversation."}</p>
              </div>
            )}

            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
              {visible.map((entry) => {
              if (entry.kind === "user") {
                return (
                  <div key={entry.id} className="cl-row cl-row--user">
                    <div className="cl-bubble">
                      <div className="cl-bubble-meta">{zh ? "你" : "You"} · {timeOf(entry.at)}</div>
                      <p>{entry.text}</p>
                    </div>
                  </div>
                );
              }
              if (entry.kind === "assistant") {
                return (
                  <div key={entry.id} className="cl-row cl-row--assistant">
                    <span className="cl-avatar cl-avatar--sm">AI</span>
                    <div className="cl-msg">
                      <div className="cl-msg-meta">
                        <strong>{brand.agentName}</strong>
                        <span>{timeOf(entry.at)}</span>
                        {entry.streaming && <span className="cl-streaming">{zh ? "生成中…" : "streaming…"}</span>}
                      </div>
                      {entry.text ? (
                        <Markdown className={`cl-md ${entry.streaming ? "is-streaming" : ""}`} text={entry.text} />
                      ) : (
                        <div className="cl-md"><span className="cl-caret" /></div>
                      )}
                      {!entry.streaming && (
                        <div className="cl-msg-actions">
                          <button onClick={() => navigator.clipboard?.writeText(entry.text)}>
                            <Icon name="copy" size={12} />
                            {t("chat.copy")}
                          </button>
                          <button onClick={() => c.replay()}>
                            <Icon name="refresh" size={12} />
                            {t("chat.retry")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              if (entry.kind === "reasoning") {
                return (
                  <ReasoningRow
                    key={entry.id}
                    entry={entry}
                    open={!!openReasoning[entry.id]}
                    onToggle={() => setOpenReasoning((p) => ({ ...p, [entry.id]: !p[entry.id] }))}
                  />
                );
              }
              if (entry.kind === "tool") {
                return (
                  <ToolRow
                    key={entry.id}
                    entry={entry}
                    open={!!openTools[entry.id]}
                    onToggle={() => setOpenTools((p) => ({ ...p, [entry.id]: !p[entry.id] }))}
                  />
                );
              }
              if (entry.kind === "plan") {
                return <PlanRow key={entry.id} entry={entry} />;
              }
              if (entry.kind === "interrupt") {
                return (
                  <div key={entry.id} className="cl-row cl-row--wide">
                    <div className={`cl-approval ${entry.status === "pending" ? "" : entry.expired ? "cl-approval--expired" : "is-resolved"}`}>
                      <div className="cl-approval-head">
                        <Icon name={entry.status === "pending" ? "shield" : entry.expired ? "clock" : "check"} size={14} />
                        <strong>
                          {entry.status === "pending"
                            ? zh
                              ? "需要你的确认"
                              : "Approval required"
                            : entry.status === "approved"
                            ? zh
                              ? "已批准"
                              : "Approved"
                            : entry.expired
                            ? zh
                              ? "已过期"
                              : "Expired"
                            : zh
                            ? "已拒绝"
                            : "Declined"}
                        </strong>
                        <span className="cl-approval-time">{timeOf(entry.at)}</span>
                      </div>
                      <p className="cl-approval-title">{entry.message}</p>
                      {entry.description && <p className="cl-approval-desc">{entry.description}</p>}
                      {entry.details.length > 0 && (
                        <dl className="cl-approval-terms">
                          {entry.details.map((d) => (
                            <div key={d.label}>
                              <dt>{d.label}</dt>
                              <dd>{d.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {entry.status === "pending" ? (
                        <>
                          <div className="cl-approval-actions">
                            <button className="cl-btn cl-btn--primary" onClick={() => approve(entry.id)}>
                              <Icon name="check" size={13} />
                              {t("intr.approve")}
                            </button>
                            <button className="cl-btn" onClick={() => c.resolveInterrupt(false, undefined, entry.id)}>
                              <Icon name="x" size={13} />
                              {t("intr.deny")}
                            </button>
                            <button className="cl-link" onClick={() => beginEdit(entry.id)}>{t("intr.edit")}</button>
                          </div>
                          {editingId === entry.id && (
                            <div className="cl-edit">
                              <label>{zh ? "提交参数（可修改后批准）" : "Arguments submitted on resume"}</label>
                              <textarea
                                value={editJson[entry.id] ?? ""}
                                onChange={(e) => setEditJson((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                                spellCheck={false}
                              />
                              <div className="cl-approval-actions">
                                <button className="cl-btn cl-btn--primary" onClick={() => approve(entry.id)}>{t("intr.approveEdited")}</button>
                                <button className="cl-btn" onClick={() => setEditingId(null)}>{t("intr.cancel")}</button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="cl-approval-resolved">
                          <Icon name={entry.expired ? "clock" : "check"} size={12} />
                          {entry.status === "approved" ? t("intr.approvedBy") : entry.expired ? t("intr.expired") : t("intr.deniedBy")}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }
              if (entry.kind === "subagent") {
                return (
                  <div key={entry.id} className="cl-row cl-row--assistant">
                    <span className="cl-avatar cl-avatar--sm"><Icon name="layers" size={12} /></span>
                    <div className="cl-msg">
                      <div className="cl-subagent">
                        <strong>{displayText(entry.name)}</strong>
                        <span className={`cl-subagent-status cl-subagent-status--${entry.status}`}>{entry.status}</span>
                        {entry.detail && <span className="cl-muted">{entry.detail}</span>}
                      </div>
                    </div>
                  </div>
                );
              }

              if (entry.kind === "step") {
                return (
                  <div key={entry.id} className="cl-row cl-row--assistant">
                    <span className="cl-avatar cl-avatar--sm"><Icon name="activity" size={12} /></span>
                    <div className="cl-msg">
                      <div className="cl-subagent">
                        <strong>{displayText(entry.name)}</strong>
                        <span className={`cl-subagent-status cl-subagent-status--${entry.status === "running" ? "running" : entry.status === "failed" ? "error" : "done"}`}>
                          {entry.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }

              if (entry.kind === "custom") {
                const custom = plugins.custom?.(entry);
                if (custom !== undefined) {
                  return (
                    <div key={entry.id} className="cl-row cl-row--wide">
                      {custom}
                    </div>
                  );
                }
                return (
                  <div key={entry.id} className="cl-row cl-row--wide">
                    <div className="cl-custom">
                      <span className="cl-custom-name mono">{displayText(entry.name)}</span>
                      <pre className="cl-custom-args" data-skin-text="">{safeJson(entry.value, 2)}</pre>
                    </div>
                  </div>
                );
              }

              if (entry.kind === "error") {
                return (
                  <div key={entry.id} className="cl-row cl-row--wide">
                    <div className="cl-error">{entry.message}</div>
                  </div>
                );
              }
              return null;
            })}

            {c.status === "done" && c.entries.length > 0 && (
              <div className="cl-run-end">
                <span>{zh ? "本轮结束" : "Run finished"}</span>
                <span className="mono">
                  {formatDuration(c.duration())} · {c.tokens} tokens · {c.events.length} events
                </span>
              </div>
            )}
          </div>
        </div>

        <footer className="cl-composer">
          {c.suggestions.length > 0 && (
            <div className="cl-suggestions" role="list" aria-label={zh ? "建议" : "Suggestions"}>
              {c.suggestions.map((text) => (
                <button
                  key={text}
                  role="listitem"
                  className="cl-suggestion"
                  title={zh ? "填入输入框" : "Insert into the composer"}
                  onClick={() => setDraft(text)}
                >
                  <Icon name="sparkle" size={12} />
                  {text}
                </button>
              ))}
            </div>
          )}
          <div className="cl-composer-box">
            <textarea
              rows={1}
              value={draft}
              aria-label={zh ? "消息输入框" : "Message composer"}
              placeholder={zh ? "输入消息，Enter 发送，Shift+Enter 换行" : "Message the assistant — Enter to send, Shift+Enter for a new line"}
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 132) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") c.stop();
              }}
            />
            <div className="cl-composer-bar">
            <div className="cl-composer-tools">
              <button className="cl-tool-chip"><Icon name="wrench" size={12} />{zh ? "工具" : "Tools"} · 4</button>
              <button className="cl-tool-chip mono">{brand.modelLabel}</button>
            </div>
              {running ? (
                <button className="cl-btn" onClick={() => c.stop()}>
                  <Icon name="stop" size={12} />
                  {t("chat.stop")}
                </button>
              ) : (
                <button className="cl-btn cl-btn--primary" onClick={send} disabled={!draft.trim()}>
                  {t("chat.send")}
                  <Icon name="send" size={13} />
                </button>
              )}
            </div>
          </div>
        </footer>
      </main>

      {/* ── context / details ─────────────────────────────────────── */}
        <aside className="cl-details">
          <div className="cl-details-head">
            <strong>{zh ? "会话详情" : "Session details"}</strong>
          </div>

        <section className="cl-panel">
          <h3>{zh ? "运行" : "Run"}</h3>
          <dl className="cl-kv">
            <div><dt>{zh ? "会话" : "Thread"}</dt><dd className="mono">{c.threadId}</dd></div>
            <div><dt>{zh ? "轮次" : "Run"}</dt><dd className="mono">{c.runId}</dd></div>
            <div><dt>{zh ? "状态" : "Status"}</dt><dd>{statusText}</dd></div>
            <div><dt>{zh ? "事件" : "Events"}</dt><dd className="mono">{c.events.length}</dd></div>
            <div><dt>{zh ? "词元" : "Tokens"}</dt><dd className="mono">{c.tokens}</dd></div>
          </dl>
        </section>

        <section className="cl-panel">
          <h3>{zh ? "元数据" : "Metadata"}</h3>
          {Object.keys(c.metadata ?? {}).length ? (
            <dl className="cl-kv">
              {Object.entries(c.metadata ?? {}).map(([key, value]) => (
                <div key={key}>
                  <dt className="mono">{key}</dt>
                  <dd className="mono">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="cl-muted">{zh ? "暂无元数据" : "No metadata yet"}</p>
          )}
        </section>

        <section className="cl-panel">
          <h3>{zh ? "能力" : "Capabilities"}</h3>
          <div className="cl-caps">
            {c.capabilities?.tools?.supported && <span>tools · {c.capabilities.tools.items?.length ?? 0}</span>}
            {c.capabilities?.reasoning?.supported && <span>reasoning</span>}
            {c.capabilities?.state?.supported && <span>state</span>}
            {c.capabilities?.humanInTheLoop?.supported && <span>interrupts</span>}
            {c.capabilities?.subagents?.supported && <span>subagents</span>}
          </div>
        </section>

        <section className="cl-panel">
          <h3>{zh ? "计划" : "Plan"}</h3>
          {plans.length ? (
            plans.map((plan) => {
              const view = planView(plan);
              return (
                <div key={plan.id} className="cl-plan-block">
                  <div className="cl-plan-title mono">{displayText(plan.title)}</div>
                  {view.rawOnly ? (
                    <pre className="cl-plan-raw" data-skin-text="">{planRawText(view)}</pre>
                  ) : (
                    <ul className="cl-plan">
                      {view.steps.map((step) => (
                        <li key={step.id} data-state={step.state}>
                          <span className="cl-check">
                            {step.state === "done" ? <Icon name="check" size={10} /> : null}
                          </span>
                          {step.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          ) : (
            <p className="cl-muted">{zh ? "暂无计划" : "No plan yet"}</p>
          )}
        </section>

        <section className="cl-panel">
          <h3>{zh ? "共享状态" : "Shared state"}</h3>
          {stateRows.length ? (
            <dl className="cl-kv">
              {stateRows.map(([key, value]) => (
                <div key={key}>
                  <dt className="mono">{key}</dt>
                  <dd className="mono">
                    {value && typeof value === "object"
                      ? Array.isArray(value)
                        ? `[${value.length}]`
                        : `{${Object.keys(value).length}}`
                      : displayText(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="cl-muted">{zh ? "暂无快照" : "No snapshot yet"}</p>
          )}
          <div className="cl-version mono">STATE v{c.stateVersion}</div>
        </section>

        <section className="cl-panel">
          <h3>{zh ? "需要你处理" : "Needs you"}</h3>
          {interrupts.filter((i) => i.status === "pending").length ? (
            interrupts
              .filter((i) => i.status === "pending")
              .map((i) => (
                <p key={i.id} className="cl-attention">
                  <Icon name="shield" size={12} />
                  {plainText(i.message, 60)}
                </p>
              ))
          ) : (
            <p className="cl-muted">{zh ? "没有待处理项" : "Nothing pending"}</p>
          )}
        </section>
      </aside>
    </div>
  );
}

/* ── rows ─────────────────────────────────────────────────────────── */

function ReasoningRow({ entry, open, onToggle }: { entry: ReasoningEntry; open: boolean; onToggle: () => void }) {
  const zh = isZh();
  return (
    <div className="cl-row cl-row--assistant">
      <span className="cl-avatar cl-avatar--sm">AI</span>
      <div className="cl-msg">
        <button className={`cl-reason ${open ? "is-open" : ""}`} onClick={onToggle}>
          <Icon name="brain" size={12} />
          <span>{entry.streaming ? (zh ? "思考中…" : "Thinking…") : zh ? "思考过程" : "Reasoning"}</span>
          <span className="cl-reason-meta mono">{entry.streaming ? "" : formatDuration(entry.durationMs ?? 0)}</span>
          <Icon name="chevron" size={11} className="cl-chev" />
        </button>
        {open && <div className="cl-reason-body" data-skin-text="">{entry.text}</div>}
      </div>
    </div>
  );
}

function ToolRow({ entry, open, onToggle }: { entry: ToolEntry; open: boolean; onToggle: () => void }) {
  const zh = isZh();
  return (
    <div className="cl-row cl-row--assistant">
      <span className="cl-avatar cl-avatar--sm">
        <Icon name="wrench" size={12} />
      </span>
      <div className="cl-msg">
        <div className={`cl-tool ${open ? "is-open" : ""}`}>
          <button className="cl-tool-head" onClick={onToggle}>
            <span className="cl-tool-name mono">{displayText(entry.name)}</span>
            <span className={`cl-tool-status cl-tool-status--${entry.status}`}>
              {entry.status === "args"
                ? zh
                  ? "接收参数"
                  : "Arguments"
                : entry.status === "executing"
                ? zh
                  ? "执行中"
                  : "Running"
                : entry.status === "interrupted"
                ? zh
                  ? "已暂停"
                  : "Paused"
                : entry.status === "done"
                ? zh
                  ? "已完成"
                  : "Done"
                : zh
                ? "失败"
                : "Failed"}
            </span>
            <span className="cl-tool-time mono">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
            <Icon name="chevron" size={11} className="cl-chev" />
          </button>
          {open && <pre className="cl-tool-args" data-skin-text="">{displayText(entry.argsRaw) || "…"}</pre>}
          <ToolResult entry={entry} variant="classic" />
        </div>
      </div>
    </div>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const zh = isZh();
  const view = planView(entry);
  return (
    <div className="cl-row cl-row--assistant">
      <span className="cl-avatar cl-avatar--sm">
        <Icon name="layers" size={12} />
      </span>
      <div className="cl-msg">
        <div className="cl-plan-card">
          <div className="cl-plan-head">
            <strong>{displayText(entry.title)}</strong>
            <span className="mono">
              {view.steps.filter((s) => s.state === "done").length}/{view.steps.length}
            </span>
          </div>
          {view.rawOnly ? (
            <pre className="cl-plan-raw" data-skin-text="">{planRawText(view)}</pre>
          ) : (
            <ul className="cl-plan">
              {view.steps.map((step) => (
                <li key={step.id} data-state={step.state}>
                  <span className="cl-check">
                    {step.state === "done" ? <Icon name="check" size={10} /> : null}
                  </span>
                  {step.label}
                  {step.state === "active" && <em className="cl-plan-active">{zh ? "进行中" : "in progress"}</em>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default {
  id: "classic",
  name: "Classic",
  tagline: "Neutral · enterprise-safe",
  swatch: ["#f7f8fa", "#ffffff", "#2563eb"] as [string, string, string],
  ChatPage: ClassicPage,
};
