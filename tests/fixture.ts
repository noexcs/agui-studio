import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import { createPiMapper } from "../server/pi-map.mjs";
import type { SkinConversation } from "agui-skins";

export const makeStore = () => new ConversationStore(false);

/* ── recorded playback: server/fixtures/pi-run.jsonl → mapper → store ── */

// Anchor on the vitest working directory (the repo root for `pnpm test`).
// import.meta.url is unusable here: under the jsdom environment vitest feeds
// `new URL(..., import.meta.url)` a root-less file:///tests/... base, which
// resolves sibling paths against "/". (Same rationale as tests/pi-map.test.ts.)
const repoPath = (...segments: string[]): string => {
  const resolved = join(process.cwd(), ...segments);
  if (!existsSync(resolved)) {
    throw new Error(`cannot locate ${segments.join("/")} from cwd ${process.cwd()} — run vitest from the repo root`);
  }
  return resolved;
};

/** threadId/runId stamped onto the replayed AG-UI events (arbitrary but stable). */
export const PLAYBACK_THREAD = "thread_playback";
export const PLAYBACK_RUN = "run_playback";

/** The untouched real pi recording. */
export function loadPiRecords(): any[] {
  return readFileSync(repoPath("server", "fixtures", "pi-run.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** Map recorded pi records to AG-UI events through one fresh mapper. */
export function mapPiRecords(
  records: any[],
  meta: { threadId: string; runId: string } = { threadId: PLAYBACK_THREAD, runId: PLAYBACK_RUN }
): any[] {
  const mapper = createPiMapper(meta);
  return records.flatMap((record) => mapper.map(record));
}

/**
 * The recorded user prompt. pi user messages produce no AG-UI events (the
 * mapper skips `message_start` records for non-assistant roles), so in
 * production the user entry is pushed client-side in ConversationStore.startPi.
 * The replay mirrors that instead of inventing a synthetic event.
 */
export function recordedUserPrompt(records: any[]): string {
  const start = records.find((record) => record?.type === "message_start" && record?.message?.role === "user");
  if (!start) throw new Error("pi-run.jsonl contains no user message_start record");
  return String(start.message.content ?? "");
}

export interface PiReplay {
  records: any[];
  events: any[];
  store: ConversationStore;
}

/** Full recorded pipeline: JSONL records → mapper → store dispatch, in order. */
export function replayPiFixture(): PiReplay {
  const records = loadPiRecords();
  const events = mapPiRecords(records);
  const store = makeStore();
  store.entries.push({ kind: "user", id: "user_recorded", text: recordedUserPrompt(records), at: Date.now() });
  for (const event of events) store.dispatch(event as never);
  return { records, events, store };
}

/** makeFixture's recorded twin: the real pi JSONL replayed into a live store,
 * ready to hand to any skin. Accepts the same overrides as makeFixture. */
export function makeRecordedFixture(overrides: Partial<SkinConversation> = {}): SkinConversation {
  return Object.assign(replayPiFixture().store as unknown as SkinConversation, overrides);
}

/**
 * Build the fixture the same way production does: dispatch a recorded AG-UI
 * event stream into ConversationStore, then hand the store to the skins.
 * This keeps reducer and UI on one path.
 */
export function makeFixture(overrides: Partial<SkinConversation> = {}): SkinConversation {
  const store = makeStore();
  const dispatch = (event: Record<string, unknown>) => store.dispatch(event as never);

  dispatch({
    type: EventType.MESSAGES_SNAPSHOT,
    messages: [
      { id: "u1", role: "user", content: "fixture user prompt" },
      {
        id: "a1",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "### fixture answer\n\n**fixture body** with a [fixture link](https://example.com).",
          },
        ],
        toolCalls: [
          {
            id: "tc1",
            type: "function",
            function: { name: "web.search", arguments: '{"query":"fixture"}' },
          },
        ],
      },
      {
        id: "t1",
        role: "tool",
        content: '{"results":[{"title":"fixture source one","url":"https://example.com/one"}]}',
        toolCallId: "tc1",
      },
    ],
  });

  dispatch({ type: EventType.REASONING_START, messageId: "r1" });
  dispatch({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: "r1", delta: "fixture reasoning about the request" });
  dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: "r1" });

  dispatch({ type: EventType.STATE_SNAPSHOT, snapshot: { trip: { budget: 800 }, itinerary: [1, 2, 3] } });

  dispatch({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: "plan1",
    activityType: "PLAN",
    content: {
      title: "fixture plan",
      steps: [
        { id: "s1", label: "fixture step one", state: "done" },
        { id: "s2", label: "fixture step two", state: "active" },
      ],
    },
  });
  dispatch({ type: EventType.ACTIVITY_DELTA, messageId: "plan1", patch: [{ op: "replace", path: "/steps/1/state", value: "done" }] });

  dispatch({ type: EventType.SUBAGENT_STARTED, subagentId: "sa1", name: "fixture subagent" });
  dispatch({ type: EventType.SUBAGENT_FINISHED, subagentId: "sa1" });

  dispatch({
    type: EventType.RUN_FINISHED,
    outcome: {
      type: "interrupt",
      interrupts: [
        {
          id: "i1",
          reason: "tool_call",
          message: "fixture approval needed",
          description: "fixture approval description",
          details: [{ label: "Total", value: "€332" }],
          toolCallId: "tc2",
          responseSchema: { type: "object", required: ["approved"], properties: { approved: { type: "boolean" } } },
        },
      ],
    },
  });

  return Object.assign(store as unknown as SkinConversation, overrides);
}
