import { afterEach, describe, expect, it } from "vitest";
import { createStudio, type ConversationStore } from "../src/core/store";
import { buildScenarioRun, DEFAULT_SCENARIO, isDemoScenario, SCENARIOS, scenarioName } from "../src/core/demo-scenarios";
import { EventType } from "../src/core/events";

let store: ConversationStore | null = null;
afterEach(() => {
  store?.stop();
  store = null;
});

/** Feed a scenario's recorded event stream through the real reducer. */
function applyScenario(scenario: Parameters<typeof buildScenarioRun>[0]) {
  const s = createStudio({ autoplay: false, scenario });
  store = s;
  for (const item of buildScenarioRun(scenario, "thread_demo", "run_demo", "en")) {
    s.dispatch(item.event);
  }
  return s;
}

describe("demo scenarios", () => {
  it("exposes three scenarios with a default", () => {
    expect(SCENARIOS.map((item) => item.id)).toEqual(["agents", "travel"]);
    expect(DEFAULT_SCENARIO).toBe("agents");
    expect(scenarioName("agents", "zh")).toBe("多智能体");
    expect(isDemoScenario("travel")).toBe(true);
    expect(isDemoScenario("nope")).toBe(false);
  });

  it("multi-agent run exercises steps, subagents, custom, tool error and encrypted reasoning", () => {
    const s = applyScenario("agents");

    expect(s.metadata.traceId).toBe("trace_agents_01");
    expect(s.entries.filter((entry) => entry.kind === "step").length).toBeGreaterThanOrEqual(3);
    expect(s.entries.filter((entry) => entry.kind === "subagent")).toHaveLength(2);
    const subagents = s.entries.filter((entry) => entry.kind === "subagent") as { status: string }[];
    expect(subagents.map((entry) => entry.status).sort()).toEqual(["done", "error"]);
    expect(s.entries.filter((entry) => entry.kind === "custom").length).toBeGreaterThanOrEqual(2);

    const tools = s.entries.filter((entry) => entry.kind === "tool") as { status: string; error?: string }[];
    expect(tools.some((tool) => tool.status === "error" && tool.error?.includes("503"))).toBe(true);

    const reasoning = s.entries.find((entry) => entry.kind === "reasoning") as { encryptedValue?: string };
    expect(reasoning.encryptedValue).toContain("enc_reasoning_blob");

    expect(s.suggestions.length).toBeGreaterThan(0);
    expect(s.status).toBe("done");
  });

  it("streams long CJK text incrementally and leaves body text between tools", () => {
    const events = buildScenarioRun("agents", "t", "r", "zh");
    const textEvents = events.filter((item) => item.event.type === EventType.TEXT_MESSAGE_CONTENT);
    const longest = Math.max(...textEvents.map((item) => String((item.event as { delta?: string }).delta ?? "").length));
    const total = events.at(-1)?.at ?? 0;
    const s = applyScenario("agents");
    const assistantChars = s.entries
      .filter((entry) => entry.kind === "assistant")
      .reduce((sum, entry) => sum + (entry as { text: string }).text.length, 0);
    const toolCount = s.entries.filter((entry) => entry.kind === "tool").length;

    expect(total).toBeGreaterThan(35_000);
    expect(textEvents.length).toBeGreaterThan(300);
    expect(longest).toBeLessThanOrEqual(6);
    expect(assistantChars).toBeGreaterThan(600);
    expect(toolCount).toBeGreaterThanOrEqual(4);
  });

  it("travel scenario keeps the single-interrupt shape", () => {
    const s = applyScenario("travel");
    expect(s.pendingInterrupts()).toHaveLength(1);
    expect(s.entries.some((entry) => entry.kind === "plan")).toBe(true);
  });

  it("loadScene honours the configured scenario", () => {
    const s = createStudio({ autoplay: false, scenario: "travel" });
    store = s;
    s.loadScene("interrupted");
    expect(s.pendingInterrupts()).toHaveLength(1);

    const done = createStudio({ autoplay: false, scenario: "travel" });
    store = done;
    done.loadScene("done");
    expect(done.pendingInterrupts()).toHaveLength(0);
    expect(done.lastResume).toHaveLength(1);
  });

  it("does not replay a resume phase for scripts without interrupts", () => {
    const s = createStudio({ autoplay: false, scenario: "agents" });
    store = s;
    s.loadScene("done");
    expect(s.entries.some((entry) => entry.kind === "step" && entry.name === "compose")).toBe(false);
    expect(
      s.entries.some((entry) => entry.kind === "assistant" && entry.text.includes("Held — reference"))
    ).toBe(false);
  });

  it("step events in the agents script keep STEP_STARTED/FINISHED balanced", () => {
    const events = buildScenarioRun("agents", "t", "r", "en").map((item) => item.event);
    const started = events.filter((event) => event.type === EventType.STEP_STARTED).length;
    const finished = events.filter((event) => event.type === EventType.STEP_FINISHED).length;
    expect(started).toBe(finished);
    expect(started).toBeGreaterThanOrEqual(3);
  });
});
