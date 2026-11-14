/**
 * OpenAI-compatible streaming chunks → AG-UI event bodies.
 *
 * Pure state machine (no network): the bridge feeds it parsed DeepSeek chunks
 * and forwards the returned events over SSE. Kept separate so the mapping can
 * be unit-tested against recorded chunk shapes (see tests/deepseek-map.test.ts).
 */
export function createDeepseekMapper({ threadId, runId, idPrefix = "ds" }) {
  const messages = new Map();
  let reasoning = { id: `rsn_${idPrefix}`, open: false, started: false };
  let text = { id: `msg_${idPrefix}`, open: false };
  const toolCalls = new Map();
  let textOut = "";
  let reasoningOut = "";
  let usage = null;

  const base = (type, extra = {}) => ({ type, threadId, runId, timestamp: new Date().toISOString(), ...extra });

  function closeReasoning(events) {
    if (!reasoning.open) return;
    reasoning.open = false;
    events.push(base("REASONING_MESSAGE_END", { messageId: reasoning.id }));
    events.push(base("REASONING_END", { messageId: reasoning.id }));
  }
  function closeText(events) {
    if (!text.open) return;
    text.open = false;
    events.push(base("TEXT_MESSAGE_END", { messageId: text.id }));
  }

  return {
    /** @param {any} chunk one parsed `data:` JSON payload */
    mapChunk(chunk) {
      const events = [];
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta ?? {};

      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        if (!reasoning.started) {
          reasoning.started = true;
          events.push(base("REASONING_START", { messageId: reasoning.id }));
          events.push(base("REASONING_MESSAGE_START", { messageId: reasoning.id, role: "reasoning" }));
        }
        reasoning.open = true;
        reasoningOut += delta.reasoning_content;
        events.push(base("REASONING_MESSAGE_CONTENT", { messageId: reasoning.id, delta: delta.reasoning_content }));
      }

      if (typeof delta.content === "string" && delta.content) {
        closeReasoning(events);
        if (!text.open) {
          text.open = true;
          events.push(base("TEXT_MESSAGE_START", { messageId: text.id, role: "assistant" }));
        }
        textOut += delta.content;
        events.push(base("TEXT_MESSAGE_CONTENT", { messageId: text.id, delta: delta.content }));
      }

      if (Array.isArray(delta.tool_calls)) {
        closeReasoning(events);
        closeText(events);
        for (const call of delta.tool_calls) {
          const index = call.index ?? 0;
          let state = toolCalls.get(index);
          if (!state) {
            state = { id: call.id || `call_${idPrefix}_${index}`, name: "", args: "", started: false, ended: false };
            toolCalls.set(index, state);
          }
          if (call.id) state.id = call.id;
          if (call.function?.name) state.name += call.function.name;
          if (!state.started && state.name) {
            state.started = true;
            events.push(base("TOOL_CALL_START", { toolCallId: state.id, toolCallName: state.name }));
          }
          if (typeof call.function?.arguments === "string" && call.function.arguments) {
            state.args += call.function.arguments;
            if (state.started) {
              events.push(base("TOOL_CALL_ARGS", { toolCallId: state.id, delta: call.function.arguments }));
            }
          }
        }
      }

      if (choice?.finish_reason) {
        closeReasoning(events);
        closeText(events);
        for (const state of toolCalls.values()) {
          if (state.started && !state.ended) {
            state.ended = true;
            events.push(base("TOOL_CALL_END", { toolCallId: state.id }));
          }
        }
        if (chunk.usage) {
          usage = chunk.usage;
          events.push(base("CUSTOM", { name: "usage", value: chunk.usage }));
        }
      }

      return events;
    },

    /** Close anything still open (upstream may omit finish_reason). */
    finish() {
      const events = [];
      closeReasoning(events);
      closeText(events);
      for (const state of toolCalls.values()) {
        if (state.started && !state.ended) {
          state.ended = true;
          events.push(base("TOOL_CALL_END", { toolCallId: state.id }));
        }
      }
      return events;
    },

    /** Tool calls in call order, with accumulated name/args. */
    toolCalls() {
      return [...toolCalls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, state]) => ({ id: state.id, name: state.name, args: state.args }));
    },

    text() {
      return textOut;
    },
    reasoning() {
      return reasoningOut;
    },
    usage() {
      return usage;
    },
  };
}
