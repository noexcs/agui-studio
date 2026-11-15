import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useConversation, useSkinBranding, useSkinLang, useSkinTuning } from "../../host";
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
  UserEntry,
} from "../../contract";
import { t } from "../../i18n";
import { useVisibleEntries } from "../../shared/history";
import {
  conversationGroups,
  foldGroupFailures,
  foldGroupOpen,
  foldGroupStats,
  type ConversationItem,
} from "../../shared/conversationGroups";
import { pendingInterrupts } from "../../shared/interrupts";
import { displayText, entriesOf, isEmptyState, safeJson } from "../../shared/safe";
import { planRawText, planView } from "../../shared/plan";
import { Icon } from "../../shared/Icon";
import {
  approvalLabel,
  approvalState,
  buildSceneModel,
  planStateLabel,
  sceneActions,
  statusLabel,
  stepStatusLabel,
  subagentStatusLabel,
  toolStatusLabel,
  type SceneAction,
  type SceneModel,
} from "./sceneModel";
import "./orbit.css";

/* ═══ Orbit v2 — a conversation that exists only in 3D ═══════════════
   The transcript is a tunnel: every entry becomes a troika-three-text
   station in a WebGL scene (camera dollies along Z; new text materializes
   out of the void). The page leaves exactly three DOM roles:

     1. the composer — the Chinese IME makes a real <textarea> mandatory;
     2. an sr-only transcript mirror — screen readers, protocol tests and
        the "show earlier" / fold controls keep a semantic DOM path;
     3. transparent proxy buttons projected over the 3D approval and
        suggestion meshes — keyboard focus and a focus ring that cannot be
        clipped by the WebGL canvas.

   When WebGL is unavailable (or the lazy scene fails) the same transcript
   renders as a readable DOM list: that is the only 2D content path and it
   exists purely as a fallback. */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** string-keyed view of t() for the scene model (which cannot import the
    closed dictionary union without depending on the skin package layout). */
const tr = (key: string): string => t(key as never);

const OrbitScene = lazy(() => import("./OrbitScene"));

const STATUS_TONE = {
  idle: "faint",
  running: "cyan",
  interrupted: "amber",
  done: "green",
  error: "red",
  stopped: "dim",
} as const;

const DEFAULT_ACCENT = "#9d8cff";

function initialReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_QUERY).matches
      : false;
  } catch {
    return false;
  }
}

/** Probe WebGL once before loading the lazy three/troika chunk. Browsers
    with WebGL disabled never download the scene at all. */
function detectWebGL(): boolean {
  try {
    if (typeof document === "undefined") return false;
    if (typeof WebGLRenderingContext === "undefined" && typeof WebGL2RenderingContext === "undefined") {
      return false;
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return false;
    const lose = (context as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function safeAccent(value: string | undefined): string {
  const candidate = (value ?? "").trim();
  if (!candidate) return DEFAULT_ACCENT;
  if (/^#[0-9a-f]{3,8}$/i.test(candidate)) return candidate;
  if (/^(rgb|hsl)a?\(/i.test(candidate)) return candidate;
  return DEFAULT_ACCENT;
}

class SceneBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Anything that is not the composer / a focus proxy stays out of the
    visible 2D layer — this class is the sr-only mirror. */
function srOnly(className: string): string {
  return `sr-only ${className}`;
}

export function OrbitPage() {
  const c = useConversation();
  const brand = useSkinBranding();
  const lang = useSkinLang();
  const tuning = useSkinTuning();
  const zh = lang === "zh";
  const { visible, hidden, showEarlier } = useVisibleEntries(c.entries);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const proxyRoot = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const [draft, setDraft] = useState("");
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const [reduced, setReduced] = useState(initialReducedMotion);
  const [webgl] = useState(detectWebGL);
  const [sceneStatus, setSceneStatus] = useState<"loading" | "ready" | "failed">(
    webgl ? "loading" : "failed"
  );
  const [accent, setAccent] = useState(DEFAULT_ACCENT);

  const running = c.status === "running";
  const pending = pendingInterrupts(c.entries);
  const version = c.getVersion();

  const model: SceneModel = useMemo(
    () =>
      buildSceneModel(visible, {
        tr,
        sharedState: c.sharedState,
        stateVersion: c.stateVersion,
        suggestions: c.suggestions,
        metadata: c.metadata,
        brand: {
          agentName: brand.agentName,
          modelLabel: brand.modelLabel,
          threadId: c.threadId,
        },
      }),
    // store entries are mutated in place; the version is the append signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, lang, brand.agentName, brand.modelLabel, c.threadId, c.stateVersion, c.suggestions]
  );

  const actions = useMemo(() => sceneActions(model), [model]);

  const tokenText = c.tokens
    ? c.tokens >= 1000
      ? `${Math.round(c.tokens / 100) / 10}k`
      : String(c.tokens)
    : "—";

  const hud = useMemo(
    () => ({
      title: `ORBIT · ${displayText(brand.agentName)}`,
      line: [displayText(brand.modelLabel), displayText(c.threadId)].filter(Boolean).join(" · "),
      status: statusLabel(c.status, tr),
      tokens: `${tokenText} ${t("chat.tokens")}`,
      statusTone: STATUS_TONE[c.status] ?? "faint",
    }),
    [brand.agentName, brand.modelLabel, c.threadId, c.status, tokenText, lang]
  );

  // Runtime preference changes: the handler flips the loading state *before*
  // the remount, so the new motion mode never shows the previous canvas as
  // ready. (An effect here would run after the child's onReady and re-stick
  // the page on "loading".)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_QUERY);
    const onChange = () => {
      if (webgl) setSceneStatus("loading");
      setReduced(query.matches);
    };
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [webgl]);

  // Resolve the host accent from the skin root once the provider has written
  // the tuning variables (custom properties are inherited).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const style = getComputedStyle(root);
    const direct = style.getPropertyValue("--sk-accent").trim();
    const guarded = style.getPropertyValue("--sk-accent-on-dark").trim();
    setAccent(safeAccent(direct || guarded));
  }, [tuning.accent, tuning.theme]);

  useEffect(() => {
    if (!pending.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) {
        return;
      }
      const first = pending[0];
      if (event.key.toLowerCase() === "y") c.resolveInterrupt(true, undefined, first.id);
      if (event.key.toLowerCase() === "n") c.resolveInterrupt(false, undefined, first.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending.map((entry) => entry.id).join(","), c]);

  // keep the hidden/visible transcript scrollable bottom pinned in fallback
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [version, sceneStatus]);

  function send() {
    const text = draft.trim();
    if (!text || running || pending.length) return;
    setDraft("");
    c.send(text);
  }

  const onAction = useCallback(
    (action: SceneAction) => {
      if (action.kind === "approve") {
        c.resolveInterrupt(true, undefined, action.entryId);
      } else if (action.kind === "deny") {
        c.resolveInterrupt(false, undefined, action.entryId);
      } else if (action.kind === "suggestion") {
        setDraft(action.text ?? "");
      }
    },
    [c]
  );

  const fallback = !webgl || sceneStatus === "failed";
  const sceneKey = reduced ? "reduced" : "motion";

  return (
    <div
      ref={rootRef}
      className="skin-orbit relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-(--or-void) text-[13px] leading-[1.65] text-(--or-text) [font-family:var(--or-sans)]"
      data-scene={fallback ? "fallback" : sceneStatus}
      data-reduced={reduced ? "1" : "0"}
    >
      {/* Deep-space CSS wash: visible while the chunk loads, and the readable
          backdrop whenever WebGL is unavailable. Never the primary visual. */}
      <div
        className="or-sky absolute inset-0 z-0 overflow-hidden"
        data-state={fallback ? "fallback" : sceneStatus}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-(--or-void)" />
        <div className="or-sky-fallback absolute inset-0" />
      </div>

      {/* The one and only WebGL scene. */}
      {!fallback && (
        <SceneBoundary key={sceneKey} onFail={() => setSceneStatus("failed")}>
          <Suspense fallback={null}>
            <OrbitScene
              key={sceneKey}
              model={model}
              reduced={reduced}
              accent={accent}
              proxyRoot={proxyRoot}
              hud={hud}
              onReady={() => setSceneStatus("ready")}
              onFail={() => setSceneStatus("failed")}
              onAction={onAction}
            />
          </Suspense>
        </SceneBoundary>
      )}

      {fallback ? (
        <main
          ref={bodyRef}
          role="log"
          aria-live="polite"
          aria-label={zh ? "对话" : "Conversation"}
          className="or-fallback relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-40 pt-8 [scrollbar-width:thin] min-[720px]:px-8"
        >
          <div className="mx-auto w-full max-w-[760px]">
            <Transcript
              mode="fallback"
              conversation={c}
              visible={visible}
              hidden={hidden}
              showEarlier={showEarlier}
              foldOverride={foldOverride}
              setFoldOverride={setFoldOverride}
              tokenText={tokenText}
              zh={zh}
              agentName={displayText(brand.agentName)}
              modelLabel={displayText(brand.modelLabel)}
              onApprove={(entry, approved) => c.resolveInterrupt(approved, undefined, entry.id)}
            />
          </div>
        </main>
      ) : (
        <div className={srOnly("or-a11y")} role="log" aria-live="polite" aria-label={zh ? "对话" : "Conversation"}>
          <Transcript
            mode="a11y"
            conversation={c}
            visible={visible}
            hidden={hidden}
            showEarlier={showEarlier}
            foldOverride={foldOverride}
            setFoldOverride={setFoldOverride}
            tokenText={tokenText}
            zh={zh}
            agentName={displayText(brand.agentName)}
            modelLabel={displayText(brand.modelLabel)}
            onApprove={(entry, approved) => c.resolveInterrupt(approved, undefined, entry.id)}
          />
        </div>
      )}

      {/* Transparent keyboard/focus proxies, positioned every frame by the
          scene at the projected 3D control rectangle. They exist from the
          first commit (the scene collects them on mount); CSS hides them
          until the scene reports ready. */}
      {!fallback && actions.length > 0 && (
        <div ref={proxyRoot} className="or-proxy-layer pointer-events-none absolute inset-0 z-20">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              data-scene-action={action.id}
              className="or-proxy"
              aria-label={action.ariaLabel}
              onClick={() => onAction(action)}
              onKeyDown={(event) => {
                // explicit activation: the proxies are the keyboard contract
                // for 3D controls in every environment (incl. jsdom)
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onAction(action);
                }
              }}
            >
              <span className="sr-only">{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* The only visible DOM surface: the Chinese-IME composer, drawn as a
          holographic light bar. */}
      <footer className="or-dock-wrap pointer-events-none absolute inset-x-0 bottom-0 z-30 flex-none px-4 pb-5 pt-2 min-[720px]:px-8">
        <div className="or-dock pointer-events-auto mx-auto w-full max-w-[760px]">
          {fallback && !!c.suggestions.length && (
            <div className="or-suggestions mb-2 flex min-w-0 flex-wrap gap-1.5">
              {c.suggestions.slice(0, 4).map((suggestion, index) => (
                <button
                  key={`suggestion-${index}`}
                  type="button"
                  className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-(--or-line) bg-(--or-glass) px-2.5 py-1 text-[10.5px] text-(--or-dim) [font-family:inherit] transition-[border-color,color] hover:border-(--or-line-strong) hover:text-(--or-text)"
                  onClick={() => setDraft(suggestion)}
                >
                  <Icon name="sparkle" size={11} />
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
            </div>
          )}
          <div className="or-composer flex min-w-0 items-end gap-2 border border-(--or-line-strong) bg-(--or-glass) px-3 py-2">
            <span className={`${MONO} flex-none pb-0.5 text-[12px] text-(--or-cyan)`} aria-hidden="true">
              ›
            </span>
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
                className="or-send flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border border-(--or-red) bg-[color-mix(in_srgb,var(--or-red)_14%,transparent)] text-(--or-red) [font-family:inherit] transition-[filter] hover:brightness-125"
                onClick={() => c.stop()}
                aria-label={t("chat.stop")}
              >
                <Icon name="stop" size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="or-send flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--or-accent)_60%,transparent)] bg-(--or-accent) text-(--or-accent-fg) [font-family:inherit] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
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
      </footer>
    </div>
  );
}

/* ── semantic transcript (sr-only mirror + no-WebGL fallback) ───────── */

const MONO = "font-(family-name:--or-mono)";

function Transcript(props: {
  mode: "a11y" | "fallback";
  conversation: ReturnType<typeof useConversation>;
  visible: Entry[];
  hidden: number;
  showEarlier: () => void;
  foldOverride: Record<string, boolean>;
  setFoldOverride: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  tokenText: string;
  zh: boolean;
  agentName: string;
  modelLabel: string;
  onApprove: (entry: InterruptEntry, approved: boolean) => void;
}) {
  const {
    mode,
    conversation: c,
    visible,
    hidden,
    showEarlier,
    foldOverride,
    setFoldOverride,
    tokenText,
    zh,
    agentName,
    modelLabel,
    onApprove,
  } = props;
  const groups = useMemo(() => conversationGroups(visible), [visible]);
  const visibleMode = mode === "fallback";
  const entryClass = (kind: string) => (visibleMode ? "or-entry mb-4" : "or-entry");

  return (
    <>
      <header className="or-hud" data-status={c.status}>
        <p className={`${MONO} m-0 text-[9px] tracking-[0.3em] text-(--or-faint) uppercase`}>Orbit</p>
        <strong className="block text-[13px] text-(--or-text)">{agentName}</strong>
        <p className={`${MONO} m-0 text-[9.5px] tracking-[0.05em] text-(--or-faint)`}>
          {[modelLabel, displayText(c.threadId)].filter(Boolean).join(" · ")}
        </p>
        <span className="or-status" data-status={c.status}>
          {statusLabel(c.status, tr)}
        </span>
        <span className={`${MONO} text-[9px] text-(--or-dim)`}>
          {tokenText} {t("chat.tokens")}
        </span>
      </header>

      {hidden > 0 && (
        <button
          type="button"
          className="or-earlier"
          tabIndex={visibleMode ? 0 : -1}
          onClick={showEarlier}
        >
          {t("history.more")} · {hidden}
        </button>
      )}

      {groups.map((item) =>
        item.type === "group" ? (
          <FoldGroup
            key={item.id}
            item={item}
            mode={mode}
            open={foldOverride[item.id] ?? foldGroupOpen(item.entries)}
            onToggle={() => setFoldOverride((prev) => ({ ...prev, [item.id]: !(prev[item.id] ?? false) }))}
            entryClass={entryClass}
            onApprove={onApprove}
          />
        ) : (
          <EntryText
            key={item.entry.id}
            entry={item.entry}
            mode={mode}
            className={entryClass(item.entry.kind)}
            onApprove={onApprove}
          />
        )
      )}

      {!visible.length && (
        <div className="or-empty" data-kind="empty">
          <p className="m-0 text-[15px] text-(--or-text)">{t("or.emptyTitle")}</p>
          <p className="m-0 mt-2 text-[12px] text-(--or-dim)">{t("or.emptySub")}</p>
          <p className={`${MONO} m-0 mt-4 text-[8.5px] tracking-[0.16em] text-(--or-faint) uppercase`}>
            {t("or.emptyHint")}
          </p>
        </div>
      )}

      <StateBlock conversation={c} visibleMode={visibleMode} />
    </>
  );
}

/** Brand name is not on SkinConversation; branding lives in the host and is
    passed into Transcript by OrbitPage. */
function FoldGroup(props: {
  item: Extract<ConversationItem, { type: "group" }>;
  mode: "a11y" | "fallback";
  open: boolean;
  onToggle: () => void;
  entryClass: (kind: string) => string;
  onApprove: (entry: InterruptEntry, approved: boolean) => void;
}) {
  const { item, mode, open, onToggle, entryClass, onApprove } = props;
  const stats = foldGroupStats(item.entries);
  const failures = foldGroupFailures(item.entries);
  const failure = failures.includes("error")
    ? "error"
    : failures.includes("interrupted")
      ? "interrupted"
      : null;
  return (
    <section data-kind="fold" data-fold-id={item.id} className="or-fold-section">
      <button
        type="button"
        data-fold-head=""
        aria-expanded={open}
        tabIndex={mode === "fallback" ? 0 : -1}
        className="or-fold-head w-full text-left"
        onClick={onToggle}
        onKeyDown={(event) => {
          // explicit for the keyboard contract (jsdom runs no activation)
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        {t("or.fold")} · {t("fold.thinking")} ×{stats.reasoningCount} · {t("chat.tools")} ×{stats.toolCount}
        {stats.toolNames.length ? ` · ${stats.toolNames.join(", ")}` : ""}
        {failure ? (
          <span data-failure={failure}>
            {" "}
            · {failure === "error" ? t("fold.hasFailures") : t("chat.interrupted")}
          </span>
        ) : null}
      </button>
      <div className="or-fold-body">
        {item.entries.map((entry) => (
          <EntryText
            key={entry.id}
            entry={entry}
            mode={mode}
            className={entryClass(entry.kind)}
            onApprove={onApprove}
          />
        ))}
      </div>
    </section>
  );
}

function EntryText(props: {
  entry: Entry;
  mode: "a11y" | "fallback";
  className: string;
  onApprove: (entry: InterruptEntry, approved: boolean) => void;
}) {
  const { entry, mode, className, onApprove } = props;
  const visible = mode === "fallback";
  switch (entry.kind) {
    case "user":
      return <UserText entry={entry} className={className} visible={visible} />;
    case "assistant":
      return <AssistantText entry={entry} className={className} visible={visible} />;
    case "reasoning":
      return <ReasoningText entry={entry} className={className} />;
    case "tool":
      return <ToolText entry={entry} className={className} />;
    case "plan":
      return <PlanText entry={entry} className={className} />;
    case "step":
      return <StepText entry={entry} className={className} />;
    case "subagent":
      return <SubagentText entry={entry} className={className} />;
    case "custom":
      return <CustomText entry={entry} className={className} />;
    case "error":
      return <ErrorText entry={entry} className={className} />;
    case "interrupt":
      return <InterruptText entry={entry} className={className} visible={visible} onApprove={onApprove} />;
    default:
      return null;
  }
}

function UserText({ entry, className, visible }: { entry: UserEntry; className: string; visible: boolean }) {
  return (
    <article className={`${className} or-user`} data-kind="user">
      <p className={`${MONO} m-0 text-[8.5px] tracking-[0.16em] text-(--or-faint) uppercase`}>{t("or.you")}</p>
      <p className="m-0 whitespace-pre-wrap text-[13px] text-(--or-user-text) [overflow-wrap:anywhere]">
        {displayText(entry.text)}
      </p>
      {visible && (
        <span className={`${MONO} block text-[9px] text-(--or-faint)`}>
          {new Date(entry.at).toLocaleTimeString()}
        </span>
      )}
    </article>
  );
}

function AssistantText({
  entry,
  className,
  visible,
}: {
  entry: AssistantEntry;
  className: string;
  visible: boolean;
}) {
  return (
    <article
      className={`${className} or-assistant`}
      data-kind="assistant"
      data-streaming={entry.streaming ? "1" : "0"}
    >
      <p className={`${MONO} m-0 text-[8.5px] tracking-[0.16em] text-(--or-faint) uppercase`}>
        {entry.streaming ? t("status.writing") : t("or.assistant")}
      </p>
      <p className="m-0 whitespace-pre-wrap text-[13px] text-(--or-text) [overflow-wrap:anywhere]">
        {displayText(entry.text)}
      </p>
      {visible && entry.streaming && (
        <span className="or-caret" aria-hidden="true">
          ▌
        </span>
      )}
    </article>
  );
}

function ReasoningText({ entry, className }: { entry: ReasoningEntry; className: string }) {
  return (
    <article className={`${className} or-reason`} data-kind="reasoning" data-streaming={entry.streaming ? "1" : "0"}>
      <p className={`${MONO} m-0 text-[9px] tracking-[0.12em] text-(--or-violet) uppercase`}>
        {entry.streaming ? t("status.thinking") : t("chat.reasoning")} · {entry.tokens} {t("chat.tokens")}
      </p>
      <p className="m-0 text-[12px] text-(--or-dim) [overflow-wrap:anywhere]">
        {displayText(entry.text) || t("or.encrypted")}
      </p>
    </article>
  );
}

function ToolText({ entry, className }: { entry: ToolEntry; className: string }) {
  return (
    <article className={`${className} or-tool`} data-kind="tool" data-status={entry.status}>
      <p className="m-0 text-[12px] text-(--or-text)">
        {t("chat.tools")} · {displayText(entry.name)} · {toolStatusLabel(entry.status, tr)}
      </p>
      {entry.argsRaw && (
        <pre className={`${MONO} m-0 max-h-40 overflow-auto text-[10px] whitespace-pre-wrap text-(--or-dim) [overflow-wrap:anywhere]`}>
          {displayText(entry.argsRaw)}
        </pre>
      )}
      {entry.error && <p className="m-0 text-[11px] text-(--or-red) [overflow-wrap:anywhere]">{displayText(entry.error)}</p>}
      {entry.status === "error" && !entry.error && (
        <p className="m-0 text-[11px] text-(--or-red)">{t("chat.failed")}</p>
      )}
      {entry.result !== undefined && (
        <p className={`${MONO} m-0 text-[10px] text-(--or-faint) [overflow-wrap:anywhere]`}>
          {displayText(entry.result).slice(0, 400)}
        </p>
      )}
    </article>
  );
}

function PlanText({ entry, className }: { entry: PlanEntry; className: string }) {
  const view = planView(entry);
  return (
    <section className={`${className} or-plan`} data-kind="plan">
      <p className="m-0 text-[12px] text-(--or-cyan)">
        {t("or.plan")} · {displayText(entry.title)}
      </p>
      {view.rawOnly ? (
        <pre className={`${MONO} m-0 whitespace-pre-wrap text-[10px] text-(--or-dim) [overflow-wrap:anywhere]`}>
          {planRawText(view)}
        </pre>
      ) : !view.steps.length ? (
        <p className="m-0 text-[11px] text-(--or-faint)">{t("or.planEmpty")}</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {view.steps.map((step) => (
            <li key={step.id} className="text-[11.5px] text-(--or-dim)" data-state={step.state}>
              {displayText(step.label)} · {planStateLabel(step.state, tr)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StepText({ entry, className }: { entry: StepEntry; className: string }) {
  return (
    <p className={`${className} or-step m-0 text-[11px] text-(--or-dim)`} data-kind="step" data-status={entry.status}>
      {t("or.step")} · {displayText(entry.name)} · {stepStatusLabel(entry.status, tr)}
    </p>
  );
}

function SubagentText({ entry, className }: { entry: SubagentEntry; className: string }) {
  return (
    <p
      className={`${className} or-subagent m-0 text-[11px] text-(--or-dim)`}
      data-kind="subagent"
      data-status={entry.status}
    >
      {t("or.subagent")} · {displayText(entry.name)} · {subagentStatusLabel(entry.status, tr)}
      {entry.detail ? ` · ${displayText(entry.detail)}` : ""}
    </p>
  );
}

function CustomText({ entry, className }: { entry: CustomEntry; className: string }) {
  if (entry.display === "debug") return null;
  return (
    <details className={`${className} or-custom`} data-kind="custom">
      <summary className="text-[11px] text-(--or-dim)">
        {displayText(entry.name)} · {t("or.custom")}
      </summary>
      <pre className={`${MONO} m-0 whitespace-pre-wrap text-[10px] text-(--or-faint) [overflow-wrap:anywhere]`}>
        {safeJson(entry.value, 0)}
      </pre>
    </details>
  );
}

function ErrorText({ entry, className }: { entry: ErrorEntry; className: string }) {
  return (
    <p className={`${className} or-error-row m-0 text-[12px] text-(--or-red)`} data-kind="error" role="alert">
      {displayText(entry.message)}
    </p>
  );
}

function InterruptText(props: {
  entry: InterruptEntry;
  className: string;
  visible: boolean;
  onApprove: (entry: InterruptEntry, approved: boolean) => void;
}) {
  const { entry, className, visible, onApprove } = props;
  const state = approvalState(entry);
  return (
    <section className={`${className} or-approval`} data-kind="interrupt" data-state={state}>
      <p className={`${MONO} m-0 text-[9px] tracking-[0.16em] uppercase`}>{approvalLabel(entry, tr)}</p>
      <p className="m-0 text-[13px] text-(--or-text) [overflow-wrap:anywhere]">{displayText(entry.message)}</p>
      {entry.description && (
        <p className="m-0 text-[11px] text-(--or-dim) [overflow-wrap:anywhere]">{displayText(entry.description)}</p>
      )}
      {!!entry.details.length && (
        <dl className="m-0">
          {entry.details.map((detail, index) => (
            <div key={`detail-${index}`}>
              <dt className={`${MONO} inline text-[8.5px] text-(--or-faint) uppercase`}>{displayText(detail.label)}</dt>
              <dd className="m-0 inline text-[11px] text-(--or-dim)">{displayText(detail.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.responseSchema && (
        <pre className={`${MONO} m-0 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-(--or-faint)`}>
          {safeJson(entry.responseSchema, 2)}
        </pre>
      )}
      {state === "pending" && visible && (
        <div className="mt-2 flex gap-2">
          <button type="button" className="or-btn" onClick={() => onApprove(entry, true)}>
            {t("intr.approve")}
          </button>
          <button type="button" className="or-btn" onClick={() => onApprove(entry, false)}>
            {t("intr.deny")}
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className={`${MONO} m-0 text-[9px] text-(--or-green) uppercase`}>{t("intr.approvedBy")}</p>
      )}
      {state === "denied" && (
        <p className={`${MONO} m-0 text-[9px] text-(--or-red) uppercase`}>{t("intr.deniedBy")}</p>
      )}
    </section>
  );
}

function StateBlock({
  conversation: c,
  visibleMode,
}: {
  conversation: ReturnType<typeof useConversation>;
  visibleMode: boolean;
}) {
  const metadataRows = entriesOf(c.metadata ?? {});
  const stateRows = entriesOf(c.sharedState);
  return (
    <section className={`or-state ${visibleMode ? "mt-6" : ""}`} data-kind="state">
      <p className={`${MONO} m-0 text-[8.5px] tracking-[0.16em] text-(--or-faint) uppercase`}>
        {t("or.sharedState")} · v{c.stateVersion}
      </p>
      {stateRows.length ? (
        <dl className="m-0">
          {stateRows.slice(0, 8).map(([key, value]) => (
            <div key={key}>
              <dt className={`${MONO} inline text-[8.5px] text-(--or-faint) uppercase`}>{displayText(key)}</dt>
              <dd className="m-0 inline text-[11px] text-(--or-dim)">
                {typeof value === "object" ? safeJson(value, 0) : displayText(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : !isEmptyState(c.sharedState) ? (
        <p className="m-0 text-[11px] text-(--or-dim) [overflow-wrap:anywhere]">{displayText(c.sharedState)}</p>
      ) : (
        <p className="m-0 text-[11px] text-(--or-faint)">{t("or.stateEmpty")}</p>
      )}
      {!!metadataRows.length && (
        <p className={`${MONO} m-0 mt-1 text-[8.5px] text-(--or-faint)`}>
          {t("or.metadata")} · {metadataRows.slice(0, 4).map(([key, value]) => `${displayText(key)}=${displayText(value)}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

export default {
  id: "orbit",
  name: "Orbit",
  tagline: "Deep-space text tunnel",
  swatch: ["#05060a", "#0a0f1e", "#9d8cff"] as [string, string, string],
  ChatPage: OrbitPage,
};
