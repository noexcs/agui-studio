import { readFileSync, writeFileSync } from "node:fs";

const edits = {
  "src/skins/aurora/index.tsx": [
    [`import { Icon } from "../../shared/Icon";`, `import { Icon } from "../../shared/Icon";\nimport { t } from "../../i18n";`],
    [`<span>New thread</span>`, `{t("chat.newThread")}`],
    [`placeholder="Search threads"`, `placeholder={t("chat.search")}`],
    [`<div className="side-label">Threads</div>`, `<div className="side-label">{t("chat.threads")}</div>`],
    [`<div className="side-label">Agents</div>`, `<div className="side-label">{t("chat.agents")}</div>`],
    [`<span className="usage-label">Context</span>`, `<span className="usage-label">{t("chat.context")}</span>`],
    [`<span className="user-plan">Design preview</span>`, `<span className="user-plan">{t("chat.designPreview")}</span>`],
    [`<span className="cap"><Icon name="wrench" />tools <b>4</b></span>`, `<span className="cap"><Icon name="wrench" />{t("chat.tools")} <b>4</b></span>`],
    [`<span className="cap"><Icon name="brain" />reasoning</span>`, `<span className="cap"><Icon name="brain" />{t("chat.reasoning")}</span>`],
    [`<span className="cap"><Icon name="layers" />state</span>`, `<span className="cap"><Icon name="layers" />{t("chat.state")}</span>`],
    [`<span className="cap cap--hitl"><Icon name="shield" />interrupts</span>`, `<span className="cap cap--hitl"><Icon name="shield" />{t("chat.interrupts")}</span>`],
    [`{statusLabel[c.status]}`, `{t(("status." + c.status) as never)}`],
    [`{entry.streaming ? "Thinking" : "Thought"}`, `{entry.streaming ? t("status.thinking") : t("status.thought")}`],
    [`<Icon name="activity" size={10} />generating`, `<Icon name="activity" size={10} />{t("status.generating")}`],
    [`<Icon name="copy" />Copy`, `<Icon name="copy" />{t("chat.copy")}`],
    [`<Icon name="refresh" />Retry`, `<Icon name="refresh" />{t("chat.retry")}`],
    [`<><span className="spinner" />streaming args</>`, `<><span className="spinner" />{t("chat.streamingArgs")}</>`],
    [`<><span className="spinner" />running</>`, `<><span className="spinner" />{t("chat.executing")}</>`],
    [`<><Icon name="check" />done</>`, `<><Icon name="check" />{t("chat.done")}</>`],
    [`<><Icon name="x" />failed</>`, `<><Icon name="x" />{t("chat.failed")}</>`],
    [`{result.results.length} sources`, `{result.results.length} {t("chat.sources")}`],
    [`{pending ? "Run paused · interrupt" : "Resolved"}`, `{pending ? t("intr.paused") : t("intr.resolved")}`],
    [`<Icon name="check" />Approve</button>`, `<Icon name="check" />{t("intr.approve")}</button>`],
    [`<Icon name="x" />Deny</button>`, `<Icon name="x" />{t("intr.deny")}</button>`],
    [`onClick={props.onEdit}>Edit details</button>`, `onClick={props.onEdit}>{t("intr.edit")}</button>`],
    [`onClick={props.onApprove}>Approve with edits</button>`, `onClick={props.onApprove}>{t("intr.approveEdited")}</button>`],
    [`onClick={props.onCancelEdit}>Cancel</button>`, `onClick={props.onCancelEdit}>{t("intr.cancel")}</button>`],
    [`{entry.status === "approved" ? "Approved by you — resumed with resume[0]" : "Denied by you — run resumed"}`, `{entry.status === "approved" ? t("intr.approvedBy") : t("intr.deniedBy")}`],
    [`<span>Run finished</span>`, `<span>{t("chat.endOfRun")}</span>`],
    [`<b>{c.tokens}</b> tokens`, `<b>{c.tokens}</b> {t("chat.tokens")}`],
    [`<b>{c.events.length}</b> events`, `<b>{c.events.length}</b> {t("chat.events")}`],
    [`placeholder="Message AG-UI Assistant…"`, `placeholder={t("chat.placeholder")}`],
    [`<span>4 tools</span>`, `<span>{t("chat.tools")}</span>`],
    [`<span>Commands</span>`, `<span>{t("chat.commands")}</span>`],
    [`Events<span className="tab-count mono">{c.events.length}</span>`, `{t("chat.eventsTab")}<span className="tab-count mono">{c.events.length}</span>`],
    [`Shared state<span className="tab-count mono">v{c.stateVersion}</span>`, `{t("chat.stateTab")}<span className="tab-count mono">v{c.stateVersion}</span>`],
    [`["all", "All"],`, `["all", t("filter.all")],`],
    [`["lifecycle", "Lifecycle"],`, `["lifecycle", t("filter.lifecycle")],`],
    [`["text", "Text"],`, `["text", t("filter.text")],`],
    [`["tool", "Tool"],`, `["tool", t("filter.tool")],`],
    [`["state", "State"],`, `["state", t("filter.state")],`],
    [`["reasoning", "Reasoning"],`, `["reasoning", t("filter.reasoning")],`],
    [`["special", "Special"],`, `["special", t("filter.special")],`],
  ],
  "src/skins/paper/index.tsx": [
    [`import { Icon } from "../../shared/Icon";`, `import { Icon } from "../../shared/Icon";\nimport { t } from "../../i18n";`],
    [`<span className="pap-kicker">Field notes</span>`, `<span className="pap-kicker">{t("paper.fieldNotes")}</span>`],
    [`{c.status === "running" ? "recording" : c.status === "interrupted" ? "awaiting signature" : c.status === "done" ? "filed" : c.status}`, `{c.status === "running" ? t("paper.recording") : c.status === "interrupted" ? t("paper.awaiting") : c.status === "done" ? t("paper.filed") : c.status}`],
    [`A conversation with an agent that shows its work. Every reply carries its sources, its plan and — where money moves — a signature line.`, `{t("paper.lead")}`],
    [`<div className="pap-user-tag">You · {timeOf(entry.at)}</div>`, `<div className="pap-user-tag">{t("chat.you")} · {timeOf(entry.at)}</div>`],
    [`<span>Assistant</span>`, `<span>{t("chat.assistant")}</span>`],
    [`<span>{entry.streaming ? "writing" : \`\${estimateTokens(entry.text)} words\`}</span>`, `<span>{entry.streaming ? t("status.writing") : \`\${estimateTokens(entry.text)} \${t("chat.tokens")}\`}</span>`],
    [`{entry.status === "pending" ? "Authorisation required" : entry.status === "approved" ? "Signed" : "Declined"}`, `{entry.status === "pending" ? t("paper.authorisation") : entry.status === "approved" ? t("paper.signedLabel") : t("paper.declinedLabel")}`],
    [`Sign and continue`, `{t("paper.sign")}`],
    [`Decline`, `{t("paper.decline")}`],
    [`Amend terms`, `{t("paper.amend")}`],
    [`Sign with amendments`, `{t("paper.signEdit")}`],
    [`{entry.status === "approved" ? "Countersigned by you" : "Declined by you"}`, `{entry.status === "approved" ? t("paper.signed") : t("paper.declined")}`],
    [`<span>Margin notes</span>`, `<span>{t("paper.marginNotes")}</span>`],
    [`Notes appear as the agent works.`, `{t("paper.marginEmpty")}`],
    [`<span>Shared state · v{c.stateVersion}</span>`, `<span>{t("paper.sharedState")} · v{c.stateVersion}</span>`],
    [`<span>End of correspondence</span>`, `<span>{t("paper.end")}</span>`],
    [`placeholder="Write a note to the agent…"`, `placeholder={t("chat.replyPlaceholder")}`],
    [`<span className="pap-composer-prompt">Reply</span>`, `<span className="pap-composer-prompt">{t("chat.reply")}</span>`],
    [`<button className="pap-send pap-send--stop" onClick={() => c.stop()}>Stop</button>`, `<button className="pap-send pap-send--stop" onClick={() => c.stop()}>{t("chat.stop")}</button>`],
    [`<button className="pap-send" onClick={send} disabled={!draft.trim()}>Send</button>`, `<button className="pap-send" onClick={send} disabled={!draft.trim()}>{t("chat.send")}</button>`],
    [`Thinking {entry.streaming && <i className="pap-blink" />}`, `{t("paper.thinking")} {entry.streaming && <i className="pap-blink" />}`],
    [`Tool call <span`, `{t("paper.toolCall")} <span`],
    [`Plan <span`, `{t("paper.plan")} <span`],
  ],
  "src/skins/terminal/index.tsx": [
    [`import { Icon } from "../../shared/Icon";`, `import { Icon } from "../../shared/Icon";\nimport { t } from "../../i18n";`],
    [`placeholder="type a message — enter sends, esc stops"`, `placeholder={t("term.typeMessage")}`],
    [`awaiting RUN_STARTED`, `{t("term.awaiting")}`],
    [`<span>run finished · `, `<span>{t("term.runFinished")} · `],
    [`<span>trace</span>`, `<span>{t("term.trace")}</span>`],
    [`<span className="term-trace-live"><i /> live</span>`, `<span className="term-trace-live"><i /> {t("term.live")}</span>`],
    [`{running ? "● recording" : c.status === "interrupted" ? "● paused" : c.status === "done" ? "● idle" : "○ " + c.status}`, `{running ? "● " + t("term.recording") : c.status === "interrupted" ? "● " + t("term.paused") : c.status === "done" ? "● " + t("term.idle") : "○ " + c.status}`],
    [`{pending ? "┌─ ACTION REQUIRED" : "┌─ RESOLVED"}`, `{pending ? "┌─ " + t("term.actionRequired") : "┌─ " + t("term.resolved")}`],
    [`onClick={() => onResolve(true)}>[Y] approve`, `onClick={() => onResolve(true)}>{t("term.approve")}`],
    [`onClick={() => onResolve(false)}>[N] decline`, `onClick={() => onResolve(false)}>{t("term.decline")}`],
    [`▸ plan · {entry.title.toLowerCase()}`, `▸ {t("term.plan")} · {entry.title.toLowerCase()}`],
  ],
  "src/skins/brutalist/index.tsx": [
    [`import { Icon } from "../../shared/Icon";`, `import { Icon } from "../../shared/Icon";\nimport { t } from "../../i18n";`],
    [`<div className="bru-label">Index</div>`, `<div className="bru-label">{t("bru.index")}</div>`],
    [`<span>+ New thread</span>`, `<span>{t("bru.newThread")}</span>`],
    [`<div className="bru-label bru-label--light">Shared state</div>`, `<div className="bru-label bru-label--light">{t("bru.sharedState")}</div>`],
    [`<div className="bru-label bru-label--light">Events</div>`, `<div className="bru-label bru-label--light">{t("bru.events")}</div>`],
    [`<span>■ end of run</span>`, `<span>■ {t("bru.endOfRun")}</span>`],
    [`>replay ↻</button>`, `>{t("bru.replay")}</button>`],
    [`placeholder="WRITE A MESSAGE"`, `placeholder={t("bru.write")}`],
    [`onClick={() => c.stop()}>STOP ■</button>`, `onClick={() => c.stop()}>{t("bru.stop")}</button>`],
    [`onClick={send} disabled={!draft.trim()}>SEND →</button>`, `onClick={send} disabled={!draft.trim()}>{t("bru.send")}</button>`],
    [`{pending ? "▲ APPROVAL REQUIRED" : "■ RESOLVED"}`, `{pending ? "▲ " + t("bru.approvalRequired") : "■ " + t("bru.resolved")}`],
    [`onClick={() => c.resolveInterrupt(true)}>APPROVE →</button>`, `onClick={() => c.resolveInterrupt(true)}>{t("bru.approve")}</button>`],
    [`onClick={() => c.resolveInterrupt(false)}>DENY ✕</button>`, `onClick={() => c.resolveInterrupt(false)}>{t("bru.deny")}</button>`],
    [`<span>THINKING</span>`, `<span>{t("bru.thinking")}</span>`],
    [`<span>PLAN</span>`, `<span>{t("bru.plan")}</span>`],
    [`<span className="bru-approve-note">run paused · {live ? "waiting for you" : "interrupt"}</span>`, `<span className="bru-approve-note">{t("bru.paused")} · {live ? t("bru.waiting") : "interrupt"}</span>`],
  ],
};

let total = 0;
for (const [file, pairs] of Object.entries(edits)) {
  let text = readFileSync(file, "utf8");
  let applied = 0;
  for (const [from, to] of pairs) {
    if (!text.includes(from)) {
      console.log("MISS", file, "::", from.slice(0, 60));
      continue;
    }
    text = text.split(from).join(to);
    applied++;
  }
  writeFileSync(file, text);
  console.log(`${file}: ${applied}/${pairs.length}`);
  total += applied;
}
console.log("total", total);
