import type { ToolStatus } from "../contract";

/**
 * Normalized tool lifecycle stage. Skins render their own visuals, but the
 * *meaning* of a status must not differ between skins (a previous review found
 * Paper rendering `error` as "executing"). Map once here, never branch on raw
 * ToolStatus membership in a skin.
 */
export type ToolStage = "streaming" | "running" | "interrupted" | "done" | "error";

export function toolStage(status: ToolStatus): ToolStage {
  switch (status) {
    case "args":
      return "streaming";
    case "executing":
      return "running";
    case "interrupted":
      return "interrupted";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      // forward-compatible: an unknown status must stay visibly "running"
      return "running";
  }
}
