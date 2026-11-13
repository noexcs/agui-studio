/**
 * pi (github.com/earendil-works/pi) → AG-UI event mapping.
 *
 * pi emits JSONL session events in RPC / JSON mode:
 *   agent_start, turn_start, message_start, message_update{assistantMessageEvent},
 *   tool_execution_*, message_end, turn_end, agent_end, agent_settled, …
 * AG-UI needs a typed event stream with explicit message/tool lifecycles.
 * This module is the only place that knows both protocols.
 *
 * Pure + dependency-free so the bridge (Node) and the browser can share it.
 */

const E = {
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  STEP_STARTED: "STEP_STARTED",
  STEP_FINISHED: "STEP_FINISHED",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  TOOL_CALL_START: "TOOL_CALL_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",
  TOOL_CALL_RESULT: "TOOL_CALL_RESULT",
  REASONING_START: "REASONING_START",
  REASONING_MESSAGE_START: "REASONING_MESSAGE_START",
  REASONING_MESSAGE_CONTENT: "REASONING_MESSAGE_CONTENT",
  REASONING_MESSAGE_END: "REASONING_MESSAGE_END",
  REASONING_END: "REASONING_END",
  STATE_SNAPSHOT: "STATE_SNAPSHOT",
  CUSTOM: "CUSTOM",
};

export function createPiMapper({ threadId, runId }) {
  const openText = new Set();
  const openThinking = new Set();
  const tools = new Set();
  let turn = 0;
  const stamp = () => new Date().toISOString();
  const base = (type, extra = {}) => ({ type, timestamp: stamp(), threadId, runId, ...extra });
  const textId = (index) => `pi_msg_${turn}_text_${index}`;
  const thinkId = (index) => `pi_msg_${turn}_think_${index}`;

  /** @param {any} record a pi JSONL record @returns {any[]} AG-UI events */
  function map(record) {
    const out = [];
    switch (record.type) {
      case "agent_start":
        out.push(base(E.RUN_STARTED));
        break;

      case "turn_start":
        turn += 1;
        out.push(base(E.STEP_STARTED, { stepName: `turn ${turn}` }));
        break;

      case "message_start":
        if (record.message?.role === "assistant") {
          out.push(base(E.CUSTOM, { name: "pi.message_start", value: { turn } }));
        }
        break;

      case "message_update": {
        const update = record.assistantMessageEvent || {};
        const index = update.contentIndex ?? 0;
        switch (update.type) {
          case "text_start":
            openText.add(index);
            out.push(base(E.TEXT_MESSAGE_START, { messageId: textId(index), role: "assistant" }));
            break;
          case "text_delta":
            out.push(base(E.TEXT_MESSAGE_CONTENT, { messageId: textId(index), delta: update.delta || "" }));
            break;
          case "text_end":
            openText.delete(index);
            out.push(base(E.TEXT_MESSAGE_END, { messageId: textId(index) }));
            break;
          case "thinking_start":
            openThinking.add(index);
            out.push(base(E.REASONING_START, { messageId: thinkId(index) }));
            out.push(base(E.REASONING_MESSAGE_START, { messageId: thinkId(index), role: "reasoning" }));
            break;
          case "thinking_delta":
            out.push(base(E.REASONING_MESSAGE_CONTENT, { messageId: thinkId(index), delta: update.delta || "" }));
            break;
          case "thinking_end":
            openThinking.delete(index);
            out.push(base(E.REASONING_MESSAGE_END, { messageId: thinkId(index) }));
            out.push(base(E.REASONING_END, { messageId: thinkId(index) }));
            break;
          case "toolcall_start":
            tools.add(update.id);
            out.push(base(E.TOOL_CALL_START, { toolCallId: update.id, toolCallName: update.toolName || "tool" }));
            break;
          case "toolcall_delta":
            out.push(base(E.TOOL_CALL_ARGS, { toolCallId: update.id, delta: update.delta || "" }));
            break;
          case "toolcall_end":
            tools.add(update.toolCall?.id);
            out.push(base(E.TOOL_CALL_END, { toolCallId: update.toolCall?.id }));
            break;
          case "error":
            out.push(base(E.RUN_ERROR, { message: update.error || update.reason || "provider stream error" }));
            break;
          default:
            break;
        }
        break;
      }

      case "tool_execution_start": {
        // pi can execute a tool without a streamed toolcall block (e.g. extension tools)
        if (!tools.has(record.toolCallId)) {
          tools.add(record.toolCallId);
          out.push(base(E.TOOL_CALL_START, { toolCallId: record.toolCallId, toolCallName: record.toolName }));
          out.push(base(E.TOOL_CALL_ARGS, { toolCallId: record.toolCallId, delta: JSON.stringify(record.args ?? {}) }));
          out.push(base(E.TOOL_CALL_END, { toolCallId: record.toolCallId }));
        }
        out.push(base(E.STEP_STARTED, { stepName: record.toolName }));
        break;
      }

      case "tool_execution_update":
        out.push(
          base(E.CUSTOM, {
            name: "pi.tool_progress",
            value: { toolCallId: record.toolCallId, partialResult: record.partialResult },
          })
        );
        break;

      case "tool_execution_end": {
        tools.delete(record.toolCallId);
        out.push(
          base(E.TOOL_CALL_RESULT, {
            messageId: `pi_tool_${record.toolCallId}`,
            role: "tool",
            toolCallId: record.toolCallId,
            content: JSON.stringify(record.result ?? (record.isError ? { error: "tool failed" } : {})),
          })
        );
        out.push(base(E.STEP_FINISHED, { stepName: record.toolName }));
        break;
      }

      case "message_end": {
        const message = record.message || {};
        if (message.role === "assistant") {
          // close any blocks the provider left open
          for (const index of openText) out.push(base(E.TEXT_MESSAGE_END, { messageId: textId(index) }));
          for (const index of openThinking) {
            out.push(base(E.REASONING_MESSAGE_END, { messageId: thinkId(index) }));
            out.push(base(E.REASONING_END, { messageId: thinkId(index) }));
          }
          openText.clear();
          openThinking.clear();
          if (record.usage) {
            out.push(base(E.CUSTOM, { name: "usage", value: record.usage }));
          }
        }
        break;
      }

      case "turn_end":
        out.push(base(E.STEP_FINISHED, { stepName: `turn ${turn}` }));
        if (record.message?.usage) out.push(base(E.CUSTOM, { name: "usage", value: record.message.usage }));
        break;

      case "agent_settled":
        out.push(base(E.STEP_FINISHED, { stepName: `turn ${turn}` }));
        out.push(base(E.RUN_FINISHED, { outcome: { type: record.aborted ? "stopped" : "success" } }));
        break;

      case "auto_retry_start":
        out.push(base(E.CUSTOM, { name: "pi.retry", value: record }));
        break;

      case "compaction_end":
        out.push(base(E.CUSTOM, { name: "pi.compaction", value: record.result || { aborted: record.aborted } }));
        break;

      case "extension_error":
        out.push(base(E.CUSTOM, { name: "pi.extension_error", value: record }));
        break;

      case "error":
        out.push(base(E.RUN_ERROR, { message: record.message || "pi error" }));
        break;

      default:
        break;
    }
    return out;
  }

  return { map };
}

/** pi `get_state` response data → an AG-UI STATE_SNAPSHOT the skins understand. */
export function stateSnapshotFromPi(state, { threadId, runId }) {
  const data = state && typeof state === "object" ? state : {};
  return {
    type: E.STATE_SNAPSHOT,
    timestamp: new Date().toISOString(),
    threadId,
    runId,
    snapshot: {
      agent: {
        name: data.name || "pi",
        model: data.model || data.modelName || "pi agent",
        sessionId: data.sessionId || data.session?.id || threadId,
      },
      tools: data.tools || [],
      thinking: data.thinkingLevel || "off",
      cwd: data.cwd || "",
      usage: data.usage || {},
    },
  };
}
