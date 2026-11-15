/* ─────────────────────────────────────────────────────────────────────
   ConversationStore — the single source of truth every skin renders.

   It consumes AG-UI events and produces a "view model": an ordered list
   of typed entries (user / assistant / reasoning / tool / plan /
   interrupt) plus shared state, run status and the raw event log.

   Skins never parse protocol events themselves.
   ───────────────────────────────────────────────────────────────────── */
import { EventType, applyPatch, estimateTokens, play, type BaseEvent, type JsonPatchOp, type PlayHandle, type TimedEvent } from "./events";
import { promptFor, RUN_FIRST, THREAD_ID, type Decision } from "./demo";
import { buildScenarioResume, buildScenarioRun, DEFAULT_SCENARIO, type DemoScenario } from "./demo-scenarios";
import type { Lang } from "../i18n";
import { streamPiRun, stopPiRun, type PiBackend } from "./pi";
import { validateResumePayload } from "./validate";
import { buildResumeArray, isInterruptExpired } from "@ag-ui/client";
import type { Interrupt } from "@ag-ui/core";
import {
  buildAgentInput,
  buildResumeInput,
  getAgentEndpoint,
  messagesFromEntries,
  newRunId,
  newThreadId,
  streamAgentRun,
  type AgentEndpoint,
} from "./agui";

export type StudioStatus = "idle" | "running" | "interrupted" | "done" | "error" | "stopped";

export interface LoggedEvent {
  seq: number;
  at: number;
  event: BaseEvent;
}

interface BaseEntry {
  id: string;
  at: number;
}

export interface UserEntry extends BaseEntry {
  kind: "user";
  text: string;
}

export interface AssistantEntry extends BaseEntry {
  kind: "assistant";
  text: string;
  streaming: boolean;
  runId?: string;
}

export interface ReasoningEntry extends BaseEntry {
  kind: "reasoning";
  text: string;
  streaming: boolean;
  durationMs?: number;
  tokens: number;
  encryptedValue?: string;
}

export type ToolStatus = "args" | "executing" | "interrupted" | "done" | "error";

export interface ToolEntry extends BaseEntry {
  kind: "tool";
  /** REASONING_ENCRYPTED_VALUE with subtype "tool_call" */
  encryptedValue?: string;
  name: string;
  argsRaw: string;
  args: unknown;
  status: ToolStatus;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface PlanStep {
  id: string;
  label: string;
  state: "pending" | "active" | "done" | "cancelled";
}

export interface PlanEntry extends BaseEntry {
  kind: "plan";
  title: string;
  activityType: string;
  steps: PlanStep[];
  content?: unknown;
}

export type InterruptStatus = "pending" | "approved" | "denied";

export interface InterruptEntry extends BaseEntry {
  kind: "interrupt";
  message: string;
  description?: string;
  details: { label: string; value: string }[];
  reason: string;
  toolCallId?: string;
  status: InterruptStatus;
  resolvedAt?: number;
  /** protocol extras */
  expiresAt?: string;
  expired?: boolean;
  responseSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  editedArgs?: Record<string, unknown>;
}

export interface ErrorEntry extends BaseEntry {
  kind: "error";
  message: string;
}

export interface SubagentEntry extends BaseEntry {
  kind: "subagent";
  name: string;
  status: "running" | "done" | "error" | "suspended";
  detail?: string;
}

export interface StepEntry extends BaseEntry {
  kind: "step";
  name: string;
  status: "running" | "done" | "failed";
  finishedAt?: number;
}

export interface CustomEntry extends BaseEntry {
  kind: "custom";
  name: string;
  value: unknown;
  display?: "inline" | "debug";
}

export type Entry =
  | StepEntry
  | CustomEntry
  | SubagentEntry
  | UserEntry
  | AssistantEntry
  | ReasoningEntry
  | ToolEntry
  | PlanEntry
  | InterruptEntry
  | ErrorEntry;

const safeHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export type StudioBackend = "mock" | PiBackend | "agui";

const ts = (event: BaseEvent): number => {
  if (typeof event.timestamp === "number") return event.timestamp;
  if (event.timestamp) return Date.parse(String(event.timestamp)) || Date.now();
  return Date.now();
};

const normalizeSteps = (raw: unknown): PlanStep[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const step = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const rawState = String(step.state ?? step.status ?? "pending");
    const state: PlanStep["state"] =
      rawState === "active" || rawState === "in_progress"
        ? "active"
        : rawState === "done" || rawState === "completed"
        ? "done"
        : rawState === "cancelled" || rawState === "canceled"
        ? "cancelled"
        : "pending";
    return {
      id: String(step.id ?? `step_${index}`),
      label: String(step.label ?? step.description ?? step.title ?? `Step ${index + 1}`),
      state,
    };
  });
};

const usageTokens = (usage: unknown): number => {
  if (!Array.isArray(usage)) return 0;
  return usage.reduce((sum, item) => sum + (Number((item as { totalTokens?: number })?.totalTokens) || 0), 0);
};

const uid = (prefix: string) => prefix + "_" + Math.random().toString(36).slice(2, 7);

const MAX_EVENTS = 2000;

const DEFAULT_CAPABILITIES = {
  tools: { supported: true, items: [{ name: "web.search" }, { name: "booking.hold" }] },
  reasoning: { supported: true },
  state: { supported: true },
  humanInTheLoop: { supported: true, interrupts: true },
  subagents: { supported: true },
};

export class ConversationStore {
  threadId = newThreadId();
  /** Declared capabilities; a host can override after construction. */
  capabilities = { ...DEFAULT_CAPABILITIES };

  entries: Entry[] = [];
  sharedState: Record<string, unknown> = {};
  stateVersion = 0;
  touchedPaths: string[] = [];
  events: LoggedEvent[] = [];
  status: StudioStatus = "idle";
  suggestions: string[] = [];
  errorMessage = "";
  runId = RUN_FIRST;
  transport = "mock SSE";
  /** metadata aggregated from every dispatched event (latest key wins) */
  metadata: Record<string, unknown> = {};
  lang: Lang = "en";
  backend: StudioBackend = "mock";
  /** direct AG-UI endpoint (POST RunAgentInput -> SSE) */
  agentEndpoint: AgentEndpoint | null = getAgentEndpoint();
  piStatus: "unknown" | "ready" | "fixture" | "unavailable" = "unknown";
  private abort: AbortController | null = null;
  /** last resume array sent to the agent (demo/bridge payload, useful in tests) */
  lastResume: Decision[] = [];
  /** exact standard RunAgentInput.resume sent to a direct AG-UI endpoint */
  lastAgentResume: ReturnType<typeof buildResumeInput>["resume"] = [];
  /** interrupts that belong to the currently suspended run */
  private runInterruptIds: string[] = [];
  /** last open stream ids, for chunk events that omit messageId */
  private currentAssistantId = "";
  private currentReasoningId = "";

  tokens = 0;
  startedAt = 0;
  endedAt = 0;
  firstTokenAt = 0;

  private seq = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private batchDepth = 0;
  private notifyPending = false;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private handle: PlayHandle | null = null;
  private speed = 0.9;

  constructor(private autoStart = true, public scenario: DemoScenario = DEFAULT_SCENARIO) {
    if (this.autoStart) {
      // let the app mount before the first event paints
      setTimeout(() => this.replay(), 380);
    }
  }

  /* ── react integration (useSyncExternalStore) ───────────────────── */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = () => this.version;
  private notify() {
    if (this.batchDepth > 0) {
      this.notifyPending = true;
      if (this.notifyTimer === null) {
        this.notifyTimer = setTimeout(() => {
          this.notifyTimer = null;
          this.flushNotify();
        }, 16);
      }
      return;
    }
    this.notifyPending = false;
    this.emitNotify();
  }

  private emitNotify() {
    this.version += 1;
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error("[agui] subscriber failed", err);
      }
    });
  }

  private flushNotify() {
    if (!this.notifyPending) return;
    this.notifyPending = false;
    this.emitNotify();
  }

  private beginBatch() {
    this.batchDepth += 1;
  }

  private endBatch() {
    this.batchDepth = Math.max(0, this.batchDepth - 1);
    if (this.batchDepth > 0) return;
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    if (this.notifyPending) this.flushNotify();
  }

  /* ── run control ─────────────────────────────────────────────────── */
  replay() {
    this.stopPlay();
    this.stop();
    if (this.backend !== "mock") {
      // real backends are user-driven: replay only clears the thread
      this.prepareIdle();
      return;
    }
    this.reset();
    this.beginRun();
    this.startEvents(buildScenarioRun(this.scenario, this.threadId, RUN_FIRST, this.lang));
  }

  /** Explicit "new thread": ends the current run and mints a fresh thread id. */
  newThread() {
    this.stop();
    this.reset();
    this.threadId = newThreadId();
    this.runId = RUN_FIRST;
    this.notify();
  }

  /** public nudge so external probes can refresh the UI */
  touch() {
    this.notify();
  }

  setLang(lang: Lang) {
    this.lang = lang;
  }

  /** Switch the scripted demo scenario; the host decides when to replay. */
  setScenario(scenario: DemoScenario) {
    this.scenario = scenario;
    this.notify();
  }

  /** Clear the thread and wait for the user's first message (real backends). */
  prepareIdle() {
    this.stop();
    this.reset();
  }

  setBackend(backend: StudioBackend) {
    this.backend = backend;
    if (backend === "agui") {
      // a generic AG-UI agent declares nothing beyond its events
      this.capabilities = {} as typeof this.capabilities;
      this.transport = this.agentEndpoint ? "AG-UI · " + safeHost(this.agentEndpoint.url) : "AG-UI";
    } else {
      this.capabilities = { ...DEFAULT_CAPABILITIES };
      this.transport =
        backend === "mock"
          ? "mock SSE"
          : backend === "fixture"
          ? "pi fixture"
          : backend === "deepseek"
          ? "deepseek SSE"
          : backend === "deepagent"
          ? "deepagent SSE"
          : "pi rpc";
    }
    this.notify();
  }

  /** Point the store at a standard AG-UI HTTP endpoint. */
  setAgentEndpoint(endpoint: AgentEndpoint | null) {
    const changed = endpoint?.url !== this.agentEndpoint?.url;
    this.agentEndpoint = endpoint;
    if (changed) {
      // a different service must not inherit the previous thread
      this.threadId = newThreadId();
      this.runId = RUN_FIRST;
    }
    if (this.backend === "agui") {
      this.transport = endpoint ? "AG-UI · " + safeHost(endpoint.url) : "AG-UI";
      this.notify();
    }
  }

  send(text: string) {
    const body = text.trim();
    if (!body || this.status === "running") return;
    // a suspended AG-UI run must be resumed (or cancelled), not abandoned
    if (this.status === "interrupted" && this.pendingInterrupts().length) return;
    if (this.backend === "agui") {
      void this.startAgent(body);
      return;
    }
    if (this.backend !== "mock") {
      void this.startPi(this.backend, body);
      return;
    }
    this.stopPlay();
    this.reset();
    this.entries.push({ kind: "user", id: uid("user"), text: body, at: Date.now() });
    this.notify();
    this.beginRun();
    this.startEvents(buildScenarioRun(this.scenario, this.threadId, RUN_FIRST + "_2", this.lang));
  }

  resolveInterrupt(approved: boolean, editedArgs?: Record<string, unknown>, interruptId?: string) {
    const pending = this.pendingInterrupts();
    if (!pending.length) return;
    const entry = interruptId ? pending.find((item) => item.id === interruptId) : pending[0];
    if (!entry) return;

    // protocol: never submit a resume past the interrupt's expiresAt
    // (official @ag-ui/client helper; expiresAt absent means never expires)
    if (isInterruptExpired(entry as unknown as Interrupt)) {
      entry.status = "denied";
      entry.expired = true;
      entry.resolvedAt = Date.now();
      this.errorMessage = "interrupt expired before the user answered";
      this.notify();
      this.resumeWhenResolved();
      return;
    }

    const payload: Record<string, unknown> = { approved, ...(editedArgs ? { editedArgs } : {}) };
    if (!this.validateInterruptPayload(entry, payload)) {
      this.errorMessage = "resume payload does not match responseSchema";
      this.entries.push({ kind: "error", id: uid("err"), message: this.errorMessage, at: Date.now() });
      this.notify();
      return;
    }

    entry.status = approved ? "approved" : "denied";
    entry.resolvedAt = Date.now();
    entry.editedArgs = editedArgs;
    this.notify();
    this.resumeWhenResolved();
  }

  /** AG-UI rule: a resume must address every open interrupt of the run. */
  private resumeWhenResolved() {
    if (this.pendingInterrupts().length) return;
    const scope = new Set(this.runInterruptIds);
    const interrupts = this.entries.filter(
      (entry): entry is InterruptEntry =>
        entry.kind === "interrupt" && (scope.size ? scope.has(entry.id) : true) && (entry.status === "approved" || entry.status === "denied")
    );
    if (this.backend === "agui") {
      /* Official strict coverage (@ag-ui/client buildResumeArray): the resume
         must answer the run's open interrupts exactly once — `runInterruptIds`
         is that open set (recorded from the RUN_FINISHED interrupt outcome)
         and the resolved entries above are the answers, scoped to this run.
         The previously soft-filtered mismatches (an open interrupt nobody
         answered, an answer for an interrupt this run never opened) now
         surface as a user-visible RUN_ERROR instead of being silently
         narrowed or broadened. */
      const openIds = scope.size ? [...scope] : interrupts.map((entry) => entry.id);
      const responses: Record<string, { status: "resolved"; payload?: unknown } | { status: "cancelled" }> = {};
      for (const entry of interrupts) {
        responses[entry.id] =
          entry.status === "approved"
            ? {
                status: "resolved",
                payload: entry.editedArgs ? { approved: true, editedArgs: entry.editedArgs } : { approved: true },
              }
            : { status: "cancelled" };
      }
      try {
        const resume = buildResumeArray(
          openIds.map((id) => ({ id, reason: "resume" }) as Interrupt),
          responses
        );
        const byId = new Map(interrupts.map((entry) => [entry.id, entry]));
        const decisions: Decision[] = resume.map((entry) => ({
          approved: entry.status === "resolved",
          editedArgs: byId.get(entry.interruptId)?.editedArgs,
        }));
        this.lastResume = decisions;
        void this.startAgentResume(
          resume.map((entry) => ({
            interruptId: entry.interruptId,
            approved: entry.status === "resolved",
            editedArgs: byId.get(entry.interruptId)?.editedArgs,
          }))
        );
      } catch (error) {
        this.status = "error";
        this.errorMessage = (error as Error).message || "resume does not cover the run's open interrupts";
        this.entries.push({ kind: "error", id: uid("err"), message: this.errorMessage, at: Date.now() });
        this.notify();
      }
      return;
    }
    const decisions: Decision[] = interrupts.map((entry) => ({
      approved: entry.status === "approved",
      editedArgs: entry.editedArgs,
    }));
    this.lastResume = decisions;
    this.beginRun();
    this.startEvents(buildScenarioResume(this.scenario, decisions, this.threadId, "run_7K2B", this.lang));
  }

  /** zod-validated interrupt resume payloads (P1-6): the interrupt's
   *  responseSchema is converted to an equivalent zod schema in validate.ts. */
  private validateInterruptPayload(entry: InterruptEntry, payload: Record<string, unknown>): boolean {
    return validateResumePayload(entry.responseSchema, payload);
  }

  stop() {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
      if (this.backend === "pi" || this.backend === "fixture") void stopPiRun();
    }
    if (this.handle) {
      this.handle.cancel();
      this.handle = null;
    }
    if (this.status === "running" || this.status === "interrupted") {
      this.status = "stopped";
      this.endedAt = Date.now();
      this.entries.forEach((e) => {
        if ((e.kind === "assistant" || e.kind === "reasoning") && e.streaming) e.streaming = false;
        // Same rule as the interrupt path below: a run that stops mid-tool will
        // never deliver a TOOL_CALL_RESULT, so open tool calls must not keep
        // reading as in flight. ToolStatus has no "stopped" member — the
        // paused "interrupted" state is the aligned value.
        if (e.kind === "tool" && (e.status === "args" || e.status === "executing")) {
          e.status = "interrupted";
        }
      });
      this.notify();
    }
  }

  /**
   * Run against a standard AG-UI endpoint: POST RunAgentInput, consume SSE.
   * No bridge/backend-specific fields are involved; anything that emits AG-UI
   * events works.
   */
  private async startAgent(prompt: string, resume?: { interruptId: string; approved: boolean; editedArgs?: Record<string, unknown> }[]) {
    const endpoint = this.agentEndpoint;
    this.stop();
    this.beginAgentTurn();
    const controller = new AbortController();
    this.abort = controller;
    if (!endpoint) {
      controller.abort();
      this.abort = null;
      this.status = "error";
      this.errorMessage = "AG-UI endpoint is not configured (set ?agui=<url> or via the backend menu)";
      this.entries.push({ kind: "error", id: uid("err"), message: this.errorMessage, at: Date.now() });
      this.notify();
      return;
    }
    if (prompt.trim()) {
      this.entries.push({ kind: "user", id: uid("user"), text: prompt.trim(), at: Date.now() });
    }
    this.notify();

    const runId = newRunId("run");
    this.runId = runId;
    try {
      const input = resume && resume.length
        ? buildResumeInput({
            threadId: this.threadId,
            runId,
            state: this.sharedState,
            messages: messagesFromEntries(this.entries),
            decisions: resume,
          })
        : buildAgentInput({
            threadId: this.threadId,
            runId,
            entries: this.entries,
            state: this.sharedState,
          });
      if (input.resume) this.lastAgentResume = input.resume;
      this.beginBatch();
      try {
        for await (const event of streamAgentRun({ endpoint, input, signal: controller.signal })) {
          this.dispatch(event);
        }
      } finally {
        this.endBatch();
      }
      if (this.status === "running") this.status = "done";
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        this.status = "stopped";
      } else {
        this.status = "error";
        this.errorMessage = (error as Error).message || "AG-UI endpoint unavailable";
        this.entries.push({ kind: "error", id: uid("err"), message: this.errorMessage, at: Date.now() });
      }
    } finally {
      if (this.abort === controller) this.abort = null;
      this.notify();
    }
  }

  /**
   * Start a new direct-mode turn. Keeps the transcript and shared state (AG-UI
   * runs are turns of one thread) and only resets per-run scaffolding.
   */
  private beginAgentTurn() {
    this.abort?.abort();
    this.abort = null;
    this.status = "running";
    this.startedAt = Date.now();
    this.endedAt = 0;
    this.tokens = 0;
    this.suggestions = [];
    this.errorMessage = "";
    this.metadata = {};
    this.events = [];
    this.seq = 0;
    this.touchedPaths = [];
    this.lastAgentResume = [];
    this.runInterruptIds = [];
    this.currentAssistantId = "";
    this.currentReasoningId = "";
    this.notify();
  }

  private startAgentResume(decisions: { interruptId: string; approved: boolean; editedArgs?: Record<string, unknown> }[]) {
    return this.startAgent("", decisions);
  }

  /** Run against the local pi bridge (live RPC agent or recorded fixture). */
  private async startPi(backend: PiBackend, prompt: string) {
    this.stop();
    this.reset();
    this.backend = backend;
    this.entries.push({ kind: "user", id: uid("user"), text: prompt, at: Date.now() });
    this.status = "running";
    this.startedAt = Date.now();
    this.notify();

    const controller = new AbortController();
    this.abort = controller;
    try {
      await streamPiRun({
        backend,
        prompt,
        signal: controller.signal,
        onEvent: (event) => this.dispatch(event),
      });
      if (this.status === "running") this.status = backend === "fixture" ? "done" : "stopped";
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        this.status = "stopped";
      } else {
        this.status = "error";
        this.errorMessage = (error as Error).message || "pi bridge unavailable";
        this.entries.push({ kind: "error", id: uid("err"), message: this.errorMessage, at: Date.now() });
      }
    } finally {
      this.abort = null;
      this.notify();
    }
  }

  /** Jump straight to a scene: useful for screenshots and design review. */
  loadScene(scene: "interrupted" | "done") {
    this.stopPlay();
    this.reset();
    this.entries.push({ kind: "user", id: uid("user"), text: promptFor(this.lang), at: Date.now() });
    this.beginRun();
    this.dispatchAll(buildScenarioRun(this.scenario, this.threadId, RUN_FIRST, this.lang));
    if (scene === "done") {
      const pending = this.pendingInterrupts();
      // A run only has a resume phase when it stopped on interrupts (travel,
      // parallel approvals). Scripts that finish without one must not replay
      // the travel resume by accident.
      if (pending.length) {
        const decisions = pending.map(() => ({ approved: true }));
        pending.forEach((entry) => {
          entry.status = "approved";
          entry.resolvedAt = Date.now();
        });
        this.lastResume = decisions;
        this.dispatchAll(
          buildScenarioResume(this.scenario, decisions, this.threadId, "run_7K2B", this.lang)
        );
      }
    }
    this.notify();
  }

  pendingInterrupts = (): InterruptEntry[] =>
    this.entries.filter((e): e is InterruptEntry => e.kind === "interrupt" && e.status === "pending");

  pendingInterrupt = (): InterruptEntry | undefined => this.pendingInterrupts()[0];

  hasConversation = () => this.entries.length > 0;
  /** Elapsed run time: live `now - startedAt` while in flight, the frozen span once ended. */
  duration = (): number => {
    if (!this.startedAt) return 0;
    return this.endedAt ? this.endedAt - this.startedAt : Date.now() - this.startedAt;
  };

  private startEvents(events: TimedEvent[]) {
    this.handle = play(events, (event) => this.dispatch(event), { speed: this.speed });
  }

  private dispatchAll(events: TimedEvent[]) {
    events.forEach((item) => this.dispatch(item.event));
  }

  private beginRun() {
    this.status = "running";
    this.touchedPaths = [];
    this.notify();
  }

  private stopPlay() {
    if (this.handle) {
      this.handle.cancel();
      this.handle = null;
    }
  }

  private reset() {
    this.stopPlay();
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.entries = [];
    this.sharedState = {};
    this.stateVersion = 0;
    this.touchedPaths = [];
    this.events = [];
    this.seq = 0;
    this.tokens = 0;
    this.startedAt = 0;
    this.endedAt = 0;
    this.firstTokenAt = 0;
    this.suggestions = [];
    this.status = "idle";
    this.errorMessage = "";
    this.metadata = {};
    this.lastAgentResume = [];
    this.runInterruptIds = [];
    this.currentAssistantId = "";
    this.currentReasoningId = "";
    this.notify();
  }

  /* ── event intake ────────────────────────────────────────────────── */
  dispatch(event: BaseEvent) {
    if (event.type === "RUN_STARTED") {
      if (typeof event.threadId === "string" && event.threadId) this.threadId = event.threadId;
      if (typeof event.runId === "string" && event.runId) this.runId = event.runId;
    }
    const meta = (event as { metadata?: unknown }).metadata;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const merged = { ...this.metadata, ...(meta as Record<string, unknown>) };
      const keys = Object.keys(merged);
      if (keys.length > 24) {
        for (const key of keys.slice(0, keys.length - 24)) delete merged[key];
      }
      this.metadata = merged;
    }
    this.events.push({ seq: ++this.seq, at: Date.now(), event });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    try {
      this.reduce(event);
    } catch (err) {
      console.error("[agui] failed to reduce", event.type, err);
      this.status = "error";
      this.errorMessage = String(err);
    }
    this.notify();
  }

  private findTool(id: string) {
    return this.entries.find((e): e is ToolEntry => e.kind === "tool" && e.id === id);
  }
  private findAssistant(id: string) {
    return this.entries.find((e): e is AssistantEntry => e.kind === "assistant" && e.id === id);
  }
  private findReasoning(id: string) {
    return this.entries.find((e): e is ReasoningEntry => e.kind === "reasoning" && e.id === id);
  }
  private findPlan(id: string) {
    return this.entries.find((e): e is PlanEntry => e.kind === "plan" && e.id === id);
  }

  /** Rebuild entries from a MESSAGES_SNAPSHOT (reconnect / history restore). */
  private applyMessagesSnapshot(messages: Record<string, unknown>[], time: number) {
    const entries: Entry[] = [];
    const toolsByCallId = new Map<string, ToolEntry>();
    const textOf = (message: Record<string, unknown>): string => {
      const content = message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
          .join("");
      }
      return "";
    };
    const parse = (value: unknown): unknown => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };

    for (const message of messages) {
      const role = String(message.role ?? "");
      const id = String(message.id ?? uid(role || "msg"));
      if (role === "user") {
        entries.push({ kind: "user", id, at: time, text: textOf(message) });
      } else if (role === "assistant") {
        entries.push({ kind: "assistant", id, at: time, text: textOf(message), streaming: false });
        for (const call of (message.toolCalls as Record<string, unknown>[]) ?? []) {
          const fn = (call.function as { name?: string; arguments?: string }) ?? {};
          const tool: ToolEntry = {
            kind: "tool",
            id: String(call.id ?? uid("tool")),
            at: time,
            name: String(fn.name ?? "tool"),
            argsRaw: String(fn.arguments ?? ""),
            args: parse(fn.arguments),
            status: "executing",
          };
          entries.push(tool);
          toolsByCallId.set(tool.id, tool);
        }
      } else if (role === "tool") {
        const tool = toolsByCallId.get(String(message.toolCallId ?? ""));
        if (tool) {
          const error = typeof message.error === "string" ? message.error : undefined;
          tool.status = error ? "error" : "done";
          if (error) tool.error = error;
          tool.result = parse(message.content);
        }
      } else if (role === "reasoning") {
        entries.push({
          kind: "reasoning",
          id,
          at: time,
          text: textOf(message),
          streaming: false,
          tokens: Math.round(textOf(message).length / 4),
        });
      } else if (role === "activity") {
        const raw = message.content;
        const content =
          raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
        entries.push({
          kind: "plan",
          id,
          at: time,
          title:
            typeof content.title === "string" && content.title
              ? content.title
              : String(message.activityType || "Activity"),
          activityType: String(message.activityType || "ACTIVITY"),
          steps: normalizeSteps(content.steps),
          content: raw,
        });
      }
    }
    // A MESSAGES_SNAPSHOT is authoritative for messages, but it cannot carry
    // client-only entries (pending approvals, plans/activity, steps, custom
    // rows). Preserve those so a reconnect does not lose the suspended run.
    const preserved = this.entries.filter(
      (entry) =>
        entry.kind === "interrupt" ||
        entry.kind === "plan" ||
        entry.kind === "step" ||
        entry.kind === "custom" ||
        entry.kind === "subagent"
    );
    const preservedReasoning = this.entries.filter(
      (entry) => entry.kind === "reasoning" && !entries.some((nextEntry) => nextEntry.kind === "reasoning")
    );
    for (const entry of entries) {
      if (entry.kind === "tool" && (entry.status === "args" || entry.status === "executing")) {
        entry.status = "done";
      }
    }
    this.entries = [...entries, ...preservedReasoning, ...preserved];
  }

  /** Close anything that would otherwise keep spinning after a terminal event. */
  private closeOpenEntries(time: number, toolState: "done" | "error" | "interrupted", closeTools = true) {
    for (const entry of this.entries) {
      if ((entry.kind === "assistant" || entry.kind === "reasoning") && entry.streaming) {
        entry.streaming = false;
      }
      if (closeTools && entry.kind === "tool" && (entry.status === "args" || entry.status === "executing")) {
        entry.status = toolState;
      }
      if (entry.kind === "subagent" && entry.status === "running") {
        entry.status = toolState === "error" ? "error" : "done";
      }
    }
  }

  private reduce(event: BaseEvent) {
    const time = ts(event);

    switch (event.type) {
      case EventType.RUN_STARTED:
        this.status = "running";
        this.runId = String(event.runId ?? this.runId);
        if (!this.startedAt) this.startedAt = time;
        this.endedAt = 0;
        this.runInterruptIds = [];
        return;

      case EventType.RUN_FINISHED: {
        const outcome = event.outcome as { type?: string; interrupts?: any[] } | undefined;
        this.endedAt = time;
        this.tokens = usageTokens((event as { usage?: unknown }).usage) || this.tokens;
        const terminal = outcome?.type === "interrupt" ? "interrupt" : outcome?.type === "cancelled" ? "cancelled" : "success";
        if (terminal === "interrupt") {
          this.status = "interrupted";
          // The run is suspended: no further events will arrive for open tool
          // calls until resume, so they must not keep reading as in flight.
          this.closeOpenEntries(time, "interrupted");
          for (const intr of outcome?.interrupts ?? []) {
            if (!intr) continue;
            const id = intr.id || uid("int");
            this.runInterruptIds.push(id);
            if (this.entries.some((e) => e.kind === "interrupt" && e.id === id)) continue;
            this.entries.push({
              kind: "interrupt",
              id,
              at: time,
              message: intr.message || "The agent needs your input to continue.",
              description: intr.description,
              details: Array.isArray(intr.details) ? intr.details : [],
              reason: intr.reason || "input_required",
              toolCallId: intr.toolCallId,
              status: "pending",
              expiresAt: intr.expiresAt,
              responseSchema: intr.responseSchema,
              metadata: intr.metadata,
            });
          }
        } else if (terminal === "cancelled") {
          this.status = "stopped";
          this.closeOpenEntries(time, "interrupted");
        } else {
          this.status = "done";
          this.closeOpenEntries(time, "done", false);
        }
        return;
      }

      case EventType.RUN_ERROR:
        this.status = "error";
        this.endedAt = time;
        this.tokens = usageTokens((event as { usage?: unknown }).usage) || this.tokens;
        this.errorMessage = String(event.message || "Run failed");
        this.closeOpenEntries(time, "error");
        this.entries.push({ kind: "error", id: uid("err"), message: this.errorMessage, at: time });
        return;

      case EventType.REASONING_START:
      case EventType.REASONING_MESSAGE_START: {
        const id = String(event.messageId || this.currentReasoningId || "reasoning");
        this.currentReasoningId = id;
        if (!this.findReasoning(id)) {
          this.entries.push({ kind: "reasoning", id, at: time, text: "", streaming: true, tokens: 0 });
        } else {
          const entry = this.findReasoning(id)!;
          entry.streaming = true;
        }
        return;
      }

      case EventType.REASONING_MESSAGE_CHUNK:
      case EventType.REASONING_MESSAGE_CONTENT: {
        const id = String(event.messageId || this.currentReasoningId || "reasoning");
        this.currentReasoningId = id;
        const entry = this.findReasoning(id) ?? (() => {
          const fresh: ReasoningEntry = { kind: "reasoning", id, at: time, text: "", streaming: true, tokens: 0 };
          this.entries.push(fresh);
          return fresh;
        })();
        entry.text += String(event.delta ?? "");
        entry.streaming = true;
        entry.tokens = estimateTokens(entry.text);
        return;
      }

      case EventType.REASONING_ENCRYPTED_VALUE: {
        const subtype = String(event.subtype || "message");
        const value = event.encryptedValue ?? event.value;
        if (typeof value !== "string") return;
        if (subtype === "tool_call") {
          const tool = this.findTool(String(event.entityId || event.toolCallId || ""));
          if (tool) tool.encryptedValue = value;
          return;
        }
        const id = String(event.entityId || event.messageId || this.currentReasoningId || "reasoning");
        const entry = this.findReasoning(id);
        if (entry) entry.encryptedValue = value;
        return;
      }

      case EventType.REASONING_MESSAGE_END:
      case EventType.REASONING_END: {
        const id = String(event.messageId || this.currentReasoningId || "reasoning");
        const entry = this.findReasoning(id);
        if (entry) {
          entry.streaming = false;
          entry.durationMs = Math.max(0, time - entry.at);
        }
        return;
      }

      case EventType.TOOL_CALL_START:
        this.entries.push({
          kind: "tool",
          id: String(event.toolCallId),
          at: time,
          name: String(event.toolCallName ?? "tool"),
          argsRaw: "",
          args: null,
          status: "args",
        });
        return;

      case EventType.TOOL_CALL_CHUNK:
      case EventType.TOOL_CALL_ARGS: {
        let tool = this.findTool(String(event.toolCallId));
        if (!tool && event.type === EventType.TOOL_CALL_CHUNK) {
          const name = event.toolCallName || event.name;
          if (typeof name === "string" && name) {
            tool = {
              kind: "tool",
              id: String(event.toolCallId),
              at: time,
              name,
              argsRaw: "",
              args: {},
              status: "args",
            };
            this.entries.push(tool);
          }
        }
        if (!tool) return;
        tool.argsRaw += String(event.delta ?? "");
        try {
          tool.args = JSON.parse(tool.argsRaw);
        } catch {
          /* argument stream is still incomplete */
        }
        return;
      }

      case EventType.TOOL_CALL_END: {
        const tool = this.findTool(String(event.toolCallId));
        if (tool) tool.status = "executing";
        return;
      }

      case EventType.TOOL_CALL_RESULT: {
        const tool = this.findTool(String(event.toolCallId));
        const content = String(event.content ?? "");
        let parsed: unknown = content;
        try {
          parsed = JSON.parse(content);
        } catch {
          /* keep raw string */
        }
        if (!tool) return;
        const parsedError =
          parsed && typeof parsed === "object" ? (parsed as { error?: unknown }).error : undefined;
        const error =
          typeof event.error === "string"
            ? event.error
            : typeof parsedError === "string"
            ? parsedError
            : undefined;
        tool.status = error ? "error" : "done";
        if (error) tool.error = error;
        tool.result = parsed;
        tool.durationMs = Math.max(0, time - tool.at);
        return;
      }

      case EventType.MESSAGES_SNAPSHOT: {
        this.applyMessagesSnapshot((event.messages as Record<string, unknown>[]) ?? [], time);
        return;
      }

      case EventType.SUBAGENT_STARTED: {
        const id = String(event.subagentRunId || event.subagentId || event.id || uid("subagent"));
        if (this.entries.some((entry) => entry.kind === "subagent" && entry.id === id)) return;
        this.entries.push({
          kind: "subagent",
          id,
          at: time,
          name: String(event.name || event.subagentName || "subagent"),
          status: "running",
          detail: typeof event.description === "string" ? event.description : undefined,
        });
        return;
      }

      case EventType.SUBAGENT_FINISHED:
      case EventType.SUBAGENT_ERROR: {
        const id = String(event.subagentRunId || event.subagentId || event.id || "");
        const entry = this.entries.find((item): item is SubagentEntry => item.kind === "subagent" && item.id === id);
        if (entry) {
          const outcome = String(event.outcome || "");
          entry.status =
            event.type === EventType.SUBAGENT_ERROR ? "error" : outcome === "suspended" ? "suspended" : "done";
          entry.detail = typeof event.message === "string" ? event.message : entry.detail;
        }
        return;
      }

      case EventType.STATE_SNAPSHOT:
        const snapshot = (event.snapshot as Record<string, unknown>) ?? {};
        const isSameState = JSON.stringify(snapshot) === JSON.stringify(this.sharedState);
        if (!isSameState) {
          this.sharedState = snapshot;
          this.stateVersion += 1;
          this.touchedPaths = ["*"];
        }
        return;

      case EventType.STATE_DELTA: {
        try {
          const touched = applyPatch(this.sharedState, event.delta as JsonPatchOp[]);
          this.stateVersion += 1;
          this.touchedPaths = touched;
        } catch (error) {
          // A bad patch from a third-party producer must not kill the run.
          console.warn("[agui] ignoring invalid STATE_DELTA", error);
        }
        return;
      }

      case EventType.ACTIVITY_SNAPSHOT: {
        const id = String(event.messageId);
        const raw = event.content;
        const content =
          raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
        const existing = this.findPlan(id);
        const next: PlanEntry = {
          kind: "plan",
          id,
          at: time,
          title:
            typeof content.title === "string" && content.title
              ? content.title
              : String(event.activityType || "Plan"),
          activityType: String(event.activityType || "PLAN"),
          steps: normalizeSteps(content.steps),
          content: raw,
        };
        if (existing) Object.assign(existing, next);
        else this.entries.push(next);
        return;
      }

      case EventType.ACTIVITY_DELTA: {
        const plan = this.findPlan(String(event.messageId));
        if (plan) {
          try {
            applyPatch(plan, event.patch as JsonPatchOp[]);
          } catch {
            /* plan patch can race a snapshot; ignore */
          }
        }
        return;
      }

      case EventType.TEXT_MESSAGE_START: {
        const id = String(event.messageId || uid("msg"));
        this.currentAssistantId = id;
        if (!this.findAssistant(id)) {
          this.entries.push({
            kind: "assistant",
            id,
            at: time,
            text: "",
            streaming: true,
            runId: event.runId ? String(event.runId) : undefined,
          });
        }
        return;
      }

      case EventType.TEXT_MESSAGE_CHUNK:
      case EventType.TEXT_MESSAGE_CONTENT: {
        const id = String(event.messageId || this.currentAssistantId || uid("msg"));
        this.currentAssistantId = id;
        const assistant =
          this.findAssistant(id) ??
          (() => {
            const fresh: AssistantEntry = { kind: "assistant", id, at: time, text: "", streaming: true };
            this.entries.push(fresh);
            return fresh;
          })();
        const delta = String(event.delta ?? "");
        assistant.text += delta;
        assistant.streaming = true;
        this.tokens += estimateTokens(delta);
        if (!this.firstTokenAt) this.firstTokenAt = time;
        return;
      }

      case EventType.TEXT_MESSAGE_END: {
        const entry = this.findAssistant(String(event.messageId || this.currentAssistantId));
        if (entry) entry.streaming = false;
        return;
      }

      case EventType.STEP_STARTED: {
        this.entries.push({
          kind: "step",
          id: uid("step"),
          at: time,
          name: String(event.stepName ?? event.name ?? "step"),
          status: "running",
        });
        return;
      }

      case EventType.STEP_FINISHED: {
        const name = String(event.stepName ?? event.name ?? "step");
        const entry = [...this.entries]
          .reverse()
          .find((item): item is StepEntry => item.kind === "step" && item.name === name && item.status === "running");
        if (entry) {
          entry.status = "done";
          entry.finishedAt = time;
        } else {
          this.entries.push({ kind: "step", id: uid("step"), at: time, name, status: "done", finishedAt: time });
        }
        return;
      }

      case EventType.CUSTOM: {
        if (event.name === "suggestions" && Array.isArray(event.value)) {
          this.suggestions = event.value.map(String);
        }
        if (event.name === "usage") {
          const usage = event.value as { totalTokens?: number; output?: number };
          if (usage?.totalTokens) this.tokens = Math.max(this.tokens, Number(usage.totalTokens));
        }
        // forward-compatible: unknown CUSTOM payloads become visible entries
        // instead of being silently dropped
        if (event.name !== "suggestions" && event.name !== "usage") {
          const name = String(event.name ?? "custom");
          const inline = name === "handoff" || name === "artifact";
          this.entries.push({
            kind: "custom",
            id: uid("custom"),
            at: time,
            name,
            value: event.value,
            display: inline ? "inline" : "debug",
          });
        }
        return;
      }

      default:
        return;
    }
  }
}

/** The scripted agent. Replace with a real transport when wiring a backend. */
export class DemoAgent {
  private handle: PlayHandle | null = null;
  constructor(private store: ConversationStore) {}

  start() {
    this.store.replay();
  }
  stop() {
    this.handle?.cancel();
    this.handle = null;
  }
}

export const createStudio = (options: { autoplay?: boolean; scenario?: DemoScenario } = {}) =>
  new ConversationStore(options.autoplay !== false, options.scenario ?? DEFAULT_SCENARIO);


