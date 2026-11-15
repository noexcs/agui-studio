import { describe, expect, it, vi } from "vitest";
import { EventType } from "../src/core/events";
import { runErrorEvent, validateResumePayload, validateWireEvent } from "../src/core/validate";

/** P1-6: the wire boundary validates events against the official AG-UI schemas. */
describe("validateWireEvent", () => {
  it("accepts schema-conforming events", () => {
    expect(validateWireEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hi" })).toEqual({ ok: true });
    expect(validateWireEvent({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" })).toEqual({ ok: true });
    expect(validateWireEvent({ type: EventType.STATE_DELTA, delta: [{ op: "add", path: "/a", value: 1 }] })).toEqual({ ok: true });
  });

  it("keeps identity fields optional on run events (store resolves them)", () => {
    // Deliberate relaxation of the generated schema: threadId/runId may be
    // omitted; the store fills identity from its own session state.
    expect(validateWireEvent({ type: EventType.RUN_STARTED })).toEqual({ ok: true });
    expect(validateWireEvent({ type: EventType.RUN_FINISHED, outcome: { type: "success" } })).toEqual({ ok: true });
  });

  it("accepts a string timestamp alongside the spec's integer", () => {
    expect(validateWireEvent({ type: EventType.CUSTOM, name: "n", value: 1, timestamp: "2026-01-01T00:00:00Z" })).toEqual({ ok: true });
    expect(validateWireEvent({ type: EventType.CUSTOM, name: "n", value: 1, timestamp: 1763000000 })).toEqual({ ok: true });
  });

  it("rejects a recognized type with a malformed payload (would half-apply)", () => {
    const check = validateWireEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1" });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("TEXT_MESSAGE_CONTENT");
      expect(check.reason).toContain("delta");
    }

    const noId = validateWireEvent({ type: EventType.TEXT_MESSAGE_CONTENT, delta: "hi" });
    expect(noId.ok).toBe(false);

    const args = validateWireEvent({ type: EventType.TOOL_CALL_ARGS, toolCallId: "t1" });
    expect(args.ok).toBe(false);
  });

  it("tolerates extension event types from newer producers (warn + keep)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateWireEvent({ type: "FUTURE_EVENT", payload: { a: 1 } })).toEqual({ ok: true });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects frames whose type is present but not a protocol type string", () => {
    const check = validateWireEvent({ type: 42 });
    expect(check.ok).toBe(false);
  });

  it("builds the RUN_ERROR the boundary yields for a rejected event", () => {
    expect(runErrorEvent("why")).toEqual({ type: EventType.RUN_ERROR, message: "why" });
  });
});

/** The store's former hand-written mini JSON-Schema validator, now zod. */
describe("validateResumePayload", () => {
  const schema = {
    required: ["approved"],
    properties: {
      approved: { type: "boolean" },
      editedArgs: { type: "object" },
    },
  };

  it("accepts conforming payloads and passes undeclared keys through", () => {
    expect(validateResumePayload(schema, { approved: true })).toBe(true);
    expect(validateResumePayload(schema, { approved: false, editedArgs: { total: 10 } })).toBe(true);
    expect(validateResumePayload(schema, { approved: true, extra: "kept" })).toBe(true);
  });

  it("rejects missing required keys and wrong declared types", () => {
    expect(validateResumePayload(schema, {})).toBe(false);
    expect(validateResumePayload(schema, { approved: "yes" })).toBe(false);
    expect(validateResumePayload(schema, { approved: true, editedArgs: "not-an-object" })).toBe(false);
  });

  it("passes when the interrupt carries no responseSchema", () => {
    expect(validateResumePayload(undefined, {})).toBe(true);
  });

  it("accepts undeclared property types (same tolerance as before)", () => {
    expect(validateResumePayload({ properties: { weird: { type: "weird-type" } } }, { weird: [1] })).toBe(true);
  });
});
