import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useConversation, useSkinBranding, useSkinLang, useSkinPlugins } from "../../host";
import type {
  AssistantEntry,
  CustomEntry,
  Entry,
  ErrorEntry,
  InterruptEntry,
  PlanEntry,
  ReasoningEntry,
  SkinPlugins,
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
  foldGroupFailures,
  foldGroupOpen,
  foldGroupStats,
} from "../../shared/conversationGroups";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { Icon } from "../../shared/Icon";
import { formatDuration } from "../../utils";
import { t } from "../../i18n";
import "./orbit.css";

/* ═══ Orbit — depth is the identity ═══════════════════════════════════
   A Three.js starfield sits behind a DOM transcript in real perspective.
   Nothing textual is drawn in WebGL: every message is a DOM panel with
   translateZ depth, so IME, selection, screen readers and tests all keep
   working. The layer table is the design contract:

     front  z +80   approval cards (face-on, glowing)
     alert  z +36   error rows
     near   z   0   assistant replies
     plan   z -16   plans
     holo   z -40   fold groups / reasoning / tools (4° side tilt)
     far    z-120   user messages (slightly smaller, dimmer)

   Text never tilts beyond 6°; the composer tray is rotated 18° as a
   surface, with its content counter-rotated back to the lens. */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

const Starfield = lazy(() => import("./Starfield"));

const MONO = "font-(family-name:--or-mono)";
const CHEV = "shrink-0 opacity-60 [transition:transform_0.18s_ease]";

const ROW = "or-row relative min-w-0";
const DEPTH = {
  far: "[transform:translateZ(-120px)_scale(0.97)]",
  near: "[transform:translateZ(0px)]",
  holo: "[transform:translateZ(-40px)_rotateY(4deg)]",
  telemetry: "[transform:translateZ(-40px)]",
  plan: "[transform:translateZ(-16px)]",
  front: "[transform:translateZ(80px)]",
  alert: "[transform:translateZ(36px)]",
} as const;

const HOVER_CARD =
  "transition-[translate,border-color,box-shadow,background-color] duration-300 hover:-translate-y-2 hover:border-(--or-line-strong) focus-within:border-(--or-line-strong)";

/* Generated-markdown typography as Tailwind descendant variants — the
   skin ships no markdown CSS block (task-13 conversion discipline). */
const OR_MD = [
  "[&_p]:m-0 [&_p]:mb-2 [&_p:last-child]:mb-0",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-[1.05em] [&_h1]:font-semibold",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[1.02em] [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[1em] [&_h3]:font-semibold",
  "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1",
  "[&_code]:rounded [&_code]:bg-[color-mix(in_srgb,var(--or-violet)_16%,transparent)] [&_code]:px-1 [&_code]:py-px [&_code]:text-[0.86em] [&_code]:text-(--or-cyan)",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-(--or-line-soft) [&_pre]:bg-(--or-deep) [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-(--or-text)",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px]",
  "[&_th]:border [&_th]:border-(--or-line-soft) [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left",
  "[&_td]:border [&_td]:border-(--or-line-soft) [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-left",
  "[&_a]:text-(--or-mint) [&_a]:underline [&_a]:decoration-[color-mix(in_srgb,var(--or-mint)_45%,transparent)] [&_a]:underline-offset-2",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-(--or-violet) [&_blockquote]:pl-3 [&_blockquote]:text-(--or-dim)",
  "[&_hr]:my-3 [&_hr]:border-(--or-line-soft)",
].join(" ");

const STATUS_CHIP: Record<string, string> = {
  idle: "border-(--or-line) bg-(--or-wash) text-(--or-faint)",
  running:
    "border-[color-mix(in_srgb,var(--or-cyan)_42%,transparent)] bg-[color-mix(in_srgb,var(--or-cyan)_10%,transparent)] text-(--or-cyan) animate-[or-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
  interrupted:
    "border-[color-mix(in_srgb,var(--or-amber)_42%,transparent)] bg-[color-mix(in_srgb,var(--or-amber)_10%,transparent)] text-(--or-amber)",
  done: "border-[color-mix(in_srgb,var(--or-green)_42%,transparent)] bg-[color-mix(in_srgb,var(--or-green)_10%,transparent)] text-(--or-green)",
  error:
    "border-[color-mix(in_srgb,var(--or-red)_46%,transparent)] bg-[color-mix(in_srgb,var(--or-red)_10%,transparent)] text-(--or-red)",
  stopped: "border-(--or-line-strong) bg-(--or-wash) text-(--or-dim)",
};

const STATUS_DOT: Record<string, string> = {
  idle: "bg-(--or-faint) opacity-60",
  running: "bg-(--or-cyan) animate-[or-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
  interrupted: "bg-(--or-amber)",
  done: "bg-(--or-green)",
  error: "bg-(--or-red)",
  stopped: "bg-(--or-dim)",
};

/* tone/dot are language-free; labels resolve through t() at render time
   (module scope would freeze the locale before the host pins it). */
const TOOL_STAGE: Record<string, { tone: string; dot: string }> = {
  args: { tone: "text-(--or-cyan)", dot: "bg-(--or-cyan)" },
  executing: { tone: "text-(--or-cyan)", dot: "bg-(--or-cyan)" },
  interrupted: { tone: "text-(--or-amber)", dot: "bg-(--or-amber)" },
  done: { tone: "text-(--or-green)", dot: "bg-(--or-green)" },
  error: { tone: "text-(--or-red)", dot: "bg-(--or-red)" },
};

function toolStageLabel(status: string): string {
  if (status === "args") return t("chat.streamingArgs");
  if (status === "interrupted") return t("chat.interrupted");
  if (status === "done") return t("chat.done");
  if (status === "error") return t("chat.failed");
  return t("chat.executing");
}

const STEP_STATE: Record<string, { text: string; dot: string }> = {
  running: { text: "text-(--or-cyan)", dot: "bg-(--or-cyan) animate-[or-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none" },
  done: { text: "text-(--or-green)", dot: "bg-(--or-green)" },
  failed: { text: "text-(--or-red)", dot: "bg-(--or-red)" },
};

const SUBAGENT_STATE: Record<string, { text: string; dot: string }> = {
  running: { text: "text-(--or-cyan)", dot: "bg-(--or-cyan) animate-[or-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none" },
  done: { text: "text-(--or-green)", dot: "bg-(--or-green)" },
  error: { text: "text-(--or-red)", dot: "bg-(--or-red)" },
};

const PLAN_STEP: Record<string, { text: string; dot: string }> = {
  done: { text: "text-(--or-green)", dot: "border-(--or-green) bg-(--or-green)" },
  active: { text: "text-(--or-text)", dot: "border-(--or-cyan) bg-[color-mix(in_srgb,var(--or-cyan)_30%,transparent)]" },
  pending: { text: "text-(--or-dim)", dot: "border-(--or-line-strong) bg-transparent" },
  cancelled: { text: "text-(--or-faint) line-through", dot: "border-(--or-faint) bg-transparent" },
};

/* Card faces are language-free; the state label is resolved with t() in
   InterruptRow so zh/en both render the right copy. */
const APPROVAL_STATE: Record<string, { card: string; icon: string }> = {
  pending: {
    card: "border-[color-mix(in_srgb,var(--or-amber)_55%,transparent)] bg-[color-mix(in_srgb,var(--or-amber)_8%,var(--or-panel))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--or-amber)_28%,transparent),0_0_46px_-10px_color-mix(in_srgb,var(--or-amber)_60%,transparent)]",
    icon: "text-(--or-amber)",
  },
  expired: {
    card: "border-(--or-line-strong) bg-(--or-panel-soft) opacity-80",
    icon: "text-(--or-faint)",
  },
  approved: {
    card: "border-[color-mix(in_srgb,var(--or-green)_38%,transparent)] bg-[color-mix(in_srgb,var(--or-green)_7%,var(--or-panel))]",
    icon: "text-(--or-green)",
  },
  denied: {
    card: "border-[color-mix(in_srgb,var(--or-red)_38%,transparent)] bg-[color-mix(in_srgb,var(--or-red)_7%,var(--or-panel))]",
    icon: "text-(--or-red)",
  },
};

function approvalLabel(state: string): string {
  if (state === "expired") return t("intr.expired");
  if (state === "approved") return t("or.approved");
  if (state === "denied") return t("or.denied");
  return t("or.auth");
}

const FAILURE_FLAG: Record<string, string> = {
  error: "text-(--or-red) bg-[color-mix(in_srgb,var(--or-red)_12%,transparent)]",
  interrupted: "text-(--or-amber) bg-[color-mix(in_srgb,var(--or-amber)_12%,transparent)]",
};

interface RenderCtx {
  zh: boolean;
  plugins: SkinPlugins;
  openTools: Record<string, boolean>;
  setOpenTools: Dispatch<SetStateAction<Record<string, boolean>>>;
  openReasoning: Record<string, boolean>;
  setOpenReasoning: Dispatch<SetStateAction<Record<string, boolean>>>;
  editingId: string | null;
  editJson: Record<string, string>;
  setEditJson: Dispatch<SetStateAction<Record<string, string>>>;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  beginEdit: (id: string) => void;
  approve: (entry: InterruptEntry, approved: boolean, withEdits: boolean) => void;
}

function initialReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_QUERY).matches
      : false;
  } catch {
    return false;
  }
}

function statusLabel(status: string): string {
  if (status === "idle") return t("status.idle");
  if (status === "running") return t("status.running");
  if (status === "interrupted") return t("status.interrupted");
  if (status === "done") return t("status.done");
  if (status === "error") return t("status.error");
  return t("status.stopped");
}

/**
 * Orbit — the conversation as a room in deep space.
 *
 * The starfield is a lazily loaded Three.js canvas (one draw call) with a
 * CSS-starfield fallback; the transcript is DOM with real translateZ depth,
 * so text stays selectable, crisp and readable. Approvals float in front of
 * the lens, user messages sit on the outer ring, and the composer is a
 * bottom tray tilted into the floor.
 */
export function OrbitPage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const plugins = useSkinPlugins();
  const lang = useSkinLang();
  const zh = lang === "zh";
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);
  const scroller = useStickToBottom<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [draft, setDraft] = useState("");
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  // Fold groups: per-group user override on top of the derived default.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  // Approval drafts are keyed by interrupt id — two pending cards never
  // share an editor or submit each other's args (Fix B shape).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState<Record<string, string>>({});
  const [reduced, setReduced] = useState(initialReducedMotion);
  const [sky, setSky] = useState<"loading" | "ready" | "failed">("loading");

  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries);
  const firstPending = firstPendingInterrupt(c.entries);
  const foldItems = useMemo(() => conversationGroups(visible), [visible]);
  const metadataRows = entriesOf(c.metadata ?? {});
  const stateRows = entriesOf(c.sharedState);
  const webglSky = !reduced && sky !== "failed";

  // Whole-scene parallax: pointer position is written straight to CSS
  // variables in rAF (never React state), and the sky/shell read them at
  // different rates. Disabled entirely under reduced motion.
  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      frame = 0;
      root.style.setProperty("--or-px", px.toFixed(3));
      root.style.setProperty("--or-py", py.toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      px = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      py = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--or-px");
      root.style.removeProperty("--or-py");
    };
  }, [reduced]);

  // Follow runtime preference changes: flipping to reduce unmounts Three
  // (the CSS starfield takes over); flipping back re-mounts it.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

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
    const tool = c.entries.find(
      (entry): entry is ToolEntry => entry.kind === "tool" && entry.id === target.toolCallId
    );
    setEditJson((prev) => ({
      ...prev,
      [target.id]: JSON.stringify(tool?.args ?? target.metadata ?? {}, null, 2),
    }));
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

  const ctx: RenderCtx = {
    zh,
    plugins,
    openTools,
    setOpenTools,
    openReasoning,
    setOpenReasoning,
    editingId,
    editJson,
    setEditJson,
    setEditingId,
    beginEdit,
    approve,
  };
  const tokenText = c.tokens ? (c.tokens >= 1000 ? `${Math.round(c.tokens / 100) / 10}k` : String(c.tokens)) : "—";

  return (
    <div
      ref={rootRef}
      className={`skin-orbit relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-(--or-void) text-[13px] leading-[1.65] text-(--or-text) [font-family:var(--or-sans)]`}
    >
      {/* ── deep space: Three canvas / CSS stars / nebula ─────────────── */}
      <div
        className="or-sky pointer-events-none absolute inset-0 z-0 overflow-hidden [transform:translate3d(calc(var(--or-px,0)*-6px),calc(var(--or-py,0)*-6px),0)_rotateX(calc(var(--or-py,0)*-2deg))_rotateY(calc(var(--or-px,0)*2deg))_scale(1.06)]"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-(--or-void)" />
        <div className="absolute -top-1/3 left-[-15%] h-[70%] w-[70%] rounded-full bg-[radial-gradient(circle,rgba(113,84,255,0.26),transparent_62%)] blur-2xl" />
        <div className="absolute right-[-18%] bottom-[-22%] h-[74%] w-[74%] rounded-full bg-[radial-gradient(circle,rgba(54,220,205,0.15),transparent_64%)] blur-2xl" />
        <div className="absolute top-[28%] left-[38%] h-[52%] w-[52%] rounded-full bg-[radial-gradient(circle,rgba(74,126,255,0.13),transparent_66%)] blur-2xl" />
        <div
          className={`or-sky-fallback absolute inset-0 transition-opacity duration-1000 ${
            webglSky && sky === "ready" ? "opacity-0" : "opacity-100"
          }`}
        />
        {!reduced && (
          <Suspense fallback={null}>
            <Starfield onReady={() => setSky("ready")} onFail={() => setSky("failed")} />
          </Suspense>
        )}
      </div>

      {/* ── the room ─────────────────────────────────────────────────── */}
      <div className="or-shell relative z-10 flex h-full min-h-0 flex-col [transform:translate3d(calc(var(--or-px,0)*2px),calc(var(--or-py,0)*2px),0)]">
        <header className="or-hud flex min-h-[52px] flex-none items-center gap-3 border-b border-(--or-line) bg-[color-mix(in_srgb,var(--or-panel-solid)_76%,transparent)] px-4 py-2.5 backdrop-blur-md min-w-0 max-[720px]:px-3">
          <span className="relative flex h-8 w-8 flex-none items-center justify-center" aria-hidden="true">
            <span className="absolute inset-0 rounded-full border border-[color-mix(in_srgb,var(--or-violet)_55%,transparent)] [transform:rotateX(66deg)_rotateZ(-24deg)]" />
            <span className="absolute inset-[3px] rounded-full border border-[color-mix(in_srgb,var(--or-cyan)_45%,transparent)] [transform:rotateX(66deg)_rotateZ(38deg)]" />
            <span className="h-1.5 w-1.5 rounded-full bg-(--or-mint) shadow-[0_0_10px_var(--or-mint)]" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className={`${MONO} flex-none text-[9px] tracking-[0.3em] text-(--or-faint) uppercase`}>Orbit</span>
              <strong className="min-w-0 truncate text-[13px] font-semibold text-(--or-text)">
                {displayText(brand.agentName)}
              </strong>
            </div>
            <span className={`${MONO} block min-w-0 truncate text-[9.5px] tracking-[0.05em] text-(--or-faint)`}>
              {displayText(brand.modelLabel)} · {displayText(c.threadId)}
            </span>
          </div>

          <div className="ml-auto flex min-w-0 flex-none items-center gap-2">
            <span
              className={`or-status ${MONO} inline-flex whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[9px] tracking-[0.12em] uppercase ${STATUS_CHIP[c.status] ?? STATUS_CHIP.idle}`}
              data-status={c.status}
            >
              {statusLabel(c.status)}
            </span>
            {running && (
              <span className={`${MONO} hidden whitespace-nowrap text-[10px] text-(--or-dim) sm:inline`}>
                {clock(c.duration())}
              </span>
            )}
            <span className={`${MONO} hidden whitespace-nowrap rounded-full border border-(--or-line) bg-(--or-wash) px-2.5 py-[3px] text-[9px] tracking-[0.08em] text-(--or-dim) min-[520px]:inline`}>
              {tokenText} <span className="text-(--or-faint)">{t("chat.tokens")}</span>
            </span>
            <span className={`or-status-dot h-1.5 w-1.5 flex-none rounded-full ${STATUS_DOT[c.status] ?? STATUS_DOT.idle}`} aria-hidden="true" />
          </div>
        </header>

        <div className="or-main flex min-h-0 flex-1">
          <main
            ref={scroller}
            role="log"
            aria-live="polite"
            aria-label={zh ? "对话" : "Conversation"}
            className="or-log min-w-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 [scrollbar-width:thin] min-[720px]:px-6"
          >
            <div className="or-feed mx-auto w-full max-w-[820px] [perspective:1200px] [transform-style:preserve-3d]">
              {hidden > 0 && <HistoryMore hidden={hidden} onClick={showEarlier} />}
              {foldItems.map((item) => {
                if (item.type === "entry") return renderEntry(item.entry, ctx, false);
                const open = foldOverride[item.id] ?? foldGroupOpen(item.entries);
                const failures = foldGroupFailures(item.entries);
                const stats = foldGroupStats(item.entries);
                const failure = failures.includes("error")
                  ? "error"
                  : failures.includes("interrupted")
                  ? "interrupted"
                  : undefined;
                const preview = stats.toolNames.slice(0, 3).join(", ");
                const extra = stats.toolNames.length - 3;
                const live = foldGroupOpen(item.entries);
                return (
                  <div
                    key={item.id}
                    className={`${ROW} ${DEPTH.holo} mb-4`}
                    data-kind="fold"
                    data-depth="holo"
                    data-fold-id={item.id}
                  >
                    <div className="or-fold overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--or-violet)_24%,transparent)] bg-(--or-glass) shadow-[0_24px_60px_-38px_rgba(0,0,0,0.95)] backdrop-blur-md transition-[translate,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--or-violet)_42%,transparent)]">
                      <button
                        type="button"
                        className="or-fold-head relative flex w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden border-0 bg-transparent px-3 py-2.5 text-left [font-family:inherit] text-[11px] text-(--or-dim) hover:text-(--or-text)"
                        data-fold-head=""
                        aria-expanded={open}
                        onClick={() => setFoldOverride((prev) => ({ ...prev, [item.id]: !open }))}
                        onKeyDown={(event) => {
                          // explicit for the keydown contract test (jsdom runs no activation)
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setFoldOverride((prev) => ({ ...prev, [item.id]: !open }));
                          }
                        }}
                      >
                        <span
                          className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--or-violet)_22%,transparent),transparent)] opacity-40 animate-[or-scan_7s_linear_infinite] motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                        <Icon name="layers" size={12} className="text-(--or-violet)" />
                        <span className={`${MONO} flex-none text-[9px] tracking-[0.16em] uppercase`}>
                          {t("or.fold")}
                        </span>
                        <span className={`${MONO} min-w-0 truncate text-[10px] text-(--or-faint)`}>
                          {stats.reasoningCount > 0 && `${t("fold.thinking")} ×${stats.reasoningCount}`}
                          {stats.reasoningCount > 0 && stats.toolCount > 0 && " · "}
                          {preview}
                          {extra > 0 && ` +${extra} ${t("fold.more")}`}
                        </span>
                        {failure ? (
                          <span
                            className={`${MONO} ml-auto flex-none rounded-full px-1.5 py-[2px] text-[8.5px] tracking-[0.08em] uppercase ${FAILURE_FLAG[failure]}`}
                            data-failure={failure}
                          >
                            {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
                          </span>
                        ) : live ? (
                          <span className={`${MONO} ml-auto flex-none rounded-full bg-[color-mix(in_srgb,var(--or-cyan)_12%,transparent)] px-1.5 py-[2px] text-[8.5px] tracking-[0.08em] text-(--or-cyan) uppercase`}>
                            {t("chat.executing")}
                          </span>
                        ) : null}
                        <Icon
                          name="chevron"
                          size={11}
                          className={`ml-auto ${CHEV} ${open ? "rotate-90" : "rotate-0"}`}
                        />
                      </button>
                      {open && (
                        <div className="or-fold-body border-t border-(--or-line-soft) px-3 pb-3 pt-2.5">
                          {item.entries.map((entry) => (
                            <div key={entry.id} className="[transform-style:flat]">
                              {renderEntry(entry, ctx, true)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {!c.entries.length && <EmptyState zh={zh} />}
            </div>
          </main>

          <aside
            className="or-aside hidden w-[280px] flex-none overflow-y-auto border-l border-(--or-line) bg-[color-mix(in_srgb,var(--or-panel-solid)_42%,transparent)] px-3.5 pb-10 pt-4 backdrop-blur-sm [scrollbar-width:thin] [perspective:1200px] min-[1080px]:block"
            aria-label={t("or.telemetry")}
          >
            {!!metadataRows.length && (
              <TelemetryPanel title={t("or.metadata")}>
                <dl className="or-kv m-0 grid gap-1.5">
                  {metadataRows.slice(0, 8).map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className={`${MONO} truncate text-[8.5px] tracking-[0.1em] text-(--or-faint) uppercase`}>{displayText(key)}</dt>
                      <dd className="m-0 truncate text-[11px] text-(--or-dim)">
                        {typeof value === "object" ? safeJson(value, 0) : displayText(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </TelemetryPanel>
            )}

            <TelemetryPanel title={t("or.sharedState")}>
              {stateRows.length ? (
                <dl className="m-0 grid gap-1.5">
                  {stateRows.slice(0, 10).map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className={`${MONO} truncate text-[8.5px] tracking-[0.1em] text-(--or-faint) uppercase`}>{displayText(key)}</dt>
                      <dd className="m-0 truncate text-[11px] text-(--or-dim)">
                        {typeof value === "object" ? safeJson(value, 0) : displayText(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : !isEmptyState(c.sharedState) ? (
                <pre className={`${MONO} m-0 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-(--or-dim) [overflow-wrap:anywhere]`}>
                  {displayText(c.sharedState)}
                </pre>
              ) : (
                <p className="m-0 text-[11px] text-(--or-faint)">{t("or.stateEmpty")}</p>
              )}
              <p className={`${MONO} m-0 mt-2 text-[8.5px] tracking-[0.1em] text-(--or-faint)`}>v{c.stateVersion}</p>
            </TelemetryPanel>

            <TelemetryPanel title={t("or.capabilities")}>
              <div className="flex flex-wrap gap-1">
                {c.capabilities?.tools?.supported && <Capability label="tools" />}
                {c.capabilities?.reasoning?.supported && <Capability label="reasoning" />}
                {c.capabilities?.state?.supported && <Capability label="state" />}
                {c.capabilities?.humanInTheLoop?.supported && <Capability label="interrupts" />}
                {c.capabilities?.subagents?.supported && <Capability label="subagents" />}
                {!c.capabilities && <span className="text-[11px] text-(--or-faint)">—</span>}
              </div>
            </TelemetryPanel>

            <TelemetryPanel title={t("or.layers")}>
              <ul className="m-0 list-none space-y-1.5 p-0">
                <LayerRow label={t("or.layer.front")} z="+80" tone="text-(--or-amber)" />
                <LayerRow label={t("or.layer.core")} z="0" tone="text-(--or-text)" />
                <LayerRow label={t("or.layer.holo")} z="−40" tone="text-(--or-violet)" />
                <LayerRow label={t("or.layer.outer")} z="−120" tone="text-(--or-faint)" />
              </ul>
            </TelemetryPanel>
          </aside>
        </div>

        {/* ── composer tray: a surface tilted into the floor, content
               counter-rotated so the text faces the lens ─────────────── */}
        <footer className="or-dock-wrap relative z-20 flex-none px-4 pb-4 pt-2 [perspective:900px] min-[720px]:px-6">
          <div className="or-dock relative mx-auto w-full max-w-[820px] rounded-2xl border border-(--or-line) bg-[linear-gradient(180deg,color-mix(in_srgb,var(--or-panel-solid)_92%,transparent),color-mix(in_srgb,var(--or-deep)_96%,transparent))] shadow-[0_36px_60px_-38px_rgba(0,0,0,1),0_0_28px_-16px_color-mix(in_srgb,var(--or-violet)_70%,transparent)] [transform:rotateX(18deg)] [transform-origin:center_bottom] [transform-style:preserve-3d]">
            <div className="rounded-2xl px-3 pb-2.5 pt-2.5 [transform:rotateX(-18deg)] [transform-origin:center_bottom]">
              {!!c.suggestions.length && (
                <div className="or-suggestions mb-2 flex min-w-0 flex-wrap gap-1.5">
                  {c.suggestions.slice(0, 4).map((suggestion, index) => (
                    <button
                      key={`suggestion-${index}`}
                      type="button"
                      className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-(--or-line) bg-(--or-wash) px-2.5 py-1 text-[10.5px] text-(--or-dim) [font-family:inherit] transition-[background-color,border-color,color] hover:border-(--or-line-strong) hover:bg-(--or-hover) hover:text-(--or-text)"
                      onClick={() => setDraft(suggestion)}
                    >
                      <Icon name="sparkle" size={11} />
                      <span className="truncate">{suggestion}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="or-composer flex min-w-0 items-end gap-2 rounded-xl border border-(--or-line-soft) bg-[color-mix(in_srgb,var(--or-deep)_72%,transparent)] px-3 py-2 focus-within:border-[color-mix(in_srgb,var(--or-cyan)_48%,transparent)]">
                <span className={`${MONO} flex-none pb-0.5 text-[12px] text-(--or-cyan)`} aria-hidden="true">›</span>
                <textarea
                  rows={1}
                  value={draft}
                  aria-label={zh ? "消息输入框" : "Message composer"}
                  placeholder={pending.length ? t("or.composerPending") : t("or.composer")}
                  disabled={Boolean(pending.length)}
                  className="max-h-32 min-h-[22px] min-w-0 flex-1 resize-none border-0 bg-transparent py-0.5 text-[13px] leading-[1.55] text-(--or-text) outline-none placeholder:text-(--or-faint) [font-family:inherit] disabled:opacity-60"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                {running ? (
                  <button
                    type="button"
                    className="or-send flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border border-(--or-line-strong) bg-[color-mix(in_srgb,var(--or-red)_16%,transparent)] text-(--or-red) [font-family:inherit] transition-[filter,background-color] hover:brightness-125"
                    onClick={() => c.stop()}
                    aria-label={t("chat.stop")}
                  >
                    <Icon name="stop" size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="or-send flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-accent)_55%,transparent)] bg-(--or-accent) text-(--or-accent-fg) [font-family:inherit] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={send}
                    disabled={!draft.trim() || Boolean(pending.length)}
                    aria-label={t("chat.send")}
                  >
                    <Icon name="send" size={13} />
                  </button>
                )}
              </div>
              <p className={`${MONO} m-0 mt-1.5 flex items-center justify-between gap-3 text-[8.5px] tracking-[0.08em] text-(--or-faint) uppercase`}>
                <span>{t("or.hint")}</span>
                <span className="truncate">{displayText(brand.threadTitle) || displayText(c.runId)}</span>
              </p>
            </div>
          </div>
        </footer>
      </div>
      <ProtocolDrawer />
    </div>
  );
}

/* ── per-entry rendering ───────────────────────────────────────────── */

function renderEntry(entry: Entry, ctx: RenderCtx, nested: boolean) {
  switch (entry.kind) {
    case "user":
      return <UserRow key={entry.id} entry={entry} nested={nested} />;
    case "assistant":
      return <AssistantRow key={entry.id} entry={entry} nested={nested} />;
    case "reasoning":
      return <ReasoningRow key={entry.id} entry={entry} nested={nested} ctx={ctx} />;
    case "tool":
      return <ToolRow key={entry.id} entry={entry} nested={nested} ctx={ctx} />;
    case "plan":
      return <PlanRow key={entry.id} entry={entry} nested={nested} />;
    case "step":
      return <StepRow key={entry.id} entry={entry} nested={nested} />;
    case "subagent":
      return <SubagentRow key={entry.id} entry={entry} nested={nested} />;
    case "custom":
      return <CustomRow key={entry.id} entry={entry} nested={nested} plugins={ctx.plugins} />;
    case "interrupt":
      return <InterruptRow key={entry.id} entry={entry} nested={nested} ctx={ctx} />;
    case "error":
      return <ErrorRow key={entry.id} entry={entry} nested={nested} />;
    default:
      return null;
  }
}

function UserRow({ entry, nested }: { entry: { id: string; at: number; text: string }; nested: boolean }) {
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.far} mb-4 flex justify-end`}
      data-kind="user"
      data-depth={nested ? "nested" : "far"}
    >
      <div className="or-user max-w-[84%] min-w-0 rounded-[18px_18px_6px_18px] border border-[color-mix(in_srgb,var(--or-violet)_30%,transparent)] bg-[color-mix(in_srgb,var(--or-panel-solid)_88%,transparent)] px-4 py-2.5 shadow-[0_22px_54px_-34px_rgba(0,0,0,0.95)] backdrop-blur-sm">
        <div className={`${MONO} mb-1 flex items-center justify-end gap-2 text-[8.5px] tracking-[0.16em] text-(--or-faint) uppercase`}>
          <span>{t("or.you")}</span>
          <span>{timeOf(entry.at)}</span>
        </div>
        <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.7] text-(--or-user-text) [overflow-wrap:anywhere]">
          {displayText(entry.text)}
        </p>
      </div>
    </div>
  );
}

function AssistantRow({ entry, nested }: { entry: AssistantEntry; nested: boolean }) {
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.near} mb-4 flex items-start gap-3`}
      data-kind="assistant"
      data-depth={nested ? "nested" : "near"}
    >
      <span
        className="or-avatar mt-1.5 hidden h-7 w-7 flex-none items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-violet)_45%,transparent)] bg-[radial-gradient(circle_at_32%_30%,rgba(231,235,247,0.9),rgba(157,140,255,0.75)_45%,rgba(42,32,96,0.9))] shadow-[0_0_18px_color-mix(in_srgb,var(--or-violet)_55%,transparent)] sm:flex"
        aria-hidden="true"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-(--or-mint) shadow-[0_0_8px_var(--or-mint)]" />
      </span>
      <article className={`or-assistant min-w-0 flex-1 rounded-2xl border border-(--or-line) bg-(--or-panel) px-4 py-3 shadow-[0_20px_54px_-32px_rgba(0,0,0,0.95)] backdrop-blur-md animate-[or-rise_0.55s_ease-out_both] motion-reduce:animate-none ${HOVER_CARD}`}>
        <Markdown text={entry.text} className={`md or-md ${OR_MD}`} />
        {entry.streaming && (
          <span
            className="or-caret ml-0.5 inline-block h-3.5 w-1.5 translate-y-[2px] bg-(--or-accent) align-baseline animate-[or-blink_1s_steps(2,end)_infinite] motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        <span className={`${MONO} mt-2 block text-[9px] tracking-[0.1em] text-(--or-faint)`}>{timeOf(entry.at)}</span>
      </article>
    </div>
  );
}

function ReasoningRow({ entry, nested, ctx }: { entry: ReasoningEntry; nested: boolean; ctx: RenderCtx }) {
  const open = ctx.openReasoning[entry.id] ?? false;
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.holo} mb-3`}
      data-kind="reasoning"
      data-depth={nested ? "nested" : "holo"}
    >
      <div className="or-reason overflow-hidden rounded-xl border border-(--or-line-soft) bg-(--or-glass) backdrop-blur-sm transition-[translate,border-color] duration-300 hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--or-violet)_35%,transparent)]">
        <button
          type="button"
          className="or-reason-head flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left [font-family:inherit] text-[10.5px] text-(--or-dim) hover:text-(--or-text)"
          aria-expanded={open}
          onClick={() => ctx.setOpenReasoning((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
        >
          <Icon name="brain" size={12} className="text-(--or-violet)" />
          <span>{entry.streaming ? t("status.thinking") : t("chat.reasoning")}</span>
          <span className={`${MONO} text-[9px] text-(--or-faint)`}>{entry.tokens} {t("chat.tokens")}</span>
          {entry.encryptedValue && (
            <span className={`${MONO} rounded border border-[color-mix(in_srgb,var(--or-mint)_30%,transparent)] px-1 text-[8px] tracking-[0.08em] text-(--or-mint) uppercase`}>
              encrypted
            </span>
          )}
          <Icon name="chevron" size={10} className={`ml-auto ${CHEV} ${open ? "rotate-90" : "rotate-0"}`} />
        </button>
        {open && (
          <div className="or-reason-body border-t border-(--or-line-soft) px-3 py-2.5 text-[11.5px] leading-[1.7] text-(--or-dim)">
            {entry.text ? (
              <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{entry.text}</p>
            ) : (
              <p className="m-0 text-(--or-faint)">{t("or.encrypted")}</p>
            )}
            {entry.encryptedValue && (
              <pre className={`${MONO} mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-(--or-faint) [overflow-wrap:anywhere]`}>
                {entry.encryptedValue.slice(0, 160)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolRow({ entry, nested, ctx }: { entry: ToolEntry; nested: boolean; ctx: RenderCtx }) {
  const open = ctx.openTools[entry.id] ?? false;
  const stage = TOOL_STAGE[entry.status] ?? TOOL_STAGE.executing;
  const brief = (() => {
    if (!entry.args || typeof entry.args !== "object" || Array.isArray(entry.args)) return "";
    return Object.entries(entry.args as Record<string, unknown>)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .slice(0, 2)
      .map(([key, value]) => `${key}=${String(value).slice(0, 26)}`)
      .join(" · ");
  })();
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.holo} mb-3`}
      data-kind="tool"
      data-depth={nested ? "nested" : "holo"}
      data-status={entry.status}
    >
      <div className="or-tool overflow-hidden rounded-xl border border-(--or-line-soft) bg-(--or-glass) backdrop-blur-sm transition-[translate,border-color] duration-300 hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--or-violet)_35%,transparent)]">
        <button
          type="button"
          className="or-tool-head flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left [font-family:inherit] text-[10.5px] text-(--or-dim) hover:text-(--or-text)"
          aria-expanded={open}
          onClick={() => ctx.setOpenTools((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
        >
          <Icon name="wrench" size={12} className="text-(--or-cyan)" />
          <span className={`${MONO} flex-none text-[8.5px] tracking-[0.12em] text-(--or-faint) uppercase`}>{t("chat.tools")}</span>
          <span className={`${MONO} min-w-0 truncate text-[11px] text-(--or-text)`}>{displayText(entry.name)}</span>
          {brief && <span className={`${MONO} hidden min-w-0 truncate text-[9.5px] text-(--or-faint) sm:inline`}>{brief}</span>}
          <span className={`${MONO} ml-auto flex flex-none items-center gap-1 text-[9px] ${stage.tone}`}>
            <span className={`h-1 w-1 rounded-full ${stage.dot}`} aria-hidden="true" />
            {toolStageLabel(entry.status)}
          </span>
          {entry.durationMs ? (
            <span className={`${MONO} flex-none text-[9px] text-(--or-faint)`}>{formatDuration(entry.durationMs)}</span>
          ) : null}
          <Icon name="chevron" size={10} className={`${CHEV} ${open ? "rotate-90" : "rotate-0"}`} />
        </button>
        {open && (
          <div className="or-tool-body border-t border-(--or-line-soft) px-3 py-2.5">
            <pre className={`${MONO} m-0 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-(--or-line-soft) bg-(--or-deep) p-2.5 text-[10px] leading-[1.6] text-(--or-dim) [overflow-wrap:anywhere]`}>
              {displayText(entry.argsRaw) || safeJson(entry.args, 2)}
            </pre>
            <ToolResult entry={entry} variant="particle" />
          </div>
        )}
        {!open && entry.error && (
          <p className="or-error m-0 border-t border-[color-mix(in_srgb,var(--or-red)_22%,transparent)] px-3 py-1.5 text-[10.5px] text-(--or-red) [overflow-wrap:anywhere]">
            {displayText(entry.error)}
          </p>
        )}
        {!open && entry.status === "error" && !entry.error && (
          <p className="or-error m-0 border-t border-[color-mix(in_srgb,var(--or-red)_22%,transparent)] px-3 py-1.5 text-[10.5px] text-(--or-red)">
            {t("chat.failed")}
          </p>
        )}
      </div>
    </div>
  );
}

function PlanRow({ entry, nested }: { entry: PlanEntry; nested: boolean }) {
  const view = planView(entry);
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.plan} mb-4`}
      data-kind="plan"
      data-depth={nested ? "nested" : "plan"}
    >
      <div className="or-plan rounded-xl border border-[color-mix(in_srgb,var(--or-cyan)_22%,transparent)] bg-(--or-panel-soft) px-3.5 py-3 backdrop-blur-md transition-[translate,border-color] duration-300 hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--or-cyan)_38%,transparent)]">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <Icon name="layers" size={12} className="text-(--or-cyan)" />
          <span className={`${MONO} flex-none text-[8.5px] tracking-[0.14em] text-(--or-faint) uppercase`}>{t("or.plan")}</span>
          <span className="min-w-0 truncate text-[12px] font-medium text-(--or-text)">{displayText(entry.title)}</span>
          <span className={`${MONO} ml-auto flex-none rounded border border-(--or-line) px-1.5 py-[1px] text-[8px] tracking-[0.08em] text-(--or-dim) uppercase`}>
            {displayText(entry.activityType)}
          </span>
        </div>
        {view.rawOnly ? (
          <pre className={`${MONO} m-0 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-(--or-line-soft) bg-(--or-deep) p-2.5 text-[10px] leading-[1.6] text-(--or-dim) [overflow-wrap:anywhere]`}>
            {planRawText(view)}
          </pre>
        ) : view.steps.length === 0 ? (
          <p className="m-0 text-[11px] text-(--or-faint)">{t("or.planEmpty")}</p>
        ) : (
          <ol className="m-0 list-none space-y-1.5 p-0">
            {view.steps.map((step) => {
              const tone = PLAN_STEP[step.state] ?? PLAN_STEP.pending;
              return (
                <li key={step.id} className="flex min-w-0 items-center gap-2 text-[11.5px]" data-state={step.state}>
                  <span className={`h-2 w-2 flex-none rounded-full border ${tone.dot}`} aria-hidden="true" />
                  <span className={`min-w-0 [overflow-wrap:anywhere] ${tone.text}`}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function StepRow({ entry, nested }: { entry: StepEntry; nested: boolean }) {
  const tone = STEP_STATE[entry.status] ?? STEP_STATE.running;
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.telemetry} mb-2 flex items-center gap-2 px-1 text-[10.5px] text-(--or-dim)`}
      data-kind="step"
      data-depth={nested ? "nested" : "telemetry"}
      data-status={entry.status}
    >
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${tone.dot}`} aria-hidden="true" />
      <span className={`${MONO} flex-none text-[8.5px] tracking-[0.14em] text-(--or-faint) uppercase`}>{t("or.step")}</span>
      <span className="min-w-0 truncate">{displayText(entry.name)}</span>
      <span className={`${MONO} ml-auto flex-none text-[9px] ${tone.text}`}>{entry.status}</span>
    </div>
  );
}

function SubagentRow({ entry, nested }: { entry: SubagentEntry; nested: boolean }) {
  const tone = SUBAGENT_STATE[entry.status] ?? SUBAGENT_STATE.running;
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.telemetry} mb-2 flex min-w-0 items-center gap-2 px-1 text-[10.5px] text-(--or-dim)`}
      data-kind="subagent"
      data-depth={nested ? "nested" : "telemetry"}
      data-status={entry.status}
    >
      <Icon name="activity" size={11} className={tone.text} />
      <span className={`${MONO} flex-none text-[8.5px] tracking-[0.14em] text-(--or-faint) uppercase`}>{t("or.subagent")}</span>
      <span className="min-w-0 truncate">{displayText(entry.name)}</span>
      {entry.detail && <span className="min-w-0 truncate text-(--or-faint)">{displayText(entry.detail)}</span>}
      <span className={`${MONO} ml-auto flex-none text-[9px] ${tone.text}`}>{entry.status}</span>
    </div>
  );
}

function CustomRow({ entry, nested, plugins }: { entry: CustomEntry; nested: boolean; plugins: SkinPlugins }) {
  if (entry.display === "debug") return null;
  const plugin = plugins.custom?.(entry);
  if (plugin) {
    return (
      <div
        className={`${ROW} ${nested ? "" : DEPTH.telemetry} or-custom mb-3 rounded-xl border border-(--or-line-soft) bg-(--or-glass) px-3 py-2 backdrop-blur-sm`}
        data-kind="custom"
        data-depth={nested ? "nested" : "telemetry"}
      >
        {plugin}
      </div>
    );
  }
  const kind =
    entry.value === null
      ? "null"
      : Array.isArray(entry.value)
      ? `array[${entry.value.length}]`
      : typeof entry.value === "object"
      ? "object"
      : typeof entry.value;
  return (
    <details
      className={`${ROW} ${nested ? "" : DEPTH.telemetry} or-custom group mb-3 overflow-hidden rounded-xl border border-(--or-line-soft) bg-(--or-glass) backdrop-blur-sm open:border-(--or-line)`}
      data-kind="custom"
      data-depth={nested ? "nested" : "telemetry"}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10.5px] text-(--or-dim) [&::-webkit-details-marker]:hidden">
        <span className={`${MONO} flex-none rounded border border-[color-mix(in_srgb,var(--or-mint)_30%,transparent)] px-1.5 py-[1px] text-[8.5px] tracking-[0.08em] text-(--or-mint) uppercase`}>
          {displayText(entry.name)}
        </span>
        <span className={`${MONO} flex-none text-[9px] text-(--or-faint)`}>{t("or.custom")} · {kind}</span>
        <Icon name="chevron" size={10} className={`ml-auto ${CHEV} group-open:rotate-90`} />
      </summary>
      <pre className={`${MONO} m-0 max-h-60 overflow-auto whitespace-pre-wrap border-t border-(--or-line-soft) bg-(--or-deep) p-2.5 text-[10px] leading-[1.6] text-(--or-dim) [overflow-wrap:anywhere]`}>
        {safeJson(entry.value, 2)}
      </pre>
    </details>
  );
}

function InterruptRow({ entry, nested, ctx }: { entry: InterruptEntry; nested: boolean; ctx: RenderCtx }) {
  const pending = entry.status === "pending" && !entry.expired;
  const state = entry.expired ? "expired" : pending ? "pending" : entry.status;
  const tone = APPROVAL_STATE[state] ?? APPROVAL_STATE.pending;
  const editing = ctx.editingId === entry.id;
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.front} mb-5`}
      data-kind="interrupt"
      data-depth={nested ? "nested" : "front"}
      data-state={state}
    >
      <div
        className={`or-approval relative overflow-hidden rounded-2xl border px-4 py-3.5 backdrop-blur-lg transition-[translate,box-shadow,filter] duration-300 hover:-translate-y-2 focus-within:brightness-110 ${tone.card}`}
        data-state={state}
      >
        <div className="mb-1.5 flex min-w-0 items-center gap-2">
          <Icon name={entry.expired ? "clock" : "shield"} size={14} className={tone.icon} />
          <span className={`${MONO} text-[9px] tracking-[0.16em] uppercase ${tone.icon}`}>{approvalLabel(state)}</span>
          {entry.expiresAt && (
            <span className={`${MONO} ml-auto flex-none text-[9px] text-(--or-faint)`}>
              {new Date(entry.expiresAt).toLocaleTimeString()}
            </span>
          )}
          {!entry.expiresAt && !pending && (
            <span className={`${MONO} ml-auto flex-none text-[9px] text-(--or-faint)`}>{entry.reason}</span>
          )}
        </div>
        <p className="or-approval-msg m-0 text-[13px] leading-[1.65] text-(--or-text) [overflow-wrap:anywhere]">
          {displayText(entry.message)}
        </p>
        {entry.description && (
          <p className="m-0 mt-1 text-[11px] leading-[1.6] text-(--or-dim) [overflow-wrap:anywhere]">
            {displayText(entry.description)}
          </p>
        )}
        {!!entry.details.length && (
          <dl className="m-0 mt-2.5 grid gap-1.5 border-t border-(--or-line-soft) pt-2.5">
            {entry.details.map((detail, index) => (
              <div key={`detail-${index}`} className="flex min-w-0 items-baseline gap-2 text-[11px]">
                <dt className={`${MONO} flex-none text-[8.5px] tracking-[0.1em] text-(--or-faint) uppercase`}>{displayText(detail.label)}</dt>
                <dd className="m-0 min-w-0 text-(--or-dim) [overflow-wrap:anywhere]">{displayText(detail.value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {entry.responseSchema && (
          <pre className={`${MONO} m-0 mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-(--or-line-soft) bg-(--or-deep) p-2.5 text-[10px] leading-[1.6] text-(--or-faint) [overflow-wrap:anywhere]`}>
            {safeJson(entry.responseSchema, 2)}
          </pre>
        )}
        {pending && (
          <>
            {editing && (
              <textarea
                className={`${MONO} mt-2.5 min-h-[110px] w-full resize-y rounded-lg border border-[color-mix(in_srgb,var(--or-cyan)_38%,transparent)] bg-(--or-deep) p-2.5 text-[11px] leading-[1.55] text-(--or-text)`}
                aria-label={ctx.zh ? "编辑参数" : "Edit arguments"}
                value={ctx.editJson[entry.id] ?? ""}
                onChange={(event) =>
                  ctx.setEditJson((prev) => ({ ...prev, [entry.id]: event.target.value }))
                }
                spellCheck={false}
              />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="or-btn inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--or-amber)_55%,transparent)] bg-(--or-amber) px-3.5 py-1.5 text-[11px] font-medium text-(--or-void) [font-family:inherit] transition-[filter] hover:brightness-110"
                onClick={() => ctx.approve(entry, true, editing)}
              >
                <Icon name="check" size={12} />
                {editing ? t("intr.approveEdited") : t("intr.approve")}
              </button>
              <button
                type="button"
                className="or-btn inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--or-red)_42%,transparent)] bg-transparent px-3.5 py-1.5 text-[11px] text-(--or-red) [font-family:inherit] transition-[background-color] hover:bg-[color-mix(in_srgb,var(--or-red)_12%,transparent)]"
                onClick={() => ctx.approve(entry, false, false)}
              >
                <Icon name="x" size={12} />
                {t("intr.deny")}
              </button>
              <button
                type="button"
                className="or-btn inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-(--or-line) bg-(--or-wash) px-3.5 py-1.5 text-[11px] text-(--or-dim) [font-family:inherit] transition-[background-color,color] hover:bg-(--or-hover) hover:text-(--or-text)"
                onClick={() => (editing ? ctx.setEditingId(null) : ctx.beginEdit(entry.id))}
              >
                <Icon name="braces" size={12} />
                {editing ? t("intr.cancel") : t("intr.edit")}
              </button>
            </div>
          </>
        )}
        {!pending && state !== "expired" && (
          <p className={`${MONO} m-0 mt-2 text-[9px] tracking-[0.08em] text-(--or-faint) uppercase`} role="status">
            {entry.status === "approved" ? t("intr.approvedBy") : t("intr.deniedBy")}
          </p>
        )}
      </div>
    </div>
  );
}

function ErrorRow({ entry, nested }: { entry: ErrorEntry; nested: boolean }) {
  return (
    <div
      className={`${ROW} ${nested ? "" : DEPTH.alert} mb-4`}
      data-kind="error"
      data-depth={nested ? "nested" : "alert"}
    >
      <div
        className="or-error-row flex min-w-0 items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--or-red)_42%,transparent)] bg-[color-mix(in_srgb,var(--or-red)_9%,var(--or-panel))] px-3 py-2.5 text-[11.5px] text-(--or-red) shadow-[0_0_30px_-14px_color-mix(in_srgb,var(--or-red)_70%,transparent)]"
        role="alert"
      >
        <Icon name="x" size={12} className="mt-0.5 flex-none" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{displayText(entry.message)}</span>
      </div>
    </div>
  );
}

function EmptyState({ zh }: { zh: boolean }) {
  return (
    <div
      className="or-empty relative mx-auto mt-10 max-w-[440px] text-center [transform:translateZ(8px)] min-[720px]:mt-20"
      data-kind="empty"
      data-depth="near"
    >
      <div className="relative mx-auto mb-7 h-28 w-28" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border border-[color-mix(in_srgb,var(--or-violet)_35%,transparent)] [transform:rotateX(68deg)]" />
        <span className="absolute inset-4 rounded-full border border-[color-mix(in_srgb,var(--or-cyan)_30%,transparent)] [transform:rotateX(68deg)_rotateZ(24deg)]" />
        <span className="absolute inset-8 rounded-full border border-(--or-line) [transform:rotateX(68deg)_rotateZ(-18deg)]" />
        <span className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--or-mint) shadow-[0_0_22px_var(--or-mint)]" />
        <span className="absolute top-[18%] left-[74%] h-1.5 w-1.5 rounded-full bg-(--or-cyan) shadow-[0_0_10px_var(--or-cyan)]" />
      </div>
      <p className="m-0 text-[15px] font-medium text-(--or-text)">{t("or.emptyTitle")}</p>
      <p className="m-0 mt-2 text-[12px] leading-[1.7] text-(--or-dim)">{t("or.emptySub")}</p>
      <p className={`${MONO} m-0 mt-4 text-[8.5px] tracking-[0.16em] text-(--or-faint) uppercase`}>
        {zh ? "外层 · 全息 · 核心" : "outer · holo · core"}
      </p>
    </div>
  );
}

function TelemetryPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="or-panel mb-3 rounded-xl border border-(--or-line-soft) bg-(--or-panel-soft) px-3 py-2.5 backdrop-blur-sm [transform:translateZ(-40px)]" data-depth="telemetry">
      <h3 className={`${MONO} m-0 mb-2 text-[8.5px] font-normal tracking-[0.16em] text-(--or-faint) uppercase`}>{title}</h3>
      {children}
    </section>
  );
}

function Capability({ label }: { label: string }) {
  return (
    <span className={`${MONO} whitespace-nowrap rounded-full border border-(--or-line) bg-(--or-wash) px-1.5 py-[1px] text-[8.5px] tracking-[0.06em] text-(--or-dim)`}>
      {label}
    </span>
  );
}

function LayerRow({ label, z, tone }: { label: string; z: string; tone: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span className={`${MONO} min-w-0 flex-1 truncate text-[9.5px] ${tone}`}>{label}</span>
      <span className={`${MONO} flex-none text-[8.5px] text-(--or-faint)`}>z {z}</span>
    </li>
  );
}

export default {
  id: "orbit",
  name: "Orbit",
  tagline: "Deep space · real depth",
  swatch: ["#05060a", "#0a0f1e", "#9d8cff"] as [string, string, string],
  ChatPage: OrbitPage,
};
