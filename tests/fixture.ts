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
 * A transcript built for fold-group coverage: two reasoning blocks followed by
 * two tool calls, then an assistant reply. Variants: `leaveRunning` keeps the
 * last tool executing (group derives open), `failLastTool` fails the second
 * tool (header must surface the failure).
 */
export interface FoldStoreOptions {
  leaveRunning?: boolean;
  failLastTool?: boolean;
}

export function makeFoldStore(options: FoldStoreOptions = {}): ConversationStore {
  const store = makeStore();
  const dispatch = (event: Record<string, unknown>) => store.dispatch(event as never);
  dispatch({ type: EventType.RUN_STARTED, threadId: "t_fold", runId: "r_fold" });
  for (const [id, text] of [
    ["fr1", "thinking about the trip"],
    ["fr2", "narrowing the dates"],
  ] as const) {
    dispatch({ type: EventType.REASONING_START, messageId: id });
    dispatch({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: id, delta: text });
    dispatch({ type: EventType.REASONING_MESSAGE_END, messageId: id });
  }
  dispatch({ type: EventType.TOOL_CALL_START, toolCallId: "ft1", toolCallName: "booking.hold" });
  dispatch({ type: EventType.TOOL_CALL_ARGS, toolCallId: "ft1", delta: '{"city":"Lisbon"}' });
  dispatch({ type: EventType.TOOL_CALL_END, toolCallId: "ft1" });
  dispatch({ type: EventType.TOOL_CALL_RESULT, toolCallId: "ft1", content: '{"ok":true}' });
  dispatch({ type: EventType.TOOL_CALL_START, toolCallId: "ft2", toolCallName: "web.search" });
  dispatch({ type: EventType.TOOL_CALL_ARGS, toolCallId: "ft2", delta: '{"q":"lisbon"}' });
  if (options.leaveRunning) return store; // still executing → the group is in flight
  dispatch({ type: EventType.TOOL_CALL_END, toolCallId: "ft2" });
  dispatch(
    options.failLastTool
      ? { type: EventType.TOOL_CALL_RESULT, toolCallId: "ft2", content: '{"error":"backend down"}' }
      : { type: EventType.TOOL_CALL_RESULT, toolCallId: "ft2", content: '{"ok":true}' }
  );
  dispatch({ type: EventType.TEXT_MESSAGE_START, messageId: "fa1", role: "assistant" });
  dispatch({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "fa1", delta: "All set — the trip is booked." });
  dispatch({ type: EventType.TEXT_MESSAGE_END, messageId: "fa1" });
  dispatch({ type: EventType.RUN_FINISHED, outcome: {} });
  return store;
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
    metadata: { traceId: "fixture-trace", model: "fixture-model" },
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

  dispatch({ type: EventType.STEP_STARTED, stepName: "fixture step" });
  dispatch({ type: EventType.STEP_FINISHED, stepName: "fixture step" });

  dispatch({ type: EventType.SUBAGENT_STARTED, subagentId: "sa1", name: "fixture subagent" });
  dispatch({ type: EventType.SUBAGENT_FINISHED, subagentId: "sa1" });

  dispatch({ type: EventType.CUSTOM, name: "handoff", value: { fixture: true } });

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
