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

/* ═══ Tailwind migration (task-13 Phase 1 — the conversion template) ═══
   Every workbench.css rule with a JSX site became utilities beside the
   semantic class name; values reference the skin-scoped --wb-* tokens via
   arbitrary var shorthand (`bg-(--wb-shell)`), so the data-sk-theme="light"
   override in workbench.css keeps driving both themes through the same
   class strings. workbench.css retains only token blocks, keyframes,
   pseudo-elements, generated-element typography and sibling separators.

   Patterns used here (bind these for the remaining skins):
   • data-attribute states → computed class maps (wb-chip/dot/stage/…);
     the data-* attributes stay on the elements as anchors.
   • presence attributes handled in CSS via ancestor selectors
     (.wb-round[data-open] .wb-chev …) → computed conditional classes.
   • parent-hover reveals (.wb-assistant:hover .wb-row-action) → group +
     group-hover:*.
   • vars with fallbacks / color-mix() → bracket arbitrary values.
   • details[open] descendant state → [.wb-custom[open]_&] arbitrary variant. */

const CHEV = "wb-chev shrink-0 rotate-90 opacity-55 [transition:transform_0.15s_ease]";

const CHIP_STATUS: Record<string, string> = {
  running: "text-(--wb-cyan) border-[color-mix(in_srgb,var(--wb-cyan)_35%,transparent)]",
  done: "text-(--wb-green) border-[color-mix(in_srgb,var(--wb-green)_35%,transparent)]",
  error: "text-(--wb-red) border-[color-mix(in_srgb,var(--wb-red)_40%,transparent)]",
  interrupted: "text-(--wb-amber) border-[color-mix(in_srgb,var(--wb-amber)_40%,transparent)]",
  stopped: "text-(--wb-dim)",
  idle: "text-(--wb-faint)",
};

const DOT: Record<string, string> = {
  running: "bg-(--wb-cyan) opacity-100 motion-reduce:animate-none",
  done: "bg-(--wb-green) opacity-100",
  approved: "bg-(--wb-green) opacity-100",
  error: "bg-(--wb-red) opacity-100",
  failed: "bg-(--wb-red) opacity-100",
  interrupted: "bg-(--wb-amber) opacity-100",
  pending: "bg-(--wb-amber) opacity-100",
};

const ACT_LED: Record<string, string> = {
  running: "bg-(--wb-cyan) opacity-100 animate-[wb-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  done: "bg-(--wb-green) opacity-100",
  error: "bg-(--wb-red) opacity-100",
  interrupted: "bg-(--wb-amber) opacity-100",
};

const NODE_KIND: Record<string, string> = {
  user: "text-(--wb-accent) border-[color-mix(in_srgb,var(--wb-accent)_30%,transparent)]",
  assistant: "text-(--wb-text)",
  tool: "text-(--wb-violet) border-[color-mix(in_srgb,var(--wb-violet)_30%,transparent)]",
  interrupt: "text-(--wb-amber) border-[color-mix(in_srgb,var(--wb-amber)_35%,transparent)]",
  error: "text-(--wb-red) border-[color-mix(in_srgb,var(--wb-red)_35%,transparent)]",
  reasoning: "text-(--wb-cyan) border-[color-mix(in_srgb,var(--wb-cyan)_28%,transparent)]",
  plan: "text-(--wb-cyan) border-[color-mix(in_srgb,var(--wb-cyan)_28%,transparent)]",
};

const STAGE: Record<string, string> = {
  streaming: "text-(--wb-cyan) bg-[color-mix(in_srgb,var(--wb-cyan)_10%,transparent)]",
  running: "text-(--wb-cyan) bg-[color-mix(in_srgb,var(--wb-cyan)_10%,transparent)] animate-[wb-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  interrupted: "text-(--wb-amber) bg-[color-mix(in_srgb,var(--wb-amber)_12%,transparent)]",
  done: "text-(--wb-green) bg-[color-mix(in_srgb,var(--wb-green)_10%,transparent)]",
  error: "text-(--wb-red) bg-[color-mix(in_srgb,var(--wb-red)_12%,transparent)]",
};

const TERM_STAGE: Record<string, string> = {
  done: "border-l-(--wb-green)",
  running: "border-l-(--wb-cyan)",
  streaming: "border-l-(--wb-cyan)",
  interrupted: "border-l-(--wb-amber)",
  error: "border-l-(--wb-red)",
};

const STATUS_TEXT: Record<string, string> = {
  running: "text-(--wb-cyan)",
  done: "text-(--wb-green)",
  error: "text-(--wb-red)",
  interrupted: "text-(--wb-amber)",
  stopped: "text-(--wb-dim)",
  idle: "text-(--wb-faint)",
};

const STATUS_LED: Record<string, string> = {
  running: "bg-(--wb-cyan) animate-[wb-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  done: "bg-(--wb-green)",
  error: "bg-(--wb-red)",
  interrupted: "bg-(--wb-amber)",
};

const FLAG_FAILURE: Record<string, string> = {
  error: "text-(--wb-red) bg-[color-mix(in_srgb,var(--wb-red)_12%,transparent)]",
  interrupted: "text-(--wb-amber) bg-[color-mix(in_srgb,var(--wb-amber)_12%,transparent)]",
};

const PLAN_STATE: Record<string, string> = {
  done: "text-(--wb-green)",
  active: "text-(--wb-text)",
  cancelled: "text-(--wb-faint) line-through",
};

const PLAN_CHECK: Record<string, string> = {
  done: "border-(--wb-green)",
  active: "border-(--wb-accent) animate-[wb-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
};

const STEP_DOT: Record<string, string> = {
  done: "bg-(--wb-green)",
  failed: "bg-(--wb-red)",
};

const PULSE = "animate-[wb-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none";

const WB_BASE = "wb-composer-wrap flex-none border-t border-(--wb-line-soft) bg-(--wb-editor) pt-2.5 pb-3 pl-[62px] pr-[26px] max-[1080px]:pl-[26px] max-[720px]:pt-2 max-[720px]:pb-2.5 max-[720px]:pl-[34px] max-[720px]:pr-3.5";
const WB_PRE = "wb-pre mt-1.5 min-w-0 overflow-x-auto rounded-[7px] border border-(--wb-line-soft) bg-(--wb-deep) px-[11px] py-[9px] text-[10.5px] leading-[1.6] text-(--wb-dim) whitespace-pre-wrap [word-break:break-word]";
const WB_GUTTER = "wb-gutter relative border-r border-(--wb-line-soft) bg-(--wb-gutter) pr-3 pt-3 text-right text-[10px] text-(--wb-faint) select-none max-[720px]:pr-2";
const WB_CELL = "wb-cell min-w-0 py-2.5 pl-4 pr-[26px] max-[720px]:py-[9px] max-[720px]:pl-3 max-[720px]:pr-3.5";

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
    <div className="skin-workbench relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-(--wb-bg) text-[13px] leading-[1.6] text-(--wb-text) [font-family:var(--sk-font,Geist,Inter,system-ui,sans-serif)]">
      {/* ── title bar ─────────────────────────────────────────────── */}
      <header className="wb-titlebar flex-none flex h-[38px] items-center gap-2.5 border-b border-(--wb-line-soft) bg-(--wb-shell) px-3.5">
        <span className="wb-logo h-2.5 w-2.5 shrink-0 rounded-[3px] bg-[linear-gradient(135deg,var(--wb-accent),var(--wb-violet))]" aria-hidden="true" />
        <strong className="wb-title truncate text-[12.5px] font-semibold">{displayText(brand.agentName)}</strong>
        <span className="wb-crumb mono min-w-0 truncate text-[10.5px] text-(--wb-faint)">
          {displayText(workspace)} <i className="mx-1 not-italic text-(--wb-crumb-sep)">/</i> {c.threadId}
        </span>
        <span className="wb-titlebar-right flex flex-none items-center gap-[7px]">
          <span className="wb-chip mono whitespace-nowrap rounded border border-(--wb-line-soft) bg-(--wb-wash) px-2 py-0.5 text-[10px] tracking-[0.04em] text-(--wb-dim)">{displayText(brand.modelLabel)}</span>
          <span className={`wb-chip wb-chip--status mono whitespace-nowrap rounded border bg-(--wb-wash) px-2 py-0.5 text-[10px] tracking-[0.04em] ${CHIP_STATUS[c.status] ?? ""}`} data-status={c.status}>{statusText}</span>
          {running && <span className="wb-chip mono whitespace-nowrap rounded border border-(--wb-line-soft) bg-(--wb-wash) px-2 py-0.5 text-[10px] tracking-[0.04em] text-(--wb-dim)">{clock(c.duration())}</span>}
        </span>
      </header>

      <div className="wb-body flex min-h-0 flex-1">
        {/* ── activity bar ────────────────────────────────────────── */}
        <nav className="wb-activity flex w-11 flex-none flex-col items-center gap-1.5 border-r border-(--wb-line-soft) bg-(--wb-chrome) py-2.5" role="group" aria-label={t("wb.explorer")}>
          <button
            type="button"
            className="wb-act flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-0 bg-none text-(--wb-faint) hover:bg-(--wb-hover) hover:text-(--wb-text) active:bg-(--wb-press-strong) active:text-(--wb-text) data-[active]:bg-[color-mix(in_srgb,var(--wb-accent)_12%,transparent)] data-[active]:text-(--wb-accent) data-[active]:shadow-[inset_2px_0_0_var(--wb-accent)]"
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
            className="wb-act flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-0 bg-none text-(--wb-faint) hover:bg-(--wb-hover) hover:text-(--wb-text) active:bg-(--wb-press-strong) active:text-(--wb-text) data-[active]:bg-[color-mix(in_srgb,var(--wb-accent)_12%,transparent)] data-[active]:text-(--wb-accent) data-[active]:shadow-[inset_2px_0_0_var(--wb-accent)]"
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
            className="wb-act flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-0 bg-none text-(--wb-faint) hover:bg-(--wb-hover) hover:text-(--wb-text) active:bg-(--wb-press-strong) active:text-(--wb-text) data-[active]:bg-[color-mix(in_srgb,var(--wb-accent)_12%,transparent)] data-[active]:text-(--wb-accent) data-[active]:shadow-[inset_2px_0_0_var(--wb-accent)]"
            data-active={view === "meta" || undefined}
            aria-pressed={view === "meta"}
            aria-label={t("wb.viewMeta")}
            title={t("wb.viewMeta")}
            onClick={() => setView("meta")}
          >
            <Icon name="activity" size={16} />
          </button>
          <span className="wb-act-spacer flex-1" />
          <span className={`wb-act-led h-2 w-2 shrink-0 rounded-full bg-(--wb-faint) opacity-50 ${ACT_LED[c.status] ?? ""}`} aria-hidden="true" />
        </nav>

        {/* ── side panel ──────────────────────────────────────────── */}
        <aside className="wb-side flex w-[238px] min-w-0 flex-none flex-col overflow-y-auto border-r border-(--wb-line-soft) bg-(--wb-bg) [scrollbar-width:thin] [scrollbar-color:var(--wb-scroll)_transparent] max-[1080px]:hidden">
          {view === "tree" && (
            <div className="wb-side-view flex min-h-0 flex-col px-2.5 pb-5 pt-3">
              <div className="wb-side-head mono mx-1.5 mb-2 mt-1 text-[9px] font-semibold tracking-[0.14em] text-(--wb-faint)">{t("wb.explorer").toUpperCase()} · {t("wb.rounds")}</div>
              <button
                type="button"
                className="wb-tree-root flex w-[calc(100%-8px)] min-w-0 cursor-pointer items-center gap-[7px] rounded-[5px] border-0 bg-(--wb-wash) mx-1 mb-1 px-2 py-1.5 text-left text-[11.5px] text-(--wb-text) hover:bg-(--wb-hover-warm) active:bg-(--wb-press-max) disabled:opacity-55 disabled:cursor-default"
                onClick={() => reveal(c.entries[0]?.id ?? "", {})}
                disabled={!c.entries.length}
              >
                <Icon name="globe" size={12} />
                <span className="wb-tree-root-name min-w-0 truncate font-semibold">{threadLabel}</span>
                <span className={`wb-dot h-1.5 w-1.5 shrink-0 rounded-full bg-(--wb-faint) opacity-60 ${DOT[c.status] ?? ""}`} aria-hidden="true" />
              </button>
              {rounds.length === 0 && <p className="wb-side-empty m-1.5 text-[11px] text-(--wb-faint)">{t("wb.empty")}</p>}
              {rounds.map((round, index) => {
                const open = openRounds[round.id] ?? false;
                const last = index === rounds.length - 1;
                return (
                  <div key={round.id} className="wb-round my-px" data-open={open || undefined}>
                    <button
                      type="button"
                      className="wb-tree-row wb-tree-row--round flex w-[calc(100%-8px)] min-w-0 cursor-pointer items-center gap-1.5 rounded-[5px] border-0 bg-none mx-1 px-2 py-1 text-left text-[11px] font-medium text-(--wb-text) hover:bg-(--wb-hover) active:bg-(--wb-press)"
                      aria-expanded={open}
                      onClick={() => {
                        setOpenRounds((prev) => ({ ...prev, [round.id]: !prev[round.id] }));
                        reveal(round.entries[0].id);
                      }}
                    >
                      <Icon name="chevron" size={10} className={`${CHEV} ${open ? "rotate-90" : "rotate-0"}`} />
                      <span className="wb-tree-label min-w-0 flex-1 truncate">{round.label}</span>
                      {last && running && <span className="wb-tree-live mono text-[9px] tracking-[0.06em] text-(--wb-cyan) animate-[wb-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none">{t("status.writing")}</span>}
                    </button>
                    {open && (
                      <div className="wb-tree-children">
                        {round.entries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="wb-tree-row wb-tree-row--leaf flex w-[calc(100%-8px)] min-w-0 cursor-pointer items-center gap-1.5 rounded-[5px] border-0 bg-none mx-1 py-1 pl-6 pr-2 text-left text-[11px] text-(--wb-dim) hover:bg-(--wb-hover) hover:text-(--wb-text) active:bg-(--wb-press) active:text-(--wb-text)"
                            onClick={() => reveal(entry.id, { toolPanel: entry.kind === "tool" })}
                          >
                            <span className={`wb-node-kind wb-node-kind--${entry.kind} shrink-0 rounded-[3px] border border-(--wb-line-soft) px-[5px] text-[8.5px] tracking-[0.08em] uppercase font-(family-name:--wb-mono) ${NODE_KIND[entry.kind] ?? ""}`}>{kindLabel(entry.kind)}</span>
                            <span className="wb-tree-label min-w-0 flex-1 truncate">
                              {entry.kind === "user" || entry.kind === "assistant"
                                ? plainText((entry as AssistantEntry).text, 22) || kindLabel(entry.kind)
                                : entry.kind === "tool"
                                ? displayText((entry as ToolEntry).name)
                                : entry.kind === "error"
                                ? plainText((entry as ErrorEntry).message, 22)
                                : kindLabel(entry.kind)}
                            </span>
                            <span className={`wb-dot h-1.5 w-1.5 shrink-0 rounded-full bg-(--wb-faint) opacity-60 ${DOT[statusDotOf(entry)] ?? ""}`} aria-hidden="true" />
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
            <div className="wb-side-view flex min-h-0 flex-col px-2.5 pb-5 pt-3">
              <div className="wb-side-head mono mx-1.5 mb-2 mt-1 text-[9px] font-semibold tracking-[0.14em] text-(--wb-faint)">{t("wb.state").toUpperCase()}</div>
              {stateRows.length ? (
                <dl className="wb-kv m-0 grid gap-[7px] px-1.5">
                  {stateRows.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2">
                      <dt className="mono truncate text-[9.5px] text-(--wb-faint)">{key}</dt>
                      <dd className="mono m-0 min-w-0 text-[10px] whitespace-pre-wrap break-words text-(--wb-text)">{typeof value === "object" ? safeJson(value, 0) : displayText(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="wb-side-empty m-1.5 text-[11px] text-(--wb-faint)">{zh ? "状态快照为空。" : "No state snapshot yet."}</p>
              )}
              <div className="wb-side-foot mono mt-3 border-t border-(--wb-line-soft) px-1.5 pt-1.5 text-right text-[9px] tracking-[0.1em] text-(--wb-faint)">STATE v{c.stateVersion}</div>
            </div>
          )}

          {view === "meta" && (
            <div className="wb-side-view flex min-h-0 flex-col px-2.5 pb-5 pt-3">
              <div className="wb-side-head mono mx-1.5 mb-2 mt-1 text-[9px] font-semibold tracking-[0.14em] text-(--wb-faint)">{t("wb.meta").toUpperCase()}</div>
              <dl className="wb-kv m-0 grid gap-[7px] px-1.5">
                <div className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2"><dt className="mono truncate text-[9.5px] text-(--wb-faint)">thread</dt><dd className="mono m-0 min-w-0 text-[10px] whitespace-pre-wrap break-words text-(--wb-text)">{c.threadId}</dd></div>
                <div className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2"><dt className="mono truncate text-[9.5px] text-(--wb-faint)">run</dt><dd className="mono m-0 min-w-0 text-[10px] whitespace-pre-wrap break-words text-(--wb-text)">{c.runId || "—"}</dd></div>
                <div className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2"><dt className="mono truncate text-[9.5px] text-(--wb-faint)">status</dt><dd className="m-0 min-w-0 text-[10px] whitespace-pre-wrap break-words text-(--wb-text)">{statusText}</dd></div>
                <div className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2"><dt className="mono truncate text-[9.5px] text-(--wb-faint)">transport</dt><dd className="mono m-0 min-w-0 text-[10px] whitespace-pre-wrap break-words text-(--wb-text)">{displayText(c.transport) || "—"}</dd></div>
                <div className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2"><dt className="mono truncate text-[9.5px] text-(--wb-faint)">{t("chat.tokens")}</dt><dd className="mono m-0 min-w-0 text-[10px] whitespace-pre-wrap break-words text-(--wb-text)">{tokenLabel(c.tokens)}</dd></div>
                <div className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2"><dt className="mono truncate text-[9.5px] text-(--wb-faint)">{t("chat.events")}</dt><dd className="mono m-0 min-w-0 text-[10px] whitespace-pre-wrap break-words text-(--wb-text)">{c.events.length}</dd></div>
              </dl>
              <div className="wb-side-head mono mx-1.5 mb-2 mt-1 text-[9px] font-semibold tracking-[0.14em] text-(--wb-faint)">{t("chat.context").toUpperCase()}</div>
              <div className="wb-caps flex flex-wrap gap-[5px] px-1.5">
                {c.capabilities?.tools?.supported && <span className="rounded-full border border-(--wb-line-soft) px-[7px] py-0.5 text-[9.5px] text-(--wb-dim) font-(family-name:--wb-mono)">tools · {c.capabilities.tools.items?.length ?? 0}</span>}
                {c.capabilities?.reasoning?.supported && <span className="rounded-full border border-(--wb-line-soft) px-[7px] py-0.5 text-[9.5px] text-(--wb-dim) font-(family-name:--wb-mono)">reasoning</span>}
                {c.capabilities?.state?.supported && <span className="rounded-full border border-(--wb-line-soft) px-[7px] py-0.5 text-[9.5px] text-(--wb-dim) font-(family-name:--wb-mono)">state</span>}
                {c.capabilities?.humanInTheLoop?.supported && <span className="rounded-full border border-(--wb-line-soft) px-[7px] py-0.5 text-[9.5px] text-(--wb-dim) font-(family-name:--wb-mono)">interrupts</span>}
                {c.capabilities?.subagents?.supported && <span className="rounded-full border border-(--wb-line-soft) px-[7px] py-0.5 text-[9.5px] text-(--wb-dim) font-(family-name:--wb-mono)">subagents</span>}
                {!c.capabilities && <span className="wb-side-empty m-1.5 text-[11px] text-(--wb-faint)">—</span>}
              </div>
            </div>
          )}
        </aside>

        {/* ── editor column ───────────────────────────────────────── */}
        <section className="wb-editor flex min-w-0 flex-1 flex-col bg-(--wb-editor)">
          <div className="wb-tabs flex h-[34px] flex-none items-center gap-3 border-b border-(--wb-line-soft) bg-(--wb-tabbar) px-2.5">
            <div className="wb-tab flex h-full min-w-0 items-center gap-2 rounded-t-md border border-b-0 border-(--wb-line-soft) bg-(--wb-tab-face) px-3.5 text-[11.5px]" data-active="true">
              <span className={`wb-dot h-1.5 w-1.5 shrink-0 rounded-full bg-(--wb-faint) opacity-60 ${DOT[c.status] ?? ""}`} aria-hidden="true" />
              <span className="wb-tab-name max-w-[280px] truncate font-semibold">{threadLabel}</span>
              {running && <span className="wb-tab-dirty h-[7px] w-[7px] shrink-0 rounded-full bg-(--wb-accent) animate-[wb-pulse_1.2s_ease-in-out_infinite] motion-reduce:animate-none" aria-hidden="true" />}
            </div>
            <span className="wb-tabs-meta mono ml-auto overflow-hidden truncate whitespace-nowrap text-[9.5px] tracking-[0.05em] text-(--wb-faint)">
              {c.runId ? `${c.runId.slice(0, 18)}` : "—"}{running ? ` · ${clock(c.duration())}` : ""}
            </span>
          </div>

          <main className="wb-transcript min-h-0 flex-1 overflow-y-auto bg-(--wb-page) [scrollbar-width:thin] [scrollbar-color:var(--wb-scroll)_transparent]" ref={scroller} role="log" aria-live="polite" aria-label={zh ? "对话记录" : "Conversation"}>
            {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
            {c.entries.length === 0 ? (
              <div className="wb-empty mx-auto my-[72px] max-w-[420px] px-5 text-center">
                <p className="wb-empty-code mono mb-2.5 mt-0 text-[12px] leading-[1.7] text-(--wb-dim)">
                  <span className="italic text-(--wb-faint)" aria-hidden="true">// </span>
                  {t("wb.empty")}
                </p>
                <p className="wb-empty-hint mono m-0 text-[9.5px] tracking-[0.14em] text-(--wb-faint) uppercase">{t("wb.viewTree")} · {t("wb.terminal")}</p>
              </div>
            ) : (
              <div className="wb-rows flex min-h-full flex-col">
                {(() => {
                  const rowCtx = { zh, plugins, openTools, setOpenTools, openReasoning, setOpenReasoning, editingId, editJson, setEditJson, setEditingId, beginEdit, approve, reveal };
                  const rowFor = (entry: Entry) => (
                    <div key={entry.id} id={`wb-e-${entry.id}`} className="wb-row grid grid-cols-[46px_minmax(0,1fr)] max-[720px]:grid-cols-[34px_minmax(0,1fr)]" data-kind={entry.kind}>
                      <div className={`${WB_GUTTER} mono`} aria-hidden="true">
                        <span className={`wb-line inline-block opacity-[var(--wb-line-num-opacity,0.75)] data-[active]:text-(--wb-accent) data-[active]:opacity-100`} data-active={entry.kind === "assistant" && (entry as AssistantEntry).streaming ? "true" : undefined}>
                          {lineOf.get(entry.id) ?? 0}
                        </span>
                      </div>
                      <div className={WB_CELL}>{renderEntry(entry, rowCtx)}</div>
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
          <footer className={WB_BASE}>
            {!!c.suggestions.length && (
              <div className="wb-suggestions mx-auto mb-[9px] flex max-w-[760px] flex-wrap gap-[7px]" role="list" aria-label={zh ? "建议" : "Suggestions"}>
                {c.suggestions.slice(0, 4).map((suggestion, index) => (
                  <button
                    key={`suggestion-${index}`}
                    type="button"
                    role="listitem"
                    className="wb-suggestion mono inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-(--wb-line-soft) bg-none px-2.5 py-1 text-[10px] text-(--wb-dim) hover:border-[color-mix(in_srgb,var(--wb-accent)_40%,transparent)] hover:text-(--wb-text) active:border-[color-mix(in_srgb,var(--wb-accent)_55%,transparent)] active:bg-[color-mix(in_srgb,var(--wb-accent)_8%,transparent)] active:text-(--wb-text)"
                    onClick={() => setDraft(suggestion)}
                  >
                    <Icon name="sparkle" size={11} />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="wb-composer mx-auto flex max-w-[760px] items-end gap-2.5 rounded-lg border border-(--wb-line) bg-(--wb-deep) px-3 py-[9px] focus-within:border-[color-mix(in_srgb,var(--wb-accent)_55%,transparent)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--wb-accent)_12%,transparent)]">
              <span className="wb-prompt mono shrink-0 pb-0.5 text-[13px] text-(--wb-accent)" aria-hidden="true">›</span>
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
                className="max-h-[120px] min-h-5 w-full min-w-0 flex-1 resize-none border-0 bg-transparent py-0.5 pl-0 pr-0 text-[12.5px] leading-[1.6] text-(--wb-text) outline-none focus-visible:outline-none placeholder:text-(--wb-faint) disabled:opacity-60"
              />
              {running ? (
                <button type="button" className="wb-send inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--wb-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--wb-accent)_12%,transparent)] text-(--wb-cyan) enabled:hover:bg-[color-mix(in_srgb,var(--wb-accent)_22%,transparent)] enabled:active:bg-[color-mix(in_srgb,var(--wb-accent)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-35" onClick={() => c.stop()} aria-label={t("chat.stop")} title={t("chat.stop")}>
                  <Icon name="stop" size={13} />
                </button>
              ) : (
                <button type="button" className="wb-send inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--wb-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--wb-accent)_12%,transparent)] text-(--wb-cyan) enabled:hover:bg-[color-mix(in_srgb,var(--wb-accent)_22%,transparent)] enabled:active:bg-[color-mix(in_srgb,var(--wb-accent)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-35" onClick={send} disabled={!draft.trim() || pending.length > 0} aria-label={t("chat.send")} title={t("chat.send")}>
                  <Icon name="send" size={13} />
                </button>
              )}
            </div>
          </footer>

          {/* ── terminal panel (tools) ────────────────────────────── */}
          <section className="wb-panel flex-none border-t border-(--wb-line-soft) bg-(--wb-chrome) [--wb-proto-gutter:150px]" data-open={panelOpen || undefined} aria-label={t("wb.terminal")}>
            <button
              type="button"
              className="wb-panel-head flex h-[30px] w-full cursor-pointer items-center gap-[9px] border-0 bg-none pl-[62px] pr-[var(--wb-proto-gutter)] text-left text-(--wb-dim) hover:bg-(--wb-wash) hover:text-(--wb-text) active:bg-(--wb-hover) active:text-(--wb-text) max-[1080px]:pl-[26px] max-[720px]:pl-3.5"
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
              <Icon name="chevron" size={10} className={`${CHEV} ${panelOpen ? "rotate-90" : "rotate-0"}`} />
              <span className="wb-panel-title mono text-[9px] font-semibold tracking-[0.16em] text-(--wb-faint)">{t("wb.terminal").toUpperCase()}</span>
              <span className="wb-panel-count mono text-[10px] text-(--wb-dim)">{tools.length ? `${tools.length} ${t("chat.tools")}` : t("wb.terminalEmpty")}</span>
              <span className="wb-panel-meta mono ml-auto flex gap-2.5">
                {tools.filter((tool) => tool.status === "error").length > 0 && (
                  <span className="wb-panel-fails text-[10px] text-(--wb-red)">{tools.filter((tool) => tool.status === "error").length} {t("chat.failed")}</span>
                )}
              </span>
            </button>
            {panelOpen && (
              <div className="wb-panel-body max-h-[190px] overflow-y-auto pb-2.5 pl-[62px] pr-[var(--wb-proto-gutter)] pt-0.5 [scrollbar-width:thin] [scrollbar-color:var(--wb-scroll)_transparent] max-[1080px]:pl-[26px] max-[720px]:pl-3.5">
                {tools.length === 0 && <p className="wb-panel-empty mono mb-2 mt-1 text-[10.5px] text-(--wb-faint)">{t("wb.terminalEmpty")}</p>}
                {tools.map((tool) => (
                  <TerminalRow key={tool.id} entry={tool} open={!!openTools[tool.id]} onToggle={() => setOpenTools((prev) => ({ ...prev, [tool.id]: !prev[tool.id] }))} />
                ))}
              </div>
            )}
          </section>
        </section>
      </div>

      {/* ── status bar ─────────────────────────────────────────────── */}
      <footer className="wb-statusbar flex h-[26px] flex-none items-center gap-3.5 overflow-hidden border-t border-(--wb-line-soft) bg-(--wb-shell) px-3.5 text-[10px] text-(--wb-dim)">
        <span className={`wb-status wb-status--${c.status} inline-flex items-center gap-1.5 ${STATUS_TEXT[c.status] ?? "text-(--wb-text)"}`}>
          <i className={`wb-status-led h-[7px] w-[7px] shrink-0 rounded-full bg-(--wb-faint) ${STATUS_LED[c.status] ?? ""}`} aria-hidden="true" />
          {statusText}
        </span>
        <span className="wb-status-item mono whitespace-nowrap text-(--wb-faint)">{displayText(c.transport) || "—"}</span>
        {c.status === "error" && c.entries.filter((entry) => entry.kind === "error").slice(-1).map((entry) => (
          <span key={entry.id} className="wb-status-item wb-status-item--error mono min-w-0 overflow-hidden truncate text-(--wb-red)">
            {plainText((entry as ErrorEntry).message, 60)}
          </span>
        ))}
        <span className="wb-status-spacer flex-1" />
        {pending.length > 0 && (
          <span className="wb-status-item wb-status-item--kbd mono whitespace-nowrap text-(--wb-amber)">
            <kbd className="rounded-[3px] border border-(--wb-line) px-1 font-(family-name:--wb-mono) text-[9px]">Y</kbd>/<kbd className="rounded-[3px] border border-(--wb-line) px-1 font-(family-name:--wb-mono) text-[9px]">N</kbd> · {t("intr.paused")}
          </span>
        )}
        <span className="wb-status-item mono whitespace-nowrap text-(--wb-faint)">{t("chat.tokens")} {tokenLabel(c.tokens)}</span>
        <span className="wb-status-item mono whitespace-nowrap text-(--wb-faint)">{t("chat.events")} {c.events.length}</span>
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
      <div className="wb-row wb-row--fold grid grid-cols-[46px_minmax(0,1fr)] max-[720px]:grid-cols-[34px_minmax(0,1fr)]" data-kind="fold">
        <div className={`${WB_GUTTER} mono`} aria-hidden="true">
          <span className="wb-line inline-block text-(--wb-faint) opacity-[var(--wb-line-num-opacity,0.75)]">{open ? "" : line}</span>
        </div>
        <div className={WB_CELL}>
          <button
            type="button"
            className="wb-fold-head mono flex min-w-0 w-full max-w-[760px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-(--wb-line-soft) bg-none px-2.5 py-1 text-left text-[10px] text-(--wb-dim) hover:border-[color-mix(in_srgb,var(--wb-cyan)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--wb-cyan)_5%,transparent)] hover:text-(--wb-text) active:border-[color-mix(in_srgb,var(--wb-cyan)_55%,transparent)] active:bg-[color-mix(in_srgb,var(--wb-cyan)_9%,transparent)] active:text-(--wb-text)"
            data-fold-head=""
            aria-expanded={open}
            onClick={onToggle}
            onKeyDown={(event) => {
              // explicit for the keydown contract test (jsdom runs no activation)
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle();
              }
            }}
          >
            <Icon name="chevron" size={10} className={`${CHEV} text-(--wb-cyan) ${open ? "rotate-90" : "rotate-0"}`} />
            <span className="wb-fold-title shrink-0 tracking-[0.06em] uppercase">{t("fold.group")}</span>
            <span className="wb-fold-summary min-w-0 truncate italic">
              {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
              {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
              {preview}
              {extra > 0 && ` +${extra} ${t("fold.more")}`}
              {stats.reasoningCount === 0 && stats.toolCount === 0 && `0 ${t("fold.steps")}`}
            </span>
            <span className="wb-fold-meta ml-auto inline-flex shrink-0 items-center gap-1.5">
              {duration !== undefined && <span className="wb-fold-time text-(--wb-faint)">{formatDuration(duration)}</span>}
              {failures.length > 0 && (
                <span className={`wb-fold-flag rounded-[3px] px-1.5 text-[9px] tracking-[0.06em] ${FLAG_FAILURE[failures[0]] ?? ""}`} data-failure={failures[0]}>
                  {failures.includes("error") ? t("fold.hasFailures") : t("chat.interrupted")}
                </span>
              )}
              {foldGroupOpen(entries) && <span className={`wb-fold-flag wb-fold-flag--live rounded-[3px] px-1.5 text-[9px] tracking-[0.06em] text-(--wb-cyan) bg-[color-mix(in_srgb,var(--wb-cyan)_10%,transparent)]`}>{t("chat.executing")}</span>}
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
        <button type="button" className="wb-tool-jump mono flex min-w-0 w-full max-w-[760px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-(--wb-line-soft) bg-none px-2.5 py-[5px] text-left text-[11px] text-(--wb-dim) hover:border-[color-mix(in_srgb,var(--wb-violet)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--wb-violet)_5%,transparent)] hover:text-(--wb-text) active:border-[color-mix(in_srgb,var(--wb-violet)_55%,transparent)] active:bg-[color-mix(in_srgb,var(--wb-violet)_9%,transparent)] active:text-(--wb-text)" onClick={() => ctx.reveal(entry.id, { toolPanel: true })}>
          <Icon name="chevron" size={10} className={`${CHEV} rotate-0 text-(--wb-violet)`} />
          <span className="wb-tool-jump-name truncate text-(--wb-violet)">{displayText((entry as ToolEntry).name)}</span>
          <span className={`wb-stage wb-stage--${toolStage((entry as ToolEntry).status)} shrink-0 rounded-[3px] px-1.5 text-[9px] tracking-[0.06em] ${STAGE[toolStage((entry as ToolEntry).status)] ?? ""}`}>{stageWord((entry as ToolEntry).status)}</span>
          <span className="wb-tool-jump-hint ml-auto shrink-0 text-[9.5px] text-(--wb-faint)">{t("wb.openInTerminal")}</span>
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
    <div className="wb-user max-w-[760px] rounded-r-lg border-l-2 border-(--wb-accent) bg-[color-mix(in_srgb,var(--wb-accent)_7%,transparent)] px-3.5 py-[9px]">
      <span className="wb-user-tag mono mb-1 block text-[9px] tracking-[0.08em] text-(--wb-accent) uppercase">{zh ? "输入" : "in"} · {timeOf(entry.at)}</span>
      <p className="m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:break-word]">{entry.text}</p>
    </div>
  );
};

function AssistantRow({ entry }: { entry: AssistantEntry }) {
  return (
    <div className="wb-assistant group relative max-w-[760px] text-[13px]">
      <Markdown text={entry.text} className="md wb-md min-w-0" />
      {!entry.text && entry.streaming && <span className="wb-caret ml-0.5 mt-0.5 inline-block h-[15px] w-2 bg-(--wb-accent) align-[-2px] animate-[wb-blink_1s_steps(2)_infinite] motion-reduce:animate-none" aria-hidden="true" />}
      {entry.streaming && !!entry.text && <span className="wb-caret wb-caret--inline ml-0.5 mt-0.5 inline-block h-[15px] w-2 bg-(--wb-accent) align-[-2px] animate-[wb-blink_1s_steps(2)_infinite] motion-reduce:animate-none" aria-hidden="true" />}
      {!entry.streaming && !!entry.text && (
        <button
          type="button"
          className="wb-row-action absolute right-0 top-0 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[5px] border border-(--wb-line-soft) bg-(--wb-deep) text-(--wb-faint) opacity-0 group-hover:opacity-100 hover:border-(--wb-line) hover:text-(--wb-text) active:bg-(--wb-press) active:text-(--wb-text) active:shadow-[inset_0_0_0_1px_var(--wb-line)]"
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
    <div className="wb-reason max-w-[760px]">
      <button type="button" className="wb-reason-head mono inline-flex cursor-pointer items-center gap-[7px] rounded-[5px] border-0 bg-[color-mix(in_srgb,var(--wb-cyan)_6%,transparent)] px-2.5 py-1 text-[10px] italic tracking-[0.06em] text-(--wb-dim) uppercase hover:bg-[color-mix(in_srgb,var(--wb-cyan)_10%,transparent)] hover:text-(--wb-text) active:bg-[color-mix(in_srgb,var(--wb-cyan)_14%,transparent)] active:text-(--wb-text)" aria-expanded={open} onClick={onToggle}>
        <Icon name="brain" size={11} />
        <span>{entry.streaming ? t("status.thinking") : t("status.thought")}</span>
        {!!entry.tokens && <span className="wb-reason-meta normal-case tracking-normal">{entry.tokens} {t("chat.tokens")}</span>}
        {entry.encryptedValue && <span className="wb-reason-badge rounded-[3px] border border-[color-mix(in_srgb,var(--wb-violet)_30%,transparent)] px-[5px] text-[8.5px] text-(--wb-violet)">encrypted</span>}
        <Icon name="chevron" size={9} className={CHEV} />
      </button>
      {open && (
        <div className="wb-reason-body mb-1 ml-2.5 mt-2 border-l border-[color-mix(in_srgb,var(--wb-cyan)_25%,transparent)] pb-0.5 pl-3 pt-0.5 text-[12px] italic text-(--wb-dim)">
          {entry.text ? <p className="mb-1.5 mt-0 whitespace-pre-wrap">{entry.text}</p> : <p className="mb-1.5 mt-0 whitespace-pre-wrap text-(--wb-dim)">encrypted reasoning item</p>}
          {entry.encryptedValue && <pre className={WB_PRE}>{entry.encryptedValue.slice(0, 160)}</pre>}
        </div>
      )}
    </div>
  );
}

function PlanRow({ entry }: { entry: PlanEntry }) {
  const view = planView(entry);
  return (
    <div className="wb-plan max-w-[760px] rounded-lg border border-(--wb-line-soft) bg-(--wb-deep) px-3.5 py-2.5">
      <div className="wb-plan-head mb-[7px] flex items-center gap-2">
        <Icon name="layers" size={12} className="text-(--wb-cyan)" />
        <span className="wb-plan-title min-w-0 truncate text-[12px] font-semibold">{displayText(entry.title)}</span>
        <span className="wb-plan-count mono ml-auto text-[10px] text-(--wb-dim)">
          {view.steps.filter((step) => step.state === "done").length}/{view.steps.length || 0}
        </span>
      </div>
      {view.rawOnly ? (
        <pre className={WB_PRE}>{planRawText(view)}</pre>
      ) : (
        <ul className="wb-plan-list m-0 grid list-none gap-[5px] p-0">
          {view.steps.map((step) => (
            <li key={step.id} data-state={step.state} className={`flex items-baseline gap-2 text-[12px] ${PLAN_STATE[step.state] ?? "text-(--wb-dim)"}`}>
              <span className={`wb-plan-check inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border border-(--wb-line) ${PLAN_CHECK[step.state] ?? ""}`}>{step.state === "done" && <Icon name="check" size={10} />}</span>
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
    <div className="wb-step mono flex max-w-[760px] items-center gap-2 text-[10.5px] text-(--wb-dim)" data-status={entry.status}>
      <span className={`wb-step-dot h-1.5 w-1.5 shrink-0 rounded-full bg-(--wb-cyan) ${STEP_DOT[entry.status] ?? ""}`} aria-hidden="true" />
      <span>{displayText(entry.name)}</span>
      <span className="wb-dim text-(--wb-dim)">{word}</span>
    </div>
  );
}

function SubagentRow({ entry }: { entry: SubagentEntry }) {
  const word = entry.status === "running" ? t("status.running") : entry.status === "error" ? t("chat.failed") : t("chat.done");
  return (
    <div className={`wb-subagent mono flex min-w-0 max-w-[760px] items-center gap-2 rounded-md border border-(--wb-line-soft) bg-[color-mix(in_srgb,var(--wb-accent)_4%,transparent)] px-2.5 py-[5px] text-[10.5px] text-(--wb-text) ${entry.status === "running" ? "border-[color-mix(in_srgb,var(--wb-cyan)_30%,transparent)]" : ""}`} data-status={entry.status}>
      <Icon name="activity" size={11} />
      <span>{displayText(entry.name)}</span>
      <span className="wb-dim text-(--wb-dim)">{word}</span>
      {entry.detail && <span className="wb-subagent-detail ml-auto min-w-0 truncate text-[10px] text-(--wb-faint)">{displayText(entry.detail)}</span>}
    </div>
  );
}

function CustomRow({ entry, plugins }: { entry: CustomEntry; plugins: ReturnType<typeof useSkinPlugins> }) {
  const plugin = plugins.custom?.(entry);
  if (plugin) return <div className="wb-custom max-w-[760px] text-[11px]">{plugin}</div>;
  return (
    <details className="wb-custom max-w-[760px] text-[11px]">
      <summary className="mono flex cursor-pointer list-none items-center gap-2 rounded-md border border-dashed border-(--wb-line-soft) px-2.5 py-[5px] text-(--wb-dim) hover:text-(--wb-text) active:bg-(--wb-wash) active:text-(--wb-text) [&::-webkit-details-marker]:hidden [.wb-custom[open]_&]:rounded-b-none">
        <span className="wb-node-kind wb-node-kind--custom shrink-0 rounded-[3px] border border-(--wb-line-soft) px-[5px] text-[8.5px] tracking-[0.08em] uppercase font-(family-name:--wb-mono)">{t("wb.node.custom")}</span>
        <span>{displayText(entry.name)}</span>
        <Icon name="chevron" size={9} className={`${CHEV} rotate-0 [.wb-custom[open]_&]:rotate-90`} />
      </summary>
      <pre className={`${WB_PRE} rounded-t-none -mt-px`}>{safeJson(entry.value, 2)}</pre>
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
    <div className={`wb-approval max-w-[760px] rounded-lg border px-3.5 py-3 ${pendingCard ? "is-pending border-[color-mix(in_srgb,var(--wb-amber)_40%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--wb-amber)_8%,transparent),color-mix(in_srgb,var(--wb-amber)_2%,transparent)),var(--wb-deep)]" : "is-resolved border-(--wb-line-soft) bg-(--wb-deep) opacity-75"} ${entry.expired ? "border-(--wb-line-soft)" : ""}`} data-expired={entry.expired || undefined}>
      <div className={`wb-approval-head flex items-center gap-2 text-[11px] font-semibold tracking-[0.04em] ${pendingCard ? "text-(--wb-amber)" : "text-(--wb-dim)"}`}>
        <Icon name={entry.expired ? "clock" : "shield"} size={13} />
        <span className="wb-approval-label">{headWord}</span>
        <span className="wb-approval-time mono ml-auto text-[9.5px] font-normal text-(--wb-faint)">{timeOf(entry.at)}</span>
      </div>
      <p className="wb-approval-msg mb-0 mt-2 text-[12.5px] leading-[1.6] [overflow-wrap:break-word]">{displayText(entry.message)}</p>
      {entry.description && <p className="wb-dim wb-approval-desc mb-0 mt-[5px] text-[11.5px] text-(--wb-dim)">{displayText(entry.description)}</p>}
      {!!entry.details.length && (
        <dl className="wb-kv wb-approval-details m-0 mt-[9px] grid gap-[7px] px-1.5">
          {entry.details.map((detail, index) => (
            <div key={`detail-${index}`} className="grid grid-cols-[minmax(64px,0.42fr)_minmax(0,1fr)] items-baseline gap-2">
              <dt className="mono truncate text-[9.5px] text-(--wb-faint)">{displayText(detail.label)}</dt>
              <dd className="m-0 min-w-0 text-[11px] whitespace-pre-wrap break-words text-(--wb-text)">{displayText(detail.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.responseSchema && <pre className={`${WB_PRE} mt-[9px]`}>{safeJson(entry.responseSchema, 2)}</pre>}
      {pendingCard && (
        <>
          {ctx.editingId === entry.id && (
            <div className="wb-edit mt-2.5">
              <label className="mono mb-[5px] block text-[9px] tracking-[0.12em] text-(--wb-faint) uppercase">{t("intr.edit")}</label>
              <textarea
                aria-label={ctx.zh ? "编辑参数" : "Edit arguments"}
                value={ctx.editJson[entry.id] ?? ""}
                onChange={(event) => ctx.setEditJson((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                spellCheck={false}
                className="min-h-[84px] w-full resize-y rounded-md border border-(--wb-line) bg-(--wb-deep) px-2.5 py-2 text-[11px] leading-[1.55] text-(--wb-text) outline-none font-(family-name:--wb-mono) focus-visible:outline-[1.5px] focus-visible:outline-(--wb-accent) focus-visible:outline-offset-0"
              />
            </div>
          )}
          <div className="wb-approval-actions mt-[11px] flex flex-wrap items-center gap-2">
            <button type="button" className="wb-btn wb-btn--primary cursor-pointer rounded-md border border-transparent bg-(--wb-accent) px-3 py-[5px] text-[11.5px] font-semibold text-(--wb-accent-fg) hover:brightness-[1.12] active:brightness-90" onClick={() => ctx.approve(entry, true, true)}>
              {ctx.editingId === entry.id ? t("intr.approveEdited") : t("intr.approve")}
            </button>
            <button type="button" className="wb-btn cursor-pointer rounded-md border border-(--wb-line) bg-(--wb-wash-btn) px-3 py-[5px] text-[11.5px] text-(--wb-text) hover:border-(--wb-border-hover) hover:bg-(--wb-hover-strong) active:border-(--wb-border-active) active:bg-(--wb-press-strong)" onClick={() => ctx.approve(entry, false, false)}>
              {t("intr.deny")}
            </button>
            <button
              type="button"
              className="wb-btn wb-btn--ghost cursor-pointer rounded-md border border-transparent bg-none px-3 py-[5px] text-[11.5px] text-(--wb-dim) hover:bg-(--wb-hover) hover:text-(--wb-text) active:bg-(--wb-press) active:text-(--wb-text)"
              onClick={() => (ctx.editingId === entry.id ? ctx.setEditingId(null) : ctx.beginEdit(entry.id))}
            >
              {ctx.editingId === entry.id ? t("intr.cancel") : t("intr.edit")}
            </button>
            <span className="wb-kbd-hint mono ml-auto text-[9px] tracking-[0.06em] text-(--wb-faint)" aria-hidden="true">{t("wb.ynHint")}</span>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorRow({ entry }: { entry: ErrorEntry }) {
  return (
    <div className="wb-error flex max-w-[760px] items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--wb-red)_35%,transparent)] bg-[color-mix(in_srgb,var(--wb-red)_7%,transparent)] px-3 py-2 text-[12px] text-(--wb-red)" role="alert">
      <Icon name="x" size={12} className="mt-[3px] shrink-0" />
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
    <div className={`wb-term-row my-1.5 overflow-hidden rounded-md border border-(--wb-line-soft) border-l-2 bg-(--wb-deep) ${TERM_STAGE[toolStage(entry.status)] ?? ""}`} data-stage={toolStage(entry.status)}>
      <button type="button" className="wb-term-head mono flex min-w-0 w-full cursor-pointer items-center gap-2 border-0 bg-none px-[11px] py-[7px] text-left text-[11px] text-(--wb-text) hover:bg-(--wb-wash) active:bg-(--wb-hover) active:shadow-[inset_0_0_0_1px_var(--wb-line)]" aria-expanded={open} onClick={onToggle}>
        <span className="wb-term-prompt shrink-0 text-(--wb-green)" aria-hidden="true">❯</span>
        <span className="wb-term-name shrink-0 text-(--wb-violet)">{displayText(entry.name)}</span>
        {brief && <span className="wb-term-brief min-w-0 flex-1 truncate text-[10px] text-(--wb-faint)">{brief}</span>}
        <span className={`wb-stage wb-stage--${toolStage(entry.status)} shrink-0 rounded-[3px] px-1.5 text-[9px] tracking-[0.06em] ${STAGE[toolStage(entry.status)] ?? ""}`}>{stageWord(entry.status)}</span>
        <span className="wb-term-time shrink-0 text-[10px] text-(--wb-faint)">{entry.durationMs ? formatDuration(entry.durationMs) : ""}</span>
        <Icon name="chevron" size={9} className={CHEV} />
      </button>
      {open && (
        <div className="wb-term-body border-t border-(--wb-line-soft) px-3 pb-[11px] pt-[9px]">
          <pre className={WB_PRE}>{displayText(entry.argsRaw) || safeJson(entry.args, 2)}</pre>
          <ToolResult entry={entry} variant="particle" />
          {entry.error && <p className="wb-term-error mb-0 mt-[7px] px-3 pb-[9px] text-[11px] text-(--wb-red)">{displayText(entry.error)}</p>}
        </div>
      )}
      {!open && entry.status === "error" && <p className="wb-term-error mb-0 mt-[7px] px-3 pb-[9px] text-[11px] text-(--wb-red)">{displayText(entry.error) || t("chat.failed")}</p>}
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
