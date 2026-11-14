import type { PlanEntry } from "../contract";
import { asRecord, displayText, safeJson } from "./safe";

/**
 * A plan/activity step after defensive normalization. The store and host
 * contract say `{id,label,state}`, but third-party activity snapshots may use
 * `description`/`status`, omit fields, or send something that is not an array
 * at all. Skins branch on this normalized view only.
 */
export type SafeStepState = "pending" | "active" | "done" | "cancelled";

export interface SafePlanStep {
  id: string;
  label: string;
  state: SafeStepState;
}

export interface PlanView {
  steps: SafePlanStep[];
  /** steps were absent / not an array / empty: show the raw content instead */
  rawOnly: boolean;
  raw?: unknown;
}

const STATE_ALIASES: Record<string, SafeStepState> = {
  pending: "pending",
  todo: "pending",
  queued: "pending",
  waiting: "pending",
  active: "active",
  running: "active",
  "in-progress": "active",
  in_progress: "active",
  current: "active",
  done: "done",
  complete: "done",
  completed: "done",
  success: "done",
  succeeded: "done",
  finished: "done",
  cancelled: "cancelled",
  canceled: "cancelled",
  failed: "cancelled",
  error: "cancelled",
  skipped: "cancelled",
  stopped: "cancelled",
};

export function normalizeStepState(value: unknown): SafeStepState {
  if (typeof value === "string") return STATE_ALIASES[value.trim().toLowerCase()] ?? "pending";
  return "pending";
}

/**
 * Normalize a plan entry without mutating it.
 *
 * - label: label ?? description ?? title ?? text ?? name ?? "#N"
 * - state: state ?? status, unknown values become "pending"
 * - id: id if usable, otherwise a stable index-based fallback (deduped)
 * - steps not an array, or an empty step list with content: rawOnly + raw JSON
 */
export function planView(entry: PlanEntry): PlanView {
  const rawSteps = (entry as unknown as { steps?: unknown }).steps;
  const content = (entry as unknown as { content?: unknown }).content;

  if (!Array.isArray(rawSteps)) {
    // Prefer the activity content when present: it is the payload the brief
    // calls the "raw content" fallback. If there is none, show the malformed
    // steps value itself rather than nothing.
    const raw = content !== undefined && content !== null ? content : rawSteps;
    return { steps: [], rawOnly: raw !== undefined && raw !== null, raw };
  }

  if (rawSteps.length === 0) {
    const hasContent = content !== undefined && content !== null;
    return { steps: [], rawOnly: hasContent, raw: hasContent ? content : undefined };
  }

  const usedIds = new Set<string>();
  const steps: SafePlanStep[] = rawSteps.map((item, index) => {
    const record = asRecord(item);
    const labelCandidates = record
      ? [record.label, record.description, record.title, record.text, record.name]
      : [item];
    let label = "";
    for (const candidate of labelCandidates) {
      const text = displayText(candidate).trim();
      if (text) {
        label = text;
        break;
      }
    }
    // The index is the last resort: a missing/hidden label must not make the
    // step disappear or make `.toUpperCase()` crash in Brutalist.
    if (!label) label = `#${index + 1}`;

    const idValue = record?.id;
    const baseId =
      typeof idValue === "string" && idValue.trim()
        ? idValue.trim()
        : typeof idValue === "number" && Number.isFinite(idValue)
        ? String(idValue)
        : `step-${index}`;
    let id = baseId;
    let suffix = 1;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);

    const stateValue = record
      ? record.state !== undefined && record.state !== null && record.state !== ""
        ? record.state
        : record.status
      : undefined;
    return { id, label, state: normalizeStepState(stateValue) };
  });

  return { steps, rawOnly: false };
}

/** Raw JSON text for a non-demo plan/activity content fallback. */
export function planRawText(view: PlanView): string {
  return view.raw === undefined ? "" : safeJson(view.raw);
}
