import type { Entry, ReasoningEntry, ToolEntry } from "../contract";
import { toolStage } from "./toolStatus";

/**
 * Fold groups for consecutive reasoning + tool entries.
 *
 * Shared layer provides DATA ONLY (the contract/injection discipline): each
 * skin renders the fold header in its own visual language and reuses its
 * existing per-entry rendering inside the group body.
 */

/** One rendered slot of a transcript that supports fold groups. */
export type ConversationItem =
  | { type: "entry"; entry: Entry }
  | { type: "group"; id: string; entries: Entry[] };

type FoldableEntry = ReasoningEntry | ToolEntry;

function isFoldable(entry: Entry): entry is FoldableEntry {
  return entry.kind === "reasoning" || entry.kind === "tool";
}

/** A reasoning entry is in flight while streaming; a tool while args/executing. */
function inFlight(entry: FoldableEntry): boolean {
  if (entry.kind === "reasoning") return entry.streaming;
  const stage = toolStage(entry.status);
  return stage === "streaming" || stage === "running";
}

/**
 * Aggregate adjacent reasoning/tool entries into fold groups.
 *
 * - ≥2 adjacent foldable entries form a group; a single one stays a plain entry;
 * - any other kind (user/assistant/plan/interrupt/error/subagent/step/custom)
 *   cuts the run — error rows stay independent and visible;
 * - a tool with status "error" is still kind "tool" and stays in its group, so
 *   the run's header can surface the failure instead of hiding it;
 * - group ids derive from the first member's entry id: stable across "show
 *   earlier" window slides and naturally reset after a replay.
 */
export function conversationGroups(entries: Entry[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  let run: FoldableEntry[] = [];

  const flush = () => {
    if (run.length >= 2) {
      items.push({ type: "group", id: `g-${run[0].id}`, entries: run });
    } else {
      for (const entry of run) items.push({ type: "entry", entry });
    }
    run = [];
  };

  for (const entry of entries) {
    if (isFoldable(entry)) {
      run.push(entry);
    } else {
      flush();
      items.push({ type: "entry", entry });
    }
  }
  flush();
  return items;
}

/**
 * Deterministic fold default: open while any member is still working, folded
 * once everything reached a terminal state (done/error/interrupted). Skins
 * combine it with a per-group user override: `override ?? foldGroupOpen(…)`.
 */
export function foldGroupOpen(entries: Entry[]): boolean {
  return entries.some((entry) => isFoldable(entry) && inFlight(entry));
}

export type FoldFailure = "error" | "interrupted";

/** Failure markers a fold header must surface (never hide a broken tool). */
export function foldGroupFailures(entries: Entry[]): FoldFailure[] {
  const failures: FoldFailure[] = [];
  if (entries.some((entry) => entry.kind === "tool" && toolStage(entry.status) === "error")) {
    failures.push("error");
  }
  if (entries.some((entry) => entry.kind === "tool" && toolStage(entry.status) === "interrupted")) {
    failures.push("interrupted");
  }
  return failures;
}

/** Summary pieces for a fold header: thinking count + tool names in order. */
export function foldGroupStats(entries: Entry[]): {
  reasoningCount: number;
  toolCount: number;
  toolNames: string[];
} {
  let reasoningCount = 0;
  const toolNames: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "reasoning") reasoningCount += 1;
    else if (entry.kind === "tool") toolNames.push(entry.name);
  }
  return { reasoningCount, toolCount: toolNames.length, toolNames };
}

/** Summed member duration when the stream reports one (numeric fold headers). */
export function foldGroupDuration(entries: Entry[]): number | undefined {
  let total = 0;
  let any = false;
  for (const entry of entries) {
    const duration = entry.kind === "tool" || entry.kind === "reasoning" ? entry.durationMs : undefined;
    if (typeof duration === "number" && duration > 0) {
      total += duration;
      any = true;
    }
  }
  return any ? total : undefined;
}
