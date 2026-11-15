/* ─────────────────────────────────────────────────────────────────────
   Orbit v2 — the conversation as a tunnel in deep space.

   This module is the pure data layer between the protocol store and the
   WebGL scene. It decides *what* exists in 3D, where it sits on the Z axis
   and which words appear on its surfaces; it imports no three.js and runs
   in jsdom, so the entry→mesh declaration can be unit tested without
   mocking the renderer.

   Layout contract (deterministic, no Math.random):
     • every entry is one tunnel station; stations are laid deeper into the
       tunnel (increasingly negative z) in transcript order;
     • the newest station is what the camera auto-follows;
     • text is aggregated into paragraph meshes — `splitForMesh` caps a
       station segment at ~480 chars / one hard line, never per token and
       never per character;
     • the only 2D-intent surface left is the composer (IME), so every
       status word used by the 3D scene resolves through `tr()` here and is
       shared with the accessibility mirror.
   ───────────────────────────────────────────────────────────────────── */

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
import { planRawText, planView } from "../../shared/plan";
import { displayText, safeJson } from "../../shared/safe";

export type Tone =
  | "text"
  | "dim"
  | "faint"
  | "violet"
  | "cyan"
  | "mint"
  | "amber"
  | "red"
  | "green"
  | "user";

/** World-space colors. Kept here (not in the renderer) so model tests can
    assert state coverage without importing three. */
export const TONE_COLOR: Record<Tone, string> = {
  text: "#e7ebf7",
  dim: "#aab3cc",
  faint: "#8590ad",
  violet: "#9d8cff",
  cyan: "#7fdcff",
  mint: "#67f5d0",
  amber: "#ffc76b",
  red: "#ff8291",
  green: "#8bf0b8",
  user: "#c3cbe2",
};

export type SegmentRole = "meta" | "body" | "label";

export interface SceneSegment {
  /** stable id (node id + index) so the renderer can diff text updates */
  id: string;
  text: string;
  role: SegmentRole;
  tone: Tone;
  size: number;
  maxWidth: number;
  anchorX: "left" | "center" | "right";
  align: "left" | "center" | "right";
  /** local Y offset from the station origin (top edge), world units */
  offsetY: number;
  /** deterministic micro depth layer, in world units (±0.5 max) */
  depthJitter: number;
}

export type SceneActionKind = "approve" | "deny" | "suggestion";

/** A clickable control that exists twice: a mesh in the scene (raycast) and
    a real transparent DOM button projected over it (keyboard + focus ring). */
export interface SceneAction {
  id: string;
  kind: SceneActionKind;
  /** entry the action belongs to (approvals) */
  entryId?: string;
  /** station node id for node-space actions */
  nodeId?: string;
  /** suggestion text (suggestion actions) */
  text?: string;
  /** localized visible/3D label */
  label: string;
  /** localized accessible name for the DOM proxy */
  ariaLabel: string;
  space: "node" | "camera";
  /** local offset within the station (space "node") or camera (space "camera") */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

export type NodeMesh = "none" | "panel" | "icosa" | "errorpanel" | "ring";

export interface SceneNode {
  id: string;
  kind: Entry["kind"] | "empty" | "state";
  /** tunnel depth (negative = deeper). Deterministic. */
  z: number;
  /** station origin: x world, y world (top edge), z tunnel depth */
  x: number;
  y: number;
  width: number;
  height: number;
  tone: Tone;
  mesh: NodeMesh;
  segments: SceneSegment[];
  actions: SceneAction[];
  /** raw protocol state, kept for visual coverage tests */
  status?: string;
  /** materialize from nothing when the station first appears */
  materialize: boolean;
}

export interface SceneBounds {
  /** camera z closest to the newest station (auto-follow target) */
  minZ: number;
  /** camera z furthest back (oldest station in view) */
  maxZ: number;
}

export interface SceneModel {
  nodes: SceneNode[];
  /** suggestions float near the camera, above the composer */
  cameraActions: SceneAction[];
  bounds: SceneBounds;
  newestZ: number;
  oldestZ: number;
  empty: boolean;
  /** footer line for the HUD (metadata compact) */
  metaLine: string;
}

export interface BuildOptions {
  /** translator pinned by the host; status words must go through it */
  tr: (key: string) => string;
  /** shared state snapshot (rendered as a ribbon at the tunnel entrance) */
  sharedState?: Record<string, unknown>;
  stateVersion?: number;
  suggestions?: string[];
  metadata?: Record<string, unknown>;
  brand?: { agentName?: string; modelLabel?: string; threadId?: string };
}

/* ── geometry constants ─────────────────────────────────────────────── */

export const TUNNEL = {
  /** z of the first station */
  startZ: -26,
  /** clear space between stations — one chamber per station, so the camera
      at the live edge (followGap ahead of the newest) never has an older
      station between it and the text it is reading. */
  gap: 19,
  /** distance kept between the camera and the newest station (chamber view;
      14 units makes a typical paragraph ~27px while still fitting a
      chamber-sized 320-char CJK station) */
  followGap: 14,
  /** distance kept between the camera and the oldest station */
  backGap: 13,
  /** empty room camera position */
  emptyCameraZ: 8,
  /** hard camera safety range (also enforced by TunnelCamera) */
  cameraNear: -4000,
  cameraFar: 60,
  /** hard cap on one text mesh (paragraph aggregation, never per token).
      320 chars keeps a CJK paragraph inside one camera chamber. */
  maxSegmentChars: 320,
  lineHeight: 1.42,
} as const;

const LANE = {
  assistantX: -2.3,
  assistantWidth: 10.6,
  userX: 4.6,
  userWidth: 7.0,
  reasoningX: 3.5,
  reasoningWidth: 7.4,
  toolX: 5.3,
  toolLabelWidth: 4.6,
  planX: -2.5,
  planWidth: 8.6,
  smallX: 5.6,
  smallWidth: 5.4,
  customX: -5.4,
  customWidth: 5.4,
  interruptWidth: 8.8,
  errorWidth: 8.6,
  originY: 2.0,
} as const;

const SIZE = {
  meta: 0.24,
  body: 0.5,
  small: 0.34,
  heading: 0.62,
  emptyTitle: 0.92,
  emptySub: 0.42,
} as const;

/* ── text helpers ───────────────────────────────────────────────────── */

/** Approximate rendered width in `em` units: CJK/full-width = 1, Latin ≈ 0.56. */
export function visualUnits(text: string): number {
  let units = 0;
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 10 || code === 13) continue;
    units += code >= 0x2e80 && code <= 0xffff ? 1 : 0.56;
  }
  return units;
}

export function estimateLines(text: string, maxWidth: number, size: number): number {
  const perLine = Math.max(4, maxWidth / Math.max(0.05, size));
  let lines = 0;
  for (const hardLine of text.split("\n")) {
    lines += Math.max(1, Math.ceil(visualUnits(hardLine) / perLine));
  }
  return Math.max(1, lines);
}

/** Light presentation cleanup: no Markdown parsing, just drop the syntax
    that would read as noise in 3D. The accessibility mirror keeps the raw
    protocol text untouched. */
export function cleanForScene(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "· ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split one logical paragraph into ≤maxChars chunks on sentence/word
    boundaries — the mesh aggregation unit. Never per token/char. */
export function splitForMesh(text: string, maxChars: number = TUNNEL.maxSegmentChars): string[] {
  const clean = cleanForScene(text);
  if (!clean) return [];
  // paragraphs are stations of their own; long paragraphs get chunked
  const paragraphs = clean.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return paragraphs.flatMap((paragraph) => chunkText(paragraph, maxChars));
}

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = window.lastIndexOf("\n");
    // prefer a sentence boundary; a space is the fallback, then a hard cut
    for (const mark of [". ", "! ", "? ", "。", "！", "？"]) {
      const index = window.lastIndexOf(mark);
      if (index >= 0) cut = Math.max(cut, index + mark.length);
    }
    cut = Math.max(cut, window.lastIndexOf(" "));
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks;
}

/** Deterministic per-id jitter in [-1, 1] (FNV-1a). */
export function hashUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

/* ── localized status words (the t() discipline) ────────────────────── */

export function toolStatusLabel(status: string, tr: (key: string) => string): string {
  if (status === "args") return tr("chat.streamingArgs");
  if (status === "interrupted") return tr("chat.interrupted");
  if (status === "done") return tr("chat.done");
  if (status === "error") return tr("chat.failed");
  return tr("chat.executing");
}

export function stepStatusLabel(status: string, tr: (key: string) => string): string {
  if (status === "done") return tr("chat.done");
  if (status === "failed") return tr("chat.failed");
  return tr("status.running");
}

export function subagentStatusLabel(status: string, tr: (key: string) => string): string {
  if (status === "done") return tr("chat.done");
  if (status === "error") return tr("chat.failed");
  return tr("status.running");
}

export function planStateLabel(state: string, tr: (key: string) => string): string {
  if (state === "done") return tr("or.state.done");
  if (state === "active") return tr("or.state.active");
  if (state === "cancelled") return tr("or.state.cancelled");
  return tr("or.state.pending");
}

export function approvalState(entry: InterruptEntry): "pending" | "approved" | "denied" | "expired" {
  if (entry.expired) return "expired";
  if (entry.status === "approved") return "approved";
  if (entry.status === "denied") return "denied";
  return "pending";
}

export function approvalLabel(entry: InterruptEntry, tr: (key: string) => string): string {
  const state = approvalState(entry);
  if (state === "expired") return tr("intr.expired");
  if (state === "approved") return tr("or.approved");
  if (state === "denied") return tr("or.denied");
  return tr("or.auth");
}

export function statusLabel(status: string, tr: (key: string) => string): string {
  if (status === "idle") return tr("status.idle");
  if (status === "running") return tr("status.running");
  if (status === "interrupted") return tr("status.interrupted");
  if (status === "done") return tr("status.done");
  if (status === "error") return tr("status.error");
  return tr("status.stopped");
}

/* ── station builders ───────────────────────────────────────────────── */

interface SegmentSpec {
  text: string;
  role: SegmentRole;
  tone: Tone;
  size: number;
  maxWidth: number;
  anchorX?: "left" | "center" | "right";
  align?: "left" | "center" | "right";
  gapBefore?: number;
}

class SegmentList {
  readonly items: SceneSegment[] = [];
  cursor = 0;

  constructor(private readonly nodeId: string) {}

  add(spec: SegmentSpec): void {
    const text = spec.text.trim();
    if (!text) return;
    this.cursor += spec.gapBefore ?? 0;
    const lines = estimateLines(text, spec.maxWidth, spec.size);
    const index = this.items.length;
    this.items.push({
      id: `${this.nodeId}-s${index}`,
      text,
      role: spec.role,
      tone: spec.tone,
      size: spec.size,
      maxWidth: spec.maxWidth,
      anchorX: spec.anchorX ?? "left",
      align: spec.align ?? "left",
      offsetY: this.cursor,
      depthJitter: (hashUnit(`${this.nodeId}-${index}`) - 0.5) * 0.7,
    });
    this.cursor += lines * spec.size * TUNNEL.lineHeight;
  }
}

function nodeShell(
  entry: Entry,
  z: number,
  lane: { x: number; width: number },
  mesh: NodeMesh,
  tone: Tone
): { node: SceneNode; segments: SegmentList } {
  const id = `n-${entry.id}`;
  return {
    node: {
      id,
      kind: entry.kind,
      z,
      x: lane.x,
      y: LANE.originY,
      width: lane.width,
      height: 0,
      tone,
      mesh,
      status: "status" in entry ? String((entry as { status?: unknown }).status ?? "") : undefined,
      materialize: true,
      segments: [],
      actions: [],
    },
    segments: new SegmentList(id),
  };
}

function timeMeta(at: number, tr: (key: string) => string): string {
  const time = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${tr("or.assistant")} · ${time}`;
}

function chunkStation(
  id: string,
  kind: Entry["kind"],
  z: number,
  lane: { x: number; width: number },
  tone: Tone
): { node: SceneNode; segments: SegmentList } {
  return {
    node: {
      id,
      kind,
      z,
      x: lane.x,
      y: LANE.originY,
      width: lane.width,
      height: 0,
      tone,
      mesh: "none",
      materialize: true,
      segments: [],
      actions: [],
    },
    segments: new SegmentList(id),
  };
}

/** Split a text entry into one station per paragraph chunk. Each chunk fits
    one camera chamber; `…continued` keeps the stream legible when a long
    answer spans several stations. */
function textStations(
  entry: UserEntry | AssistantEntry | ReasoningEntry,
  z: number,
  tr: (key: string) => string
): SceneNode[] {
  const isUser = entry.kind === "user";
  const isReasoning = entry.kind === "reasoning";
  const lane = isUser
    ? { x: LANE.userX, width: LANE.userWidth }
    : isReasoning
      ? { x: LANE.reasoningX, width: LANE.reasoningWidth }
      : { x: LANE.assistantX, width: LANE.assistantWidth };
  const tone: Tone = isUser ? "user" : isReasoning ? "violet" : "text";
  const maxChars = isUser ? 240 : TUNNEL.maxSegmentChars;
  const chunks = splitForMesh(entry.text, maxChars);
  const parts = chunks.length ? chunks : [""];

  return parts.map((chunk, index) => {
    const id = `n-${entry.id}-p${index}`;
    const { node, segments } = chunkStation(id, entry.kind, z, lane, tone);
    if (isUser) {
      segments.add({
        text:
          index === 0
            ? `${tr("or.you")} · ${new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : tr("or.continued"),
        role: "meta",
        tone: "faint",
        size: SIZE.meta,
        maxWidth: lane.width,
        anchorX: "right",
        align: "right",
      });
      segments.add({
        text: chunk || "—",
        role: "body",
        tone: "user",
        size: SIZE.body,
        maxWidth: lane.width,
        anchorX: "right",
        align: "right",
        gapBefore: 0.16,
      });
    } else if (isReasoning) {
      segments.add({
        text:
          index === 0
            ? `${entry.streaming ? tr("status.thinking") : tr("chat.reasoning")} · ${entry.tokens} ${tr("chat.tokens")}`
            : tr("or.continued"),
        role: "label",
        tone: index === 0 ? "violet" : "faint",
        size: SIZE.small,
        maxWidth: lane.width,
      });
      segments.add({
        text: chunk || (index === 0 ? tr("or.encrypted") : "—"),
        role: "body",
        tone: entry.encryptedValue ? "faint" : "dim",
        size: 0.4,
        maxWidth: lane.width,
        gapBefore: 0.12,
      });
    } else {
      segments.add({
        text:
          index === 0
            ? timeMeta(entry.at, tr) + (entry.streaming ? ` · ${tr("status.writing")}` : "")
            : tr("or.continued"),
        role: "meta",
        tone: index === 0 && entry.streaming ? "cyan" : "faint",
        size: SIZE.meta,
        maxWidth: lane.width,
      });
      segments.add({
        text: chunk || (index === 0 ? (entry.streaming ? "…" : "—") : "—"),
        role: "body",
        tone: chunk ? "text" : "faint",
        size: SIZE.body,
        maxWidth: lane.width,
        gapBefore: 0.14,
      });
    }
    return finish(node, segments);
  });
}

function toolNode(entry: ToolEntry, z: number, tr: (key: string) => string): SceneNode {
  const { node, segments } = nodeShell(
    entry,
    z,
    { x: LANE.toolX, width: LANE.toolLabelWidth },
    "icosa",
    entry.status === "error" ? "red" : entry.status === "done" ? "green" : entry.status === "interrupted" ? "amber" : "cyan"
  );
  segments.add({
    text: `${tr("chat.tools")} · ${toolStatusLabel(entry.status, tr)}`,
    role: "meta",
    tone: node.tone,
    size: SIZE.meta,
    maxWidth: LANE.toolLabelWidth,
    gapBefore: 0.0,
  });
  segments.add({
    text: displayText(entry.name) || tr("chat.tools"),
    role: "label",
    tone: "text",
    size: 0.4,
    maxWidth: LANE.toolLabelWidth,
    gapBefore: 0.16,
  });
  const brief = Object.entries((entry.args && typeof entry.args === "object" && !Array.isArray(entry.args)
    ? entry.args
    : {}) as Record<string, unknown>)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value).slice(0, 30)}`)
    .join(" · ");
  if (brief) {
    segments.add({
      text: brief,
      role: "body",
      tone: "dim",
      size: 0.3,
      maxWidth: LANE.toolLabelWidth,
      gapBefore: 0.14,
    });
  }
  if (entry.status === "error" && entry.error) {
    segments.add({
      text: displayText(entry.error),
      role: "body",
      tone: "red",
      size: 0.3,
      maxWidth: LANE.toolLabelWidth,
      gapBefore: 0.16,
    });
  }
  // keep the wireframe polyhedron inside the station: label sits to its right
  node.height = Math.max(1.9, segments.cursor + 0.35);
  node.segments = segments.items;
  node.actions = [];
  return node;
}

function planNode(entry: PlanEntry, z: number, tr: (key: string) => string): SceneNode {
  const { node, segments } = nodeShell(
    entry,
    z,
    { x: LANE.planX, width: LANE.planWidth },
    "panel",
    "cyan"
  );
  const view = planView(entry);
  segments.add({
    text: `${tr("or.plan")} · ${displayText(entry.title) || tr("or.planEmpty")}`,
    role: "label",
    tone: "cyan",
    size: 0.4,
    maxWidth: LANE.planWidth,
  });
  if (view.rawOnly) {
    for (const chunk of splitForMesh(planRawText(view))) {
      segments.add({ text: chunk, role: "body", tone: "dim", size: 0.32, maxWidth: LANE.planWidth, gapBefore: 0.14 });
    }
  } else if (!view.steps.length) {
    segments.add({ text: tr("or.planEmpty"), role: "body", tone: "faint", size: 0.34, maxWidth: LANE.planWidth, gapBefore: 0.14 });
  } else {
    for (const step of view.steps) {
      const mark = step.state === "done" ? "✓" : step.state === "active" ? "◐" : step.state === "cancelled" ? "×" : "○";
      segments.add({
        text: `${mark} ${displayText(step.label) || "—"} · ${planStateLabel(step.state, tr)}`,
        role: "body",
        tone: step.state === "done" ? "green" : step.state === "active" ? "text" : step.state === "cancelled" ? "faint" : "dim",
        size: 0.36,
        maxWidth: LANE.planWidth,
        gapBefore: 0.12,
      });
    }
  }
  return finish(node, segments, { meshWidth: LANE.planWidth, pad: 0.5 });
}

function stepNode(entry: StepEntry, z: number, tr: (key: string) => string): SceneNode {
  const tone: Tone = entry.status === "done" ? "green" : entry.status === "failed" ? "red" : "cyan";
  const { node, segments } = nodeShell(entry, z, { x: LANE.smallX, width: LANE.smallWidth }, "none", tone);
  segments.add({
    text: `${tr("or.step")} · ${displayText(entry.name)} · ${stepStatusLabel(entry.status, tr)}`,
    role: "label",
    tone,
    size: SIZE.small,
    maxWidth: LANE.smallWidth,
  });
  return finish(node, segments);
}

function subagentNode(entry: SubagentEntry, z: number, tr: (key: string) => string): SceneNode {
  const tone: Tone = entry.status === "done" ? "green" : entry.status === "error" ? "red" : "cyan";
  const { node, segments } = nodeShell(entry, z, { x: LANE.smallX, width: LANE.smallWidth }, "none", tone);
  segments.add({
    text: `${tr("or.subagent")} · ${displayText(entry.name)} · ${subagentStatusLabel(entry.status, tr)}`,
    role: "label",
    tone,
    size: SIZE.small,
    maxWidth: LANE.smallWidth,
  });
  if (entry.detail) {
    segments.add({ text: displayText(entry.detail), role: "body", tone: "dim", size: 0.28, maxWidth: LANE.smallWidth, gapBefore: 0.1 });
  }
  return finish(node, segments);
}

function customNode(entry: CustomEntry, z: number, tr: (key: string) => string): SceneNode {
  const { node, segments } = nodeShell(entry, z, { x: LANE.customX, width: LANE.customWidth }, "none", "mint");
  segments.add({
    text: `${displayText(entry.name)} · ${tr("or.custom")}`,
    role: "label",
    tone: "mint",
    size: 0.28,
    maxWidth: LANE.customWidth,
    anchorX: "right",
    align: "right",
  });
  const payload = safeJson(entry.value, 0);
  if (payload) {
    segments.add({
      text: payload.slice(0, 160),
      role: "body",
      tone: "faint",
      size: 0.24,
      maxWidth: LANE.customWidth,
      anchorX: "right",
      align: "right",
      gapBefore: 0.1,
    });
  }
  return finish(node, segments);
}

function errorNode(entry: ErrorEntry, z: number, tr: (key: string) => string): SceneNode {
  const { node, segments } = nodeShell(entry, z, { x: 0, width: LANE.errorWidth }, "errorpanel", "red");
  segments.add({
    text: displayText(entry.message) || tr("chat.failed"),
    role: "body",
    tone: "red",
    size: 0.46,
    maxWidth: LANE.errorWidth - 0.8,
    gapBefore: 0.35,
    anchorX: "center",
    align: "center",
  });
  return finish(node, segments, { meshWidth: LANE.errorWidth, pad: 0.85 });
}

function interruptNode(entry: InterruptEntry, z: number, tr: (key: string) => string): SceneNode {
  const state = approvalState(entry);
  const tone: Tone = state === "pending" ? "amber" : state === "approved" ? "green" : state === "denied" ? "red" : "faint";
  const { node, segments } = nodeShell(entry, z, { x: 0, width: LANE.interruptWidth }, "panel", tone);
  const inner = LANE.interruptWidth - 0.9;
  segments.add({
    text: approvalLabel(entry, tr),
    role: "label",
    tone,
    size: 0.34,
    maxWidth: inner,
    anchorX: "center",
    align: "center",
    gapBefore: 0.38,
  });
  segments.add({
    text: displayText(entry.message) || "—",
    role: "body",
    tone: "text",
    size: 0.46,
    maxWidth: inner,
    anchorX: "center",
    align: "center",
    gapBefore: 0.3,
  });
  if (entry.description) {
    segments.add({
      text: displayText(entry.description),
      role: "body",
      tone: "dim",
      size: 0.34,
      maxWidth: inner,
      anchorX: "center",
      align: "center",
      gapBefore: 0.22,
    });
  }
  for (const detail of entry.details) {
    segments.add({
      text: `${displayText(detail.label)} · ${displayText(detail.value)}`,
      role: "body",
      tone: "dim",
      size: 0.3,
      maxWidth: inner,
      anchorX: "center",
      align: "center",
      gapBefore: 0.12,
    });
  }
  if (entry.expiresAt) {
    segments.add({
      text: new Date(entry.expiresAt).toLocaleTimeString(),
      role: "meta",
      tone: "faint",
      size: 0.24,
      maxWidth: inner,
      anchorX: "center",
      align: "center",
      gapBefore: 0.16,
    });
  }
  const actions: SceneAction[] = [];
  if (state === "pending") {    const buttonY = -(segments.cursor + 0.9);
    actions.push(
      {
        id: `act-${entry.id}-approve`,
        kind: "approve",
        entryId: entry.id,
        nodeId: `n-${entry.id}`,
        label: tr("intr.approve"),
        ariaLabel: tr("intr.approve"),
        space: "node",
        x: -1.35,
        y: buttonY,
        z: 0.06,
        width: 2.2,
        height: 0.78,
      },
      {
        id: `act-${entry.id}-deny`,
        kind: "deny",
        entryId: entry.id,
        nodeId: `n-${entry.id}`,
        label: tr("intr.deny"),
        ariaLabel: tr("intr.deny"),
        space: "node",
        x: 1.15,
        y: buttonY,
        z: 0.06,
        width: 2.0,
        height: 0.78,
      }
    );
  }
  const height = segments.cursor + (state === "pending" ? 1.7 : 0.9);
  node.height = Math.max(4.4, height);
  node.status = state;
  node.segments = segments.items;
  node.actions = actions;
  return node;
}

function finish(
  node: SceneNode,
  segments: SegmentList,
  options?: { meshWidth?: number; pad?: number }
): SceneNode {
  const pad = options?.pad ?? 0.35;
  const height = Math.max(1.15, segments.cursor + pad);
  return {
    ...node,
    height,
    segments: segments.items,
    actions: node.actions,
    ...(options?.meshWidth
      ? { mesh: node.mesh === "none" ? "panel" : node.mesh, width: options.meshWidth }
      : {}),
  };
}

function stateNode(
  sharedState: Record<string, unknown>,
  stateVersion: number | undefined,
  z: number,
  tr: (key: string) => string
): SceneNode {
  const id = "n-state";
  const segments = new SegmentList(id);
  segments.add({
    text: `${tr("or.sharedState")}${typeof stateVersion === "number" ? ` · v${stateVersion}` : ""}`,
    role: "label",
    tone: "mint",
    size: SIZE.small,
    maxWidth: 8.4,
  });
  const rows = Object.entries(sharedState).slice(0, 4);
  for (const [key, value] of rows) {
    segments.add({
      text: `${key} · ${typeof value === "object" ? safeJson(value, 0).slice(0, 90) : displayText(value)}`,
      role: "body",
      tone: "faint",
      size: 0.3,
      maxWidth: 8.4,
      gapBefore: 0.12,
    });
  }
  return {
    ...finish(
      {
        id,
        kind: "state",
        z,
        x: -5.2,
        y: LANE.originY,
        width: 8.4,
        height: 0,
        tone: "mint",
        mesh: "none",
        materialize: false,
        segments: [],
        actions: [],
      },
      segments
    ),
  };
}

function emptyNode(tr: (key: string) => string, z: number): SceneNode {
  const id = "n-empty";
  const segments = new SegmentList(id);
  segments.add({
    text: tr("or.emptyTitle"),
    role: "label",
    tone: "text",
    size: SIZE.emptyTitle,
    maxWidth: 14,
    anchorX: "center",
    align: "center",
  });
  segments.add({
    text: tr("or.emptySub"),
    role: "body",
    tone: "dim",
    size: SIZE.emptySub,
    maxWidth: 11,
    anchorX: "center",
    align: "center",
    gapBefore: 0.5,
  });
  segments.add({
    text: tr("or.emptyHint"),
    role: "meta",
    tone: "faint",
    size: 0.26,
    maxWidth: 11,
    anchorX: "center",
    align: "center",
    gapBefore: 0.7,
  });
  return finish(
    {
      id,
      kind: "empty",
      z,
      x: 0,
      y: 1.6,
      width: 14,
      height: 0,
      tone: "text",
      mesh: "none",
      materialize: true,
      segments: [],
      actions: [],
    },
    segments,
    { pad: 0.6 }
  );
}

/* ── suggestions (camera-anchored) ──────────────────────────────────── */

export function buildSuggestionActions(suggestions: string[], tr: (key: string) => string): SceneAction[] {
  const items = suggestions.filter(Boolean).slice(0, 4);
  const widths = items.map((item) => Math.min(3.6, Math.max(1.4, visualUnits(item) * 0.2 + 0.6)));
  const gap = 0.24;
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, items.length - 1);
  let cursor = -total / 2;
  return items.map((item, index) => {
    const width = widths[index];
    const action: SceneAction = {
      id: `act-suggestion-${index}`,
      kind: "suggestion",
      text: item,
      label: item,
      ariaLabel: item,
      space: "camera",
      x: cursor + width / 2,
      y: -2.42,
      z: -6.6,
      width,
      height: 0.5,
    };
    cursor += width + gap;
    return action;
  });
}

/* ── the entry → station mapping ────────────────────────────────────── */

export function buildSceneModel(entries: Entry[], options: BuildOptions): SceneModel {
  const tr = options.tr;
  const nodes: SceneNode[] = [];
  let cursorZ = TUNNEL.startZ;

  const push = (node: SceneNode) => {
    // Nodes are laid from the front (oldest, least negative) deeper into the
    // tunnel. The chamber-sized gap keeps only the newest station in front of
    // the auto-following camera; the jitter stays well inside that gap.
    node.z = cursorZ + (hashUnit(node.id) - 0.5) * 0.7;
    if (node.kind !== "interrupt") {
      node.x += (hashUnit(`${node.id}-x`) - 0.5) * 2.2;
      node.y += (hashUnit(`${node.id}-y`) - 0.5) * 1.5;
    }
    nodes.push(node);
    cursorZ = node.z - node.height - TUNNEL.gap;
  };

  for (const entry of entries) {
    let produced: SceneNode[] = [];
    switch (entry.kind) {
      case "user":
        produced = textStations(entry, cursorZ, tr);
        break;
      case "assistant":
        produced = textStations(entry, cursorZ, tr);
        break;
      case "reasoning":
        produced = textStations(entry, cursorZ, tr);
        break;
      case "tool":
        produced = [toolNode(entry, cursorZ, tr)];
        break;
      case "plan":
        produced = [planNode(entry, cursorZ, tr)];
        break;
      case "step":
        produced = [stepNode(entry, cursorZ, tr)];
        break;
      case "subagent":
        produced = [subagentNode(entry, cursorZ, tr)];
        break;
      case "custom":
        if (entry.display === "debug") break; // telemetry stays out of the transcript
        produced = [customNode(entry, cursorZ, tr)];
        break;
      case "error":
        produced = [errorNode(entry, cursorZ, tr)];
        break;
      case "interrupt":
        produced = [interruptNode(entry, cursorZ, tr)];
        break;
      default:
        produced = [];
    }
    for (const node of produced) push(node);
  }

  let stateRibbon: SceneNode | null = null;
  if (options.sharedState && Object.keys(options.sharedState).length) {
    stateRibbon = stateNode(options.sharedState, options.stateVersion, TUNNEL.startZ + 9.5, tr);
  }

  const empty = nodes.length === 0;
  if (empty) {
    nodes.push(emptyNode(tr, -18));
  }

  const ordered = stateRibbon ? [stateRibbon, ...nodes] : nodes;
  const oldestZ = ordered.length ? Math.max(...ordered.map((node) => node.z)) : TUNNEL.startZ;
  const newestZ = ordered.length ? Math.min(...ordered.map((node) => node.z)) : TUNNEL.startZ;
  const newestNode = ordered.reduce<SceneNode | null>(
    (current, node) => (!current || node.z < current.z ? node : current),
    null
  );
  const oldestNode = ordered.reduce<SceneNode | null>(
    (current, node) => (!current || node.z > current.z ? node : current),
    null
  );
  // A tall station needs the camera a little further back, otherwise its
  // first/last lines fall outside the lens (320-char CJK cap keeps this
  // under the 19-unit chamber gap).
  const followDistance = Math.max(TUNNEL.followGap, (newestNode?.height ?? 0) * 0.95 + 3);
  const backDistance = Math.max(TUNNEL.backGap, (oldestNode?.height ?? 0) * 0.95 + 3);
  const minZ = empty ? TUNNEL.emptyCameraZ : newestZ + followDistance;
  const maxZ = empty
    ? TUNNEL.emptyCameraZ
    : Math.max(minZ, oldestZ + backDistance);

  const cameraActions = buildSuggestionActions(options.suggestions ?? [], tr);

  return {
    nodes: ordered,
    cameraActions,
    bounds: { minZ, maxZ },
    newestZ,
    oldestZ,
    empty,
    metaLine: [options.brand?.modelLabel, options.metadata?.model, options.brand?.threadId]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .slice(0, 2)
      .join(" · "),
  };
}

/** Visible actions (node + camera) in one flat list for DOM proxies. */
export function sceneActions(model: SceneModel): SceneAction[] {
  return [...model.nodes.flatMap((node) => node.actions), ...model.cameraActions];
}
