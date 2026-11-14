import { useState } from "react";
import { useConversation } from "../host";
import { Icon } from "./Icon";
import { safeJson } from "./safe";
import "./protocol-drawer.css";

/**
 * Shared protocol inspector available to every skin that does not ship its own
 * inspector. It exposes the protocol surfaces every skin must offer: the live
 * event log, shared state and run metadata. Visual skins may render these
 * differently, but the capability is the same across the set.
 */
export function ProtocolDrawer() {
  const c = useConversation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"events" | "state" | "meta">("events");
  const [limit, setLimit] = useState(120);
  const events = c.events.slice(-limit);
  const hidden = Math.max(0, c.events.length - events.length);

  return (
    <>
      <button
        type="button"
        className="sk-proto-trigger"
        onClick={() => setOpen(true)}
        aria-label="Protocol events"
        title="Protocol events / state / metadata"
      >
        <Icon name="braces" size={13} />
        <span>协议</span>
        <em>{c.events.length}</em>
      </button>

      {open && (
        <div className="sk-proto-overlay" role="presentation" onClick={() => setOpen(false)}>
          <section
            className="sk-proto-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Protocol inspector"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sk-proto-head">
              <div className="sk-proto-tabs" role="tablist">
                {(["events", "state", "meta"] as const).map((id) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? "is-active" : ""}
                    onClick={() => setTab(id)}
                  >
                    {id === "events" ? "事件" : id === "state" ? "状态" : "元数据"}
                  </button>
                ))}
              </div>
              <button className="sk-proto-close" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="x" size={14} />
              </button>
            </header>

            {tab === "events" && (
              <div className="sk-proto-events">
                {hidden > 0 && (
                  <button className="sk-proto-more" onClick={() => setLimit((value) => value + 120)}>
                    load earlier · {hidden}
                  </button>
                )}
                {events.map(({ seq, event, at }) => (
                  <details key={seq} className="sk-proto-event">
                    <summary>
                      <span className="sk-proto-type">{event.type}</span>
                      <span className="sk-proto-time">{new Date(at).toLocaleTimeString()}</span>
                    </summary>
                    <pre>{safeJson(event, 2)}</pre>
                  </details>
                ))}
                {!events.length && <p className="sk-proto-empty">No events yet.</p>}
              </div>
            )}

            {tab === "state" && (
              <pre className="sk-proto-json">{safeJson(c.sharedState, 2)}</pre>
            )}

            {tab === "meta" && (
              <div className="sk-proto-meta">
                <dl>
                  <div><dt>thread</dt><dd>{c.threadId}</dd></div>
                  <div><dt>run</dt><dd>{c.runId}</dd></div>
                  <div><dt>status</dt><dd>{c.status}</dd></div>
                  <div><dt>transport</dt><dd>{c.transport}</dd></div>
                  <div><dt>tokens</dt><dd>{c.tokens || "—"}</dd></div>
                  <div><dt>events</dt><dd>{c.events.length}</dd></div>
                </dl>
                <pre className="sk-proto-json">{safeJson(c.metadata ?? {}, 2)}</pre>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
