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
  status: "running" | "done" | "error";
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

const ts = (event: BaseEvent): number =>
  event.timestamp ? Date.parse(String(event.timestamp)) || Date.now() : Date.now();

const uid = (prefix: string) => prefix + "_" + Math.random().toString(36).slice(2, 7);

export class ConversationStore {
  readonly threadId = THREAD_ID;
  /** Declared capabilities; a host can override after construction. */
  capabilities = {
    tools: { supported: true, items: [{ name: "web.search" }, { name: "booking.hold" }] },
    reasoning: { supported: true },
    state: { supported: true },
    humanInTheLoop: { supported: true, interrupts: true },
    subagents: { supported: true },
  };

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
  backend: "mock" | PiBackend = "mock";
  piStatus: "unknown" | "ready" | "fixture" | "unavailable" = "unknown";
  private abort: AbortController | null = null;
  /** last resume array sent to the agent (protocol payload, useful in tests) */
  lastResume: Decision[] = [];

  tokens = 0;
  startedAt = 0;
  endedAt = 0;
  firstTokenAt = 0;

  private seq = 0;
  private version = 0;
  private listeners = new Set<() => void>();
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
    this.version += 1;
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error("[agui] subscriber failed", err);
      }
    });
  }

  /* ── run control ─────────────────────────────────────────────────── */
  replay() {
    this.stopPlay();
    if (this.backend !== "mock") {
      // pi mode is user-driven: replay just clears the thread, the prompt
      // comes from the composer
      this.prepareIdle();
      return;
    }
    this.reset();
    this.beginRun();
    this.startEvents(buildScenarioRun(this.scenario, this.threadId, RUN_FIRST, this.lang));
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

  /** Clear the thread and wait for the user's first message (pi mode). */
  prepareIdle() {
    this.reset();
  }

  setBackend(backend: "mock" | PiBackend) {
    this.backend = backend;
    this.transport = backend === "mock" ? "mock SSE" : backend === "fixture" ? "pi fixture" : "pi rpc";
    this.notify();
  }

  send(text: string) {
    const body = text.trim();
    if (!body || this.status === "running") return;
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
    if (entry.expiresAt && Date.now() > Date.parse(entry.expiresAt)) {
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
    const decisions: Decision[] = this.entries
      .filter((entry): entry is InterruptEntry => entry.kind === "interrupt")
      .map((entry) => ({ approved: entry.status === "approved", editedArgs: entry.editedArgs }));
    this.lastResume = decisions;
    this.beginRun();
    this.startEvents(buildScenarioResume(this.scenario, decisions, this.threadId, "run_7K2B", this.lang));
  }

  /** Minimal JSON-Schema validation for interrupt resume payloads. */
  private validateInterruptPayload(entry: InterruptEntry, payload: Record<string, unknown>): boolean {
    const schema = entry.responseSchema as
      | { required?: string[]; properties?: Record<string, { type?: string }> }
      | undefined;
    if (!schema) return true;
    for (const key of schema.required ?? []) {
      if (!(key in payload)) return false;
    }
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      const value = payload[key];
      if (value === undefined) continue;
      if (property.type === "boolean" && typeof value !== "boolean") return false;
      if (property.type === "string" && typeof value !== "string") return false;
      if (property.type === "number" && typeof value !== "number") return false;
      if (property.type === "object" && (typeof value !== "object" || value === null)) return false;
    }
    return true;
  }

  stop() {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
      void stopPiRun();
    }
    if (this.handle) {
      this.handle.cancel();
      this.handle = null;
    }
    if (this.status === "running" || this.status === "interrupted") {
      this.status = "stopped";
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
    this.entries.push({ kind: "user", id: uid("user"), text: promptFor(this.lang), at: ts({ timestamp: new Date().toISOString() }) });
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
    this.notify();
  }

  /* ── event intake ────────────────────────────────────────────────── */
  dispatch(event: BaseEvent) {
    const meta = (event as { metadata?: unknown }).metadata;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      this.metadata = { ...this.metadata, ...(meta as Record<string, unknown>) };
    }
    this.events.push({ seq: ++this.seq, at: Date.now(), event });
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
      }
    }
    this.entries = entries;
  }

  private reduce(event: BaseEvent) {
    const time = ts(event);

    switch (event.type) {
      case EventType.RUN_STARTED:
        this.status = "running";
        this.runId = String(event.runId ?? this.runId);
        if (!this.startedAt) this.startedAt = time;
        this.endedAt = 0;
        return;

      case EventType.RUN_FINISHED: {
        const outcome = event.outcome as { type?: string; interrupts?: any[] } | undefined;
        this.endedAt = time;
        if (outcome?.type === "interrupt") {
          this.status = "interrupted";
          // The run is suspended: no further events will arrive for open tool
          // calls until resume, so they must not keep reading as in flight.
          for (const entry of this.entries) {
            if (entry.kind === "tool" && (entry.status === "args" || entry.status === "executing")) {
              entry.status = "interrupted";
            }
          }
          for (const intr of outcome.interrupts ?? []) {
            if (!intr || this.entries.some((e) => e.kind === "interrupt" && e.id === intr.id)) continue;
            this.entries.push({
              kind: "interrupt",
              id: intr.id || uid("int"),
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
        } else {
          this.status = "done";
        }
        return;
      }

      case EventType.RUN_ERROR:
        this.status = "error";
        this.errorMessage = String(event.message || "Run failed");
        this.entries.push({ kind: "error", id: uid("err"), message: this.errorMessage, at: time });
        return;

      case EventType.REASONING_START:
      case EventType.REASONING_MESSAGE_START: {
        const id = String(event.messageId || "reasoning");
        if (!this.findReasoning(id)) {
          this.entries.push({ kind: "reasoning", id, at: time, text: "", streaming: true, tokens: 0 });
        } else {
          const entry = this.findReasoning(id)!;
          entry.streaming = true;
        }
        return;
      }

      case EventType.REASONING_MESSAGE_CONTENT: {
        const id = String(event.messageId || "reasoning");
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
        const id = String(event.messageId || "reasoning");
        const entry = this.findReasoning(id);
        if (entry && typeof event.value === "string") entry.encryptedValue = event.value;
        return;
      }

      case EventType.REASONING_MESSAGE_END:
      case EventType.REASONING_END: {
        const id = String(event.messageId || "reasoning");
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
        const tool = this.findTool(String(event.toolCallId));
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
        this.entries.push({
          kind: "subagent",
          id: String(event.subagentId || event.id || uid("subagent")),
          at: time,
          name: String(event.name || event.subagentName || "subagent"),
          status: "running",
          detail: typeof event.description === "string" ? event.description : undefined,
        });
        return;
      }

      case EventType.SUBAGENT_FINISHED:
      case EventType.SUBAGENT_ERROR: {
        const id = String(event.subagentId || event.id || "");
        const entry = this.entries.find((item): item is SubagentEntry => item.kind === "subagent" && item.id === id);
        if (entry) {
          entry.status = event.type === EventType.SUBAGENT_ERROR ? "error" : "done";
          entry.detail = typeof event.message === "string" ? event.message : entry.detail;
        }
        return;
      }

      case EventType.STATE_SNAPSHOT:
        this.sharedState = (event.snapshot as Record<string, unknown>) ?? {};
        this.stateVersion += 1;
        this.touchedPaths = ["*"];
        return;

      case EventType.STATE_DELTA: {
        const touched = applyPatch(this.sharedState, event.delta as JsonPatchOp[]);
        this.stateVersion += 1;
        this.touchedPaths = touched;
        return;
      }

      case EventType.ACTIVITY_SNAPSHOT: {
        const id = String(event.messageId);
        const content = (event.content as { title?: string; steps?: PlanStep[] }) ?? {};
        const existing = this.findPlan(id);
        const next: PlanEntry = {
          kind: "plan",
          id,
          at: time,
          title: content.title || String(event.activityType || "Plan"),
          activityType: String(event.activityType || "PLAN"),
          steps: (content.steps || []).map((s) => ({ ...s })),
          content,
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
        const id = String(event.messageId);
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
        const id = String(event.messageId);
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
        const entry = this.findAssistant(String(event.messageId));
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
          this.entries.push({
            kind: "custom",
            id: uid("custom"),
            at: time,
            name: String(event.name ?? "custom"),
            value: event.value,
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


