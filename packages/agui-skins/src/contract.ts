/* ─────────────────────────────────────────────────────────────────────
   agui-skins — public contract.
   A host implements SkinConversation + passes lang/branding; a skin only
   imports these types and the host hooks.
   ───────────────────────────────────────────────────────────────────── */
import type { ComponentType } from "react";

export type Lang = "en" | "zh";

/** Minimal shape of a logged protocol event (AG-UI or otherwise). */
export interface BaseEvent {
  type: string;
  threadId?: string;
  runId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

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
  /** present when the agent attached an encrypted reasoning item */
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
  /** raw ACTIVITY_SNAPSHOT content, for non-PLAN activity types */
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

/** AG-UI STEP_STARTED / STEP_FINISHED: one entry per step. */
export interface StepEntry extends BaseEntry {
  kind: "step";
  name: string;
  status: "running" | "done" | "failed";
  finishedAt?: number;
}

/** Any CUSTOM event the store does not fold into suggestions/usage. */
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

/** Read-only view model + the intents a conversation surface can trigger. */
export interface SkinConversation {
  entries: Entry[];
  /** declared by the agent (AG-UI capability discovery) */
  capabilities?: SkinCapabilities;
  sharedState: Record<string, unknown>;
  stateVersion: number;
  touchedPaths: string[];
  events: LoggedEvent[];
  status: StudioStatus;
  suggestions: string[];
  threadId: string;
  runId: string;
  tokens: number;
  transport: string;

  getVersion(): number;
  /** Optional live subscription; without it a host must re-render skins itself. */
  subscribe?(listener: () => void): () => void;
  duration(): number;

  send(text: string): void;
  stop(): void;
  replay(): void;
  resolveInterrupt(approved: boolean, editedArgs?: Record<string, unknown>, interruptId?: string): void;
}

export interface SkinCapabilities {
  tools?: { supported: boolean; items?: { name: string }[] };
  reasoning?: { supported: boolean };
  state?: { supported: boolean };
  humanInTheLoop?: { supported: boolean; interrupts?: boolean };
  transport?: { supported?: string[] };
  subagents?: { supported: boolean };
}

export type SkinTextAnim = "none" | "fade" | "rise";
export type SkinDensity = "comfortable" | "compact";
export type SkinMotion = "slow" | "normal" | "fast";
export type SkinRadius = "sharp" | "soft" | "round";

/** Per-skin visual overrides applied by the host (customize panel). */
export interface SkinTuning {
  accent?: string;
  textAnim?: SkinTextAnim;
  density?: SkinDensity;
  /** animation speed multiplier */
  motion?: SkinMotion;
  /** opt-in global corner style */
  radius?: SkinRadius;
}

export interface SkinBranding {
  agentName: string;
  modelLabel: string;
  workspaceName?: string;
  threadTitle?: string;
}

export interface SkinDefinition {
  id: string;
  name: string;
  tagline: string;
  swatch: [string, string, string];
  ChatPage: ComponentType;
}
