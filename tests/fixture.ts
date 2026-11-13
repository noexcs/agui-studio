import { ConversationStore } from "../src/core/store";
import { EventType } from "../src/core/events";
import type { SkinConversation } from "agui-skins";

export const makeStore = () => new ConversationStore(false);

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
