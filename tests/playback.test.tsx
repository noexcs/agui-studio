import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import { createPiMapper } from "../server/pi-map.mjs";
import type { AssistantEntry, ReasoningEntry, ToolEntry, UserEntry } from "../src/core/store";
import {
  loadPiRecords,
  makeRecordedFixture,
  makeStore,
  PLAYBACK_RUN,
  PLAYBACK_THREAD,
  recordedUserPrompt,
  replayPiFixture,
} from "./fixture";

afterEach(cleanup);

/* ───────────────────────────────────────────────────────────────────────
   Recorded playback, end to end:

     server/fixtures/pi-run.jsonl → createPiMapper().map(record)
       → AG-UI events → ConversationStore.dispatch → view model → skin

   Every expectation is extracted from the recording itself, so the JSONL
   and the assertions cannot drift apart (no double bookkeeping).
   ──────────────────────────────────────────────────────────────────── */

const RECORDS = loadPiRecords();

/** pi `message_update` assistant events of one kind, in recorded order. */
const updates = (type: string): any[] =>
  RECORDS.filter((record) => record?.type === "message_update" && record?.assistantMessageEvent?.type === type).map(
    (record) => record.assistantMessageEvent
  );

const REPLY = updates("text_delta").map((event) => event.delta).join("");
const THINKING = updates("thinking_delta").map((event) => event.delta).join("");
const USER_PROMPT = recordedUserPrompt(RECORDS);
const TOOLCALL_START = updates("toolcall_start")[0];
const TOOLCALL_END = updates("toolcall_end")[0];
const TOOL_EXECUTION_END = RECORDS.find((record) => record?.type === "tool_execution_end");
const EXPECTED_TOOL_ID = String(TOOLCALL_START?.id ?? "");
const EXPECTED_TOOL_NAME = String(TOOLCALL_START?.toolName ?? "");
const EXPECTED_ARGS_RAW = String(TOOLCALL_END?.toolCall?.function?.arguments ?? "");
const EXPECTED_RESULT = TOOL_EXECUTION_END?.result;

describe("recorded fixture sanity", () => {
  it("pi-run.jsonl carries everything the playback assertions extract", () => {
    expect(USER_PROMPT).toBeTruthy();
    expect(REPLY.length).toBeGreaterThan(0);
    expect(THINKING.length).toBeGreaterThan(0);
    expect(EXPECTED_TOOL_ID).toBeTruthy();
    expect(EXPECTED_TOOL_NAME).toBeTruthy();
    expect(EXPECTED_ARGS_RAW).toBeTruthy();
    expect(() => JSON.parse(EXPECTED_ARGS_RAW)).not.toThrow();
    expect(EXPECTED_RESULT).toBeTruthy();
  });
});

describe("recorded playback pipeline (pi-run.jsonl → createPiMapper → store)", () => {
  it("maps every JSONL record and dispatches the resulting events in order", () => {
    // the raw chain, exactly as bridge + studio run it: no shortcuts
    const mapper = createPiMapper({ threadId: PLAYBACK_THREAD, runId: PLAYBACK_RUN });
    const events: any[] = [];
    for (const record of RECORDS) events.push(...mapper.map(record));
    expect(events.length).toBeGreaterThan(0);

    const store = makeStore();
    for (const event of events) store.dispatch(event as never);

    // every mapped event landed in the store's log, in the mapped order
    expect(store.events.map((logged) => logged.event.type)).toEqual(events.map((event) => event.type));
    // the mapper stamps thread/run ids on everything it emits
    for (const event of events) {
      expect(event.threadId).toBe(PLAYBACK_THREAD);
      expect(event.runId).toBe(PLAYBACK_RUN);
    }

    // run lifecycle: opens with RUN_STARTED, closes with a successful RUN_FINISHED
    expect(store.events[0].event.type).toBe("RUN_STARTED");
    const last = store.events[store.events.length - 1].event;
    expect(last.type).toBe("RUN_FINISHED");
    expect(last.outcome).toEqual({ type: "success" });
    expect(events.some((event) => event.type === "RUN_ERROR")).toBe(false);

    // run bookkeeping in the store
    expect(store.status).toBe("done");
    expect(store.runId).toBe(PLAYBACK_RUN);
    expect(store.startedAt).toBeGreaterThan(0);
    expect(store.endedAt).toBeGreaterThanOrEqual(store.startedAt);
  });
});

describe("recorded playback store view model", () => {
  it("lands the recorded user message as the conversation's user entry", () => {
    const { store } = replayPiFixture();
    const userEntries = store.entries.filter((entry): entry is UserEntry => entry.kind === "user");
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0].text).toBe(USER_PROMPT);
  });

  it("accumulates TEXT_MESSAGE_CONTENT deltas into the assistant's full reply", () => {
    const { events, store } = replayPiFixture();
    const assistantEntries = store.entries.filter((entry): entry is AssistantEntry => entry.kind === "assistant");

    // the joined entry text is exactly the joined recorded text deltas
    expect(assistantEntries.map((entry) => entry.text).join("")).toBe(REPLY);
    // one entry per streamed message block, and every block got closed
    expect(assistantEntries).toHaveLength(events.filter((event) => event.type === "TEXT_MESSAGE_START").length);
    for (const entry of assistantEntries) expect(entry.streaming).toBe(false);

    // the usage CUSTOM events fed the token counter too
    expect(store.tokens).toBeGreaterThan(0);
  });

  it("accumulates the recorded thinking deltas into one closed reasoning entry", () => {
    const { store } = replayPiFixture();
    const reasoningEntries = store.entries.filter((entry): entry is ReasoningEntry => entry.kind === "reasoning");
    expect(reasoningEntries).toHaveLength(1);
    expect(reasoningEntries[0].text).toBe(THINKING);
    expect(reasoningEntries[0].streaming).toBe(false);
  });

  it("builds one completed tool entry from the recorded tool-call lifecycle", () => {
    const { store } = replayPiFixture();
    const toolEntries = store.entries.filter((entry): entry is ToolEntry => entry.kind === "tool");
    expect(toolEntries).toHaveLength(1);

    const tool = toolEntries[0];
    expect(tool.id).toBe(EXPECTED_TOOL_ID);
    expect(tool.name).toBe(EXPECTED_TOOL_NAME);
    expect(tool.argsRaw).toBe(EXPECTED_ARGS_RAW);
    expect(tool.args).toEqual(JSON.parse(EXPECTED_ARGS_RAW));
    expect(tool.status).toBe("done");
    expect(tool.error).toBeUndefined();
    expect(tool.result).toEqual(EXPECTED_RESULT);
  });

  it("leaves no orphan tool calls (every START has its END and RESULT)", () => {
    const { events, store } = replayPiFixture();
    const idsOf = (type: string) =>
      new Set(events.filter((event) => event.type === type).map((event) => String(event.toolCallId)));

    const started = [...idsOf("TOOL_CALL_START")];
    expect(started.length).toBeGreaterThan(0);
    for (const id of started) {
      expect(idsOf("TOOL_CALL_END").has(id)).toBe(true);
      expect(idsOf("TOOL_CALL_RESULT").has(id)).toBe(true);
    }

    // the view model agrees: no tool entry left in args/executing
    for (const entry of store.entries) {
      if (entry.kind !== "tool") continue;
      expect(entry.status).toBe("done");
      expect(entry.result).toBeDefined();
    }
  });
});

describe("recorded playback through a real skin (classic)", () => {
  const BRANDING = { agentName: "Playback Agent", modelLabel: "pi · recorded session" };

  it("renders the replayed user prompt, assistant reply and tool card", () => {
    const ClassicPage = skins.find((skin) => skin.id === "classic")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={makeRecordedFixture()} lang="zh" branding={BRANDING}>
        <ClassicPage />
      </SkinHostProvider>
    );
    const text = container.textContent ?? "";

    // user message, verbatim from the recording
    expect(text).toContain(USER_PROMPT);
    // assistant reply, derived from the recorded deltas (markdown chars stripped)
    const firstLine = REPLY.split("\n")[0].replace(/[`*_]/g, "").trim();
    expect(text).toContain(firstLine);
    const closingLine = REPLY.split("\n").pop()!.trim();
    expect(text).toContain(closingLine);

    // tool card: name in the collapsed head, args revealed on click
    const head = container.querySelector(".cl-tool-head");
    expect(head).toBeTruthy();
    expect(container.querySelector(".cl-tool-name")?.textContent).toBe(EXPECTED_TOOL_NAME);
    expect(container.querySelector(".cl-tool-args")).toBeNull(); // collapsed at first
    fireEvent.click(head!);
    expect(container.querySelector(".cl-tool-args")?.textContent).toBe(EXPECTED_ARGS_RAW);
  });
});
