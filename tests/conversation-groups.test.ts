import { describe, expect, it } from "vitest";
import { conversationGroups, foldGroupDuration, foldGroupFailures, foldGroupOpen, foldGroupStats } from "agui-skins";
import type { Entry, ReasoningEntry, ToolEntry } from "../packages/agui-skins/src/contract";

/* conversationGroups — the shared fold-group pure function.
   Boundaries: runs at both ends, kind alternation, singletons, all-foldable
   transcripts, interruption/error membership, cut kinds, derived defaults. ── */

const user = (id: string): Entry => ({ kind: "user", id, at: 1, text: id });
const assistant = (id: string): Entry => ({ kind: "assistant", id, at: 1, text: id, streaming: false });
const reasoning = (id: string, overrides: Partial<ReasoningEntry> = {}): ReasoningEntry => ({
  kind: "reasoning",
  id,
  at: 1,
  text: "thinking",
  streaming: false,
  tokens: 3,
  ...overrides,
});
const tool = (id: string, overrides: Partial<ToolEntry> = {}): ToolEntry => ({
  kind: "tool",
  id,
  at: 1,
  name: `tool.${id}`,
  argsRaw: "{}",
  args: {},
  status: "done",
  ...overrides,
});

describe("conversationGroups grouping", () => {
  it("keeps a non-foldable-only transcript untouched", () => {
    const entries = [user("u1"), assistant("a1"), user("u2")];
    expect(conversationGroups(entries)).toEqual(entries.map((entry) => ({ type: "entry", entry })));
  });

  it("groups runs at the start and at the end of the list", () => {
    const entries = [reasoning("r1"), tool("t1"), user("u1"), tool("t2"), reasoning("r2")];
    const items = conversationGroups(entries);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ type: "group", id: "g-r1" });
    expect(items[1]).toMatchObject({ type: "entry", entry: entries[2] });
    expect(items[2]).toMatchObject({ type: "group", id: "g-t2" });
    expect((items[0] as { entries: Entry[] }).entries).toEqual([entries[0], entries[1]]);
    expect((items[2] as { entries: Entry[] }).entries).toEqual([entries[3], entries[4]]);
  });

  it("merges alternating reasoning/tool into one group", () => {
    const entries = [reasoning("r1"), tool("t1"), reasoning("r2"), tool("t2"), reasoning("r3")];
    const items = conversationGroups(entries);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "group", id: "g-r1" });
    expect((items[0] as { entries: Entry[] }).entries).toHaveLength(5);
  });

  it("keeps singletons ungrouped (≥2 rule)", () => {
    const entries = [user("u1"), tool("t1"), assistant("a1")];
    const items = conversationGroups(entries);
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({ type: "entry", entry: entries[1] });
  });

  it("groups an entirely foldable transcript into one group", () => {
    const entries = [reasoning("r1"), tool("t1"), tool("t2"), reasoning("r2")];
    const items = conversationGroups(entries);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "group", id: "g-r1" });
  });

  it("every other kind cuts the run (assistant/plan/interrupt/subagent/step/custom)", () => {
    const plan = { kind: "plan", id: "p1", at: 1, title: "plan", activityType: "PLAN", steps: [] } as Entry;
    const interrupt = { kind: "interrupt", id: "i1", at: 1, message: "m", details: [], reason: "r", status: "pending" } as Entry;
    const step = { kind: "step", id: "s1", at: 1, name: "step", status: "done" } as Entry;
    const custom = { kind: "custom", id: "c1", at: 1, name: "custom", value: {} } as Entry;
    const subagent = { kind: "subagent", id: "sa1", at: 1, name: "sub", status: "done" } as Entry;
    for (const cut of [assistant("a"), plan, interrupt, step, custom, subagent]) {
      const items = conversationGroups([tool("t1"), cut, tool("t2")]);
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({ type: "entry" });
      expect(items[2]).toMatchObject({ type: "entry" });
    }
  });

  it("error-kind entries never join a group and cut it (errors stay visible)", () => {
    const error = { kind: "error", id: "e1", at: 1, message: "boom" } as Entry;
    const items = conversationGroups([reasoning("r1"), error, tool("t1"), tool("t2")]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ type: "entry", entry: { kind: "reasoning" } });
    expect(items[1]).toMatchObject({ type: "entry", entry: { kind: "error" } });
    expect(items[2]).toMatchObject({ type: "group", id: "g-t1" });
  });

  it("a failed or interrupted tool still belongs to its group (header must surface it)", () => {
    const entries = [tool("t1", { status: "error", error: "boom" }), tool("t2", { status: "interrupted" })];
    const items = conversationGroups(entries);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "group", id: "g-t1" });
  });

  it("derives stable group ids from the first member id (window-slide safe, replay-reset)", () => {
    const run = [reasoning("r9"), tool("t9")];
    const whole = conversationGroups([user("u1"), ...run]);
    const windowed = conversationGroups(run);
    expect(whole[1]).toMatchObject({ type: "group", id: "g-r9" });
    expect(windowed[0]).toMatchObject({ type: "group", id: "g-r9" }); // id survives windowing
    const replayed = conversationGroups([reasoning("r10"), tool("t10")]); // replay mints new entry ids
    expect(replayed[0]).toMatchObject({ type: "group", id: "g-r10" });
  });
});

describe("foldGroupOpen (derived default)", () => {
  it("folds when every member reached a terminal state", () => {
    expect(foldGroupOpen([reasoning("r1"), tool("t1"), tool("t2")])).toBe(false);
    expect(foldGroupOpen([tool("t1", { status: "error" })])).toBe(false);
    expect(foldGroupOpen([tool("t1", { status: "interrupted" })])).toBe(false);
  });

  it("opens while any member is still streaming/args/executing", () => {
    expect(foldGroupOpen([reasoning("r1", { streaming: true })])).toBe(true);
    expect(foldGroupOpen([tool("t1", { status: "args" }), tool("t2")])).toBe(true);
    expect(foldGroupOpen([tool("t1"), tool("t2", { status: "executing" })])).toBe(true);
  });

  it("treats an unknown forward-compatible tool status as in flight", () => {
    expect(foldGroupOpen([tool("t1", { status: "future" as never })])).toBe(true);
  });
});

describe("foldGroupFailures / foldGroupStats / foldGroupDuration", () => {
  it("reports error and interrupted markers for the fold header", () => {
    expect(foldGroupFailures([tool("t1"), tool("t2")])).toEqual([]);
    expect(foldGroupFailures([tool("t1", { status: "error" })])).toEqual(["error"]);
    expect(foldGroupFailures([tool("t1", { status: "interrupted" })])).toEqual(["interrupted"]);
    expect(foldGroupFailures([tool("t1", { status: "interrupted" }), tool("t2", { status: "error" })])).toEqual([
      "error",
      "interrupted",
    ]);
    expect(foldGroupFailures([reasoning("r1")])).toEqual([]); // reasoning never fails
  });

  it("summarizes thinking count and ordered tool names", () => {
    expect(foldGroupStats([reasoning("r1"), tool("t1"), tool("t2"), reasoning("r2")])).toEqual({
      reasoningCount: 2,
      toolCount: 2,
      toolNames: ["tool.t1", "tool.t2"],
    });
  });

  it("sums member durations only when at least one is reported", () => {
    expect(foldGroupDuration([reasoning("r1"), tool("t1")])).toBeUndefined();
    expect(foldGroupDuration([reasoning("r1", { durationMs: 300 }), tool("t1", { durationMs: 900 })])).toBe(1200);
    expect(foldGroupDuration([tool("t1", { durationMs: 0 })])).toBeUndefined(); // zero is "no data"
  });
});
