import { beforeEach, describe, expect, it } from "vitest";
import { setLang, t } from "agui-skins";
import type { Entry, InterruptEntry, ToolEntry } from "agui-skins";
import {
  LIVE_TAIL_MAX,
  TUNNEL,
  approvalState,
  buildSceneModel,
  cleanForScene,
  planLiveTail,
  sceneActions,
  splitForMesh,
  toolStatusLabel,
} from "../packages/agui-skins/src/skins/orbit/sceneModel";
import { makeFixture } from "./fixture";

const tr = (key: string) => t(key as never);

beforeEach(() => {
  setLang("zh");
});

const toolEntry = (status: ToolEntry["status"]): ToolEntry => ({
  id: `tool-${status}`,
  at: 1,
  kind: "tool",
  name: "web.search",
  argsRaw: '{"q":"x"}',
  args: { q: "x" },
  status,
});

const interruptEntry = (overrides: Partial<InterruptEntry> = {}): InterruptEntry => ({
  id: "i1",
  at: 2,
  kind: "interrupt",
  message: "fixture approval",
  details: [{ label: "Total", value: "€332" }],
  reason: "tool_call",
  status: "pending",
  ...overrides,
});

const modelOf = (entries: Entry[], extra: Partial<Parameters<typeof buildSceneModel>[1]> = {}) =>
  buildSceneModel(entries, { tr, ...extra });

describe("orbit scene model — entry → mesh declaration", () => {
  it("maps every fixture entry kind to a tunnel station", () => {
    const model = modelOf(makeFixture().entries);
    const kinds = new Set(model.nodes.map((node) => node.kind));
    for (const kind of ["user", "assistant", "reasoning", "tool", "plan", "step", "subagent", "custom", "interrupt"] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
    // deterministic station ids derive from entry ids
    expect(model.nodes.find((node) => node.kind === "assistant")?.id).toMatch(/^n-/);
    expect(model.newestZ).toBeLessThan(model.oldestZ);
  });

  it("lays stations deeper into the tunnel in transcript order", () => {
    const model = modelOf([toolEntry("done"), interruptEntry()]);
    expect(model.nodes).toHaveLength(2);
    expect(model.nodes[0].z).toBeGreaterThan(model.nodes[1].z);
    for (let index = 1; index < model.nodes.length; index += 1) {
      expect(model.nodes[index].z).toBeLessThan(model.nodes[index - 1].z - 1);
    }
  });

  it("is fully deterministic for identical input", () => {
    const entries = makeFixture().entries;
    const first = modelOf(entries);
    const second = modelOf(entries);
    expect(second.nodes.map((node) => [node.id, node.z, node.x, node.y, node.height])).toEqual(
      first.nodes.map((node) => [node.id, node.z, node.x, node.y, node.height])
    );
    expect(second.bounds).toEqual(first.bounds);
  });

  it("keeps user text on the right lane and assistant text on the left", () => {
    const model = modelOf(makeFixture().entries);
    const user = model.nodes.find((node) => node.kind === "user")!;
    const assistant = model.nodes.find((node) => node.kind === "assistant")!;
    expect(user.segments.some((segment) => segment.anchorX === "right")).toBe(true);
    expect(user.x).toBeGreaterThan(assistant.x);
  });

  it("aggregates text into paragraph stations, not per token/character", () => {
    const longText = "lorem ipsum dolor sit amet ".repeat(120);
    const model = modelOf([
      {
        id: "a-long",
        at: 1,
        kind: "assistant",
        text: longText,
        streaming: true,
      },
    ]);
    expect(model.nodes.length).toBeGreaterThan(1);
    expect(model.nodes.length).toBeLessThan(14);
    for (const node of model.nodes) {
      const body = node.segments.filter((segment) => segment.role === "body");
      for (const segment of body) expect(segment.text.length).toBeLessThanOrEqual(TUNNEL.maxSegmentChars);
    }
    expect(model.nodes.length).toBe(splitForMesh(longText).length);
  });

  it("applies light scene cleanup without parsing Markdown", () => {
    expect(cleanForScene("### heading\n\n**bold** and `code` and [link](https://x.y)")).toBe(
      "heading\n\nbold and code and link"
    );
  });

  it("keeps the micro depth layer within the brief's ±0.5 band", () => {
    const model = modelOf(makeFixture().entries);
    for (const node of model.nodes) {
      for (const segment of node.segments) {
        expect(Math.abs(segment.depthJitter)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("builds a wireframe polyhedron station for tool calls", () => {
    const model = modelOf([toolEntry("executing")]);
    const node = model.nodes[0];
    expect(node.mesh).toBe("icosa");
    expect(node.tone).toBe("cyan");
    expect(node.segments.map((segment) => segment.text).join(" ")).toContain("web.search");
  });

  it("reflects a streaming entry update on the next model build", () => {
    const assistant = {
      id: "a1",
      at: 1,
      kind: "assistant" as const,
      text: "short",
      streaming: true,
    };
    const before = modelOf([assistant]);
    const grown = modelOf([{ ...assistant, text: "short " + "long token text ".repeat(80) }]);
    expect(grown.nodes[0].height).toBeGreaterThan(before.nodes[0].height);
    expect(grown.nodes[0].segments.map((segment) => segment.text).join(" ")).toContain("long token text");
  });
});

describe("orbit scene model — status visual coverage", () => {
  it("localizes every tool status and maps it to a tone", () => {
    const expected = [
      ["args", "参数流式输出", "cyan"],
      ["executing", "执行中", "cyan"],
      ["interrupted", "已暂停", "amber"],
      ["done", "完成", "green"],
      ["error", "失败", "red"],
    ] as const;
    for (const [status, label, tone] of expected) {
      const node = modelOf([toolEntry(status)]).nodes[0];
      expect(node.tone).toBe(tone);
      expect(node.segments.map((segment) => segment.text).join(" ")).toContain(label);
    }
  });

  it("never renders raw English step/subagent statuses", () => {
    const model = modelOf([
      { id: "s1", at: 1, kind: "step", name: "fixture step", status: "running" },
      { id: "s2", at: 2, kind: "step", name: "second step", status: "failed" },
      { id: "sa1", at: 3, kind: "subagent", name: "helper", status: "error" },
    ]);
    const text = model.nodes.flatMap((node) => node.segments.map((segment) => segment.text)).join(" ");
    expect(text).toContain("生成中");
    expect(text).toContain("失败");
    expect(text).not.toContain("running");
    expect(text).not.toContain("failed");
  });

  it("covers plan step states through t()", () => {
    const model = modelOf([
      {
        id: "p1",
        at: 1,
        kind: "plan",
        title: "trip",
        activityType: "PLAN",
        steps: [
          { id: "s1", label: "book", state: "done" },
          { id: "s2", label: "fly", state: "active" },
          { id: "s3", label: "rest", state: "pending" },
          { id: "s4", label: "cancel", state: "cancelled" },
        ],
      },
    ]);
    const text = model.nodes[0].segments.map((segment) => segment.text).join(" ");
    for (const word of ["完成", "进行中", "待处理", "已取消"]) expect(text).toContain(word);
  });

  it("declares approval buttons only for a pending (non-expired) interrupt", () => {
    const pending = modelOf([interruptEntry()]).nodes[0];
    expect(pending.status).toBe("pending");
    expect(pending.actions.map((action) => action.kind)).toEqual(["approve", "deny"]);
    expect(pending.actions.every((action) => action.nodeId === "n-i1")).toBe(true);

    const approved = modelOf([interruptEntry({ status: "approved" })]).nodes[0];
    expect(approvalState(interruptEntry({ status: "approved" }))).toBe("approved");
    expect(approved.actions).toHaveLength(0);

    const expired = modelOf([
      interruptEntry({ status: "approved", expired: true }),
    ]).nodes[0];
    expect(expired.status).toBe("expired");
    expect(expired.actions).toHaveLength(0);
    expect(expired.segments.map((segment) => segment.text).join(" ")).toContain("已过期");
  });
});

describe("orbit scene model — camera/suggestions/state", () => {
  it("derives follow bounds from the newest and oldest stations", () => {
    const model = modelOf([toolEntry("done"), interruptEntry()]);
    expect(model.bounds.minZ).toBeCloseTo(model.newestZ + TUNNEL.followGap);
    expect(model.bounds.maxZ).toBeGreaterThanOrEqual(model.bounds.minZ);
    expect(model.bounds.maxZ).toBeCloseTo(model.oldestZ + TUNNEL.backGap);
  });

  it("places suggestions in camera space and flattens actions for proxies", () => {
    const model = modelOf([], { suggestions: ["plan a trip", "compare hotels", "", "day 3", "extra"] });
    expect(model.cameraActions).toHaveLength(4);
    expect(model.cameraActions.every((action) => action.space === "camera")).toBe(true);
    expect(model.cameraActions[0].text).toBe("plan a trip");
    expect(sceneActions(model).every((action) => action.id.startsWith("act-"))).toBe(true);
  });

  it("builds a readable empty room", () => {
    const model = modelOf([]);
    expect(model.empty).toBe(true);
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0].kind).toBe("empty");
    expect(model.nodes[0].segments.map((segment) => segment.text).join(" ")).toContain("空间正在聆听");
    expect(model.bounds.minZ).toBe(model.bounds.maxZ);
  });

  it("adds a shared-state ribbon at the tunnel entrance", () => {
    const model = modelOf([toolEntry("done")], {
      sharedState: { trip: { budget: 800 }, note: "hello" },
      stateVersion: 3,
    });
    expect(model.nodes[0].kind).toBe("state");
    const text = model.nodes[0].segments.map((segment) => segment.text).join(" ");
    expect(text).toContain("共享状态");
    expect(text).toContain("v3");
  });

  it("exposes toolStatusLabel for the shared status-word discipline", () => {
    expect(toolStatusLabel("done", tr)).toBe("完成");
    expect(toolStatusLabel("mystery", tr)).toBe("执行中");
  });
});

describe("orbit scene model — live tail", () => {
  it("keeps newly appended characters out of the stable paragraph", () => {
    const plan = planLiveTail("hello", "", "hello world", true);
    expect(plan).toEqual({ stable: "hello", tail: " world", changed: true, tailReset: true });
    const grown = planLiveTail("hello", " world", "hello world!", true);
    expect(grown.stable).toBe("hello");
    expect(grown.tail).toBe(" world!");
    expect(grown.tailReset).toBe(false); // pure growth keeps the materialize clock
  });

  it("merges the tail once it passes the live budget", () => {
    const committed = "stable:";
    const next = committed + "x".repeat(LIVE_TAIL_MAX + 1);
    const plan = planLiveTail(committed, "", next, true);
    expect(plan.tail).toBe("");
    expect(plan.stable).toBe(next);
    expect(plan.changed).toBe(true);
  });

  it("merges the tail when the stream ends, even without new text", () => {
    const plan = planLiveTail("stable", " tail", "stable tail", false);
    expect(plan).toEqual({ stable: "stable tail", tail: "", changed: true, tailReset: true });
  });

  it("resets the split on a non-append rewrite instead of fabricating a tail", () => {
    const plan = planLiveTail("old", " text", "rewritten", true);
    expect(plan).toEqual({ stable: "rewritten", tail: "", changed: true, tailReset: true });
  });
});

describe("orbit scene model — long-session history entry", () => {
  it("adds a tunnel-entrance history station wired to the earlier action", () => {
    const model = modelOf([toolEntry("done")], { hiddenCount: 42 });
    const history = model.nodes.find((node) => node.kind === "history")!;
    expect(history).toBeTruthy();
    expect(history.id).toBe("n-history");
    expect(history.z).toBeGreaterThan(model.nodes[1].z); // entrance, in front of messages
    const action = sceneActions(model).find((item) => item.kind === "earlier")!;
    expect(action).toBeTruthy();
    expect(action.space).toBe("node");
    expect(action.nodeId).toBe("n-history");
    expect(action.label).toContain("42");
    expect(action.label).toContain(t("history.more"));
  });

  it("omits the history station when nothing is windowed away", () => {
    const model = modelOf([toolEntry("done")], { hiddenCount: 0 });
    expect(model.nodes.some((node) => node.kind === "history")).toBe(false);
    expect(sceneActions(model).some((action) => action.kind === "earlier")).toBe(false);
  });
});
