import type { Entry, InterruptEntry } from "../contract";

/** All interrupts that still need a decision (parallel interrupt support). */
export function pendingInterrupts(entries: Entry[]): InterruptEntry[] {
  return entries.filter(
    (entry): entry is InterruptEntry => entry.kind === "interrupt" && entry.status === "pending"
  );
}

/** The oldest pending interrupt, used by single-decision surfaces. */
export function firstPendingInterrupt(entries: Entry[]): InterruptEntry | undefined {
  return pendingInterrupts(entries)[0];
}
