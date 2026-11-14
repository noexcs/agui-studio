/* Scripted demo scenarios. The travel scene lives in demo.ts; this module
   adds two protocol-rich scenes and hides the routing behind one API:
   buildScenarioRun / buildScenarioResume. */

import { Builder, buildResumeEvents as buildTravelResume, buildRunEvents as buildTravelRun, RUN_FIRST, RUN_RESUME, THREAD_ID } from "./demo";
import { EventType, type TimedEvent } from "./events";
import type { Lang } from "../i18n";

export type DemoScenario = "agents" | "travel" | "approvals";

export interface ScenarioMeta {
  id: DemoScenario;
  en: string;
  zh: string;
  detailEn: string;
  detailZh: string;
}

export const DEFAULT_SCENARIO: DemoScenario = "agents";

export const SCENARIOS: ScenarioMeta[] = [
  {
    id: "agents",
    en: "Multi-agent",
    zh: "多智能体",
    detailEn: "steps, subagents, tool error, encrypted reasoning",
    detailZh: "步骤、子 agent、工具失败、加密推理",
  },
  {
    id: "approvals",
    en: "Parallel approvals",
    zh: "并行审批",
    detailEn: "two interrupts, expiry, mixed resume decisions",
    detailZh: "两个中断、过期、混合恢复决策",
  },
  {
    id: "travel",
    en: "Trip planning",
    zh: "行程规划",
    detailEn: "state patches, plan activity, single interrupt",
    detailZh: "状态补丁、计划活动、单中断",
  },
];

export function scenarioMeta(id: DemoScenario): ScenarioMeta {
  return SCENARIOS.find((item) => item.id === id) ?? SCENARIOS[0];
}

export function scenarioName(id: DemoScenario, lang: Lang): string {
  const meta = scenarioMeta(id);
  return lang === "zh" ? meta.zh : meta.en;
}

export function scenarioDetail(id: DemoScenario, lang: Lang): string {
  const meta = scenarioMeta(id);
  return lang === "zh" ? meta.detailZh : meta.detailEn;
}

export function isDemoScenario(value: string | null | undefined): value is DemoScenario {
  return value === "agents" || value === "travel" || value === "approvals";
}

const pick = (lang: Lang, en: string, zh: string) => (lang === "zh" ? zh : en);

function streamText(b: Builder, messageId: string, text: string, delay = 22): void {
  const words = text.split(/(\s+)/);
  let buffer = "";
  words.forEach((word, i) => {
    buffer += word;
    if (buffer && ((i + 1) % 3 === 0 || i === words.length - 1)) {
      b.push(delay + (i % 4) * 4, {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: buffer,
      });
      buffer = "";
    }
  });
}

/* ── multi-agent: steps, subagents, tool error, encrypted reasoning ── */
function buildAgentsRun(threadId: string, runId: string, lang: Lang): TimedEvent[] {
  const b = new Builder(threadId, runId);
  const zh = lang === "zh";
  const brief = pick(
    lang,
    "I will split this into research and operations, run both subagents, then merge the results.",
    "我会拆成调研与执行两条线,让两个子 agent 并行跑,最后合并结果。"
  );
  const digest = pick(
    lang,
    "### Merged result\n\n- **Research Scout** found 3 sources and returned a short digest.\n- **Ops Agent** timed out on the inventory API — the weather tool call failed too (`503`), so availability stays unknown.\n- Everything else is ready: the plan, the state snapshot and this summary all came from typed AG-UI events.",
    "### 合并结果\n\n- **Research Scout** 找到 3 个来源并返回摘要。\n- **Ops Agent** 在库存 API 上超时,weather 工具也返回 `503`,可订状态暂时未知。\n- 其余都就绪:计划、状态快照和这段总结都来自类型化的 AG-UI 事件。"
  );

  b.push(0, {
    type: EventType.RUN_STARTED,
    metadata: {
      traceId: "trace_agents_01",
      model: "deepseek-flash",
      framework: "pi",
      sandbox: "local",
    },
  });

  b.push(80, { type: EventType.STEP_STARTED, stepName: "plan" });
  b.push(60, { type: EventType.REASONING_START, messageId: "rsn_agents_1" });
  b.push(40, {
    type: EventType.REASONING_MESSAGE_START,
    messageId: "rsn_agents_1",
    role: "reasoning",
  });
  chunkInto(b, 24, "rsn_agents_1",
    zh
      ? "任务可以并成两条独立支线:调研负责找事实,执行负责查可订性。先派发子 agent,再等它们回传。"
      : "The task splits into two independent tracks: research for facts, operations for availability. Delegate first, then collect."
  );
  b.push(120, {
    type: EventType.REASONING_ENCRYPTED_VALUE,
    messageId: "rsn_agents_1",
    value: "enc_reasoning_blob_9f2c…",
  });
  b.push(80, { type: EventType.REASONING_MESSAGE_END, messageId: "rsn_agents_1" });
  b.push(50, { type: EventType.REASONING_END, messageId: "rsn_agents_1" });
  b.push(60, { type: EventType.STEP_FINISHED, stepName: "plan" });

  b.push(70, { type: EventType.STEP_STARTED, stepName: "delegate" });
  b.push(60, {
    type: EventType.CUSTOM,
    name: "handoff",
    value: { to: "Research Scout", mode: "delegate", parallel: true },
  });
  b.push(80, {
    type: EventType.SUBAGENT_STARTED,
    subagentId: "sa_research",
    name: "Research Scout",
    description: pick(lang, "searching 3 sources", "检索 3 个来源"),
  });
  b.push(70, {
    type: EventType.SUBAGENT_STARTED,
    subagentId: "sa_ops",
    name: "Ops Agent",
    description: pick(lang, "checking inventory", "检查可订库存"),
  });

  b.push(90, {
    type: EventType.TOOL_CALL_START,
    toolCallId: "tc_agents_search",
    toolCallName: "web.search",
    parentMessageId: "rsn_agents_1",
  });
  b.args("tc_agents_search", JSON.stringify({ query: "lisbon may events 2026" }), 22);
  b.push(60, { type: EventType.TOOL_CALL_END, toolCallId: "tc_agents_search" });
  b.push(220, {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: "tc_agents_search",
    content: JSON.stringify({ results: [{ title: "Lisbon events — May", url: "https://example.com/events" }] }),
  });

  b.push(140, { type: EventType.SUBAGENT_FINISHED, subagentId: "sa_research" });
  b.push(160, {
    type: EventType.SUBAGENT_ERROR,
    subagentId: "sa_ops",
    message: pick(lang, "inventory API timed out after 8s", "库存 API 8 秒后超时"),
  });

  // tool-level failure: same run, distinct from a crashed subagent
  b.push(90, {
    type: EventType.TOOL_CALL_START,
    toolCallId: "tc_weather",
    toolCallName: "weather.forecast",
  });
  b.args("tc_weather", JSON.stringify({ city: "Lisbon", days: 3 }), 18);
  b.push(50, { type: EventType.TOOL_CALL_END, toolCallId: "tc_weather" });
  b.push(180, {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: "tc_weather",
    content: JSON.stringify({ error: "upstream 503 — forecast unavailable" }),
  });

  b.push(80, {
    type: EventType.CUSTOM,
    name: "artifact",
    value: { kind: "research-digest", sources: 3, subagents: 2 },
  });
  b.push(60, { type: EventType.STEP_FINISHED, stepName: "delegate" });

  b.push(70, { type: EventType.STEP_STARTED, stepName: "merge" });
  b.push(80, {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: "act_agents_1",
    activityType: "PLAN",
    content: {
      title: pick(lang, "Multi-agent run", "多智能体运行"),
      steps: [
        { id: "p1", label: pick(lang, "Plan the split", "拆解任务"), state: "done" },
        { id: "p2", label: pick(lang, "Delegate to 2 subagents", "派发 2 个子 agent"), state: "done" },
        { id: "p3", label: pick(lang, "Merge results", "合并结果"), state: "active" },
      ],
    },
  });
  b.push(70, {
    type: EventType.STATE_SNAPSHOT,
    snapshot: {
      objective: pick(lang, "Plan a Lisbon weekend", "规划里斯本周末"),
      agents: { research: "done", ops: "error" },
      sources: 3,
      budget: { planned: 722, currency: "EUR" },
    },
  });
  b.push(70, {
    type: EventType.STATE_DELTA,
    delta: [{ op: "replace", path: "/agents/ops", value: "error" }],
  });

  b.push(90, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_agents_1", role: "assistant" });
  streamText(b, "msg_agents_1", digest);
  b.push(90, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_agents_1" });
  b.push(70, { type: EventType.STEP_FINISHED, stepName: "merge" });
  b.push(90, {
    type: EventType.CUSTOM,
    name: "suggestions",
    value: zh ? ["重试 Ops Agent", "只看调研摘要", "改为手动查库存"] : ["Retry Ops Agent", "Read research digest", "Check inventory manually"],
  });
  b.push(80, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
  return b.list;
}

function chunkInto(b: Builder, delay: number, messageId: string, text: string): void {
  const step = Math.max(1, Math.floor(text.length / 6));
  for (let i = 0; i < text.length; i += step) {
    b.push(delay + (i % 3) * 4, {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId,
      delta: text.slice(i, i + step),
    });
  }
}

/* ── parallel approvals: two interrupts + mixed resume decisions ──── */
function buildApprovalsRun(threadId: string, runId: string, lang: Lang): TimedEvent[] {
  const b = new Builder(threadId, runId);
  const zh = lang === "zh";

  b.push(0, {
    type: EventType.RUN_STARTED,
    metadata: { traceId: "trace_approvals_02", model: "deepseek-flash", framework: "pi" },
  });
  b.push(70, { type: EventType.STEP_STARTED, stepName: "price-check" });
  b.push(60, {
    type: EventType.TOOL_CALL_START,
    toolCallId: "tc_price",
    toolCallName: "price.check",
  });
  b.args("tc_price", JSON.stringify({ hotel: "Lisboa Central", nights: 2 }), 18);
  b.push(60, { type: EventType.TOOL_CALL_END, toolCallId: "tc_price" });
  b.push(160, {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: "tc_price",
    content: JSON.stringify({ previous_eur: 332, current_eur: 372, delta_eur: 40 }),
  });
  b.push(80, { type: EventType.STEP_FINISHED, stepName: "price-check" });

  b.push(70, { type: EventType.ACTIVITY_SNAPSHOT, messageId: "act_appr_1", activityType: "PLAN", content: {
    title: zh ? "下单前确认" : "Confirm before booking",
    steps: [
      { id: "a1", label: zh ? "比价" : "Price check", state: "done" },
      { id: "a2", label: zh ? "等待审批" : "Await approvals", state: "active" },
      { id: "a3", label: zh ? "写入订单" : "Commit booking", state: "pending" },
    ],
  }});
  b.push(70, {
    type: EventType.STATE_SNAPSHOT,
    snapshot: { hotel: "Lisboa Central", price: { current_eur: 372, delta_eur: 40 }, hold: null },
  });
  b.push(90, {
    type: EventType.TEXT_MESSAGE_START,
    messageId: "msg_appr_1",
    role: "assistant",
  });
  streamText(
    b,
    "msg_appr_1",
    zh
      ? "房价比昨天涨了 €40。下单前有两件事需要你确认——两个问题可以分别处理,全部解决后我才会继续。"
      : "The room is €40 more than yesterday. Two decisions are needed before I book — they're independent, and I'll continue only once both are resolved."
  );
  b.push(80, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_appr_1" });

  b.push(120, {
    type: EventType.RUN_FINISHED,
    outcome: {
      type: "interrupt",
      interrupts: [
        {
          id: "int_price",
          reason: "confirmation",
          message: zh ? "接受 €40 的价格上涨?" : "Accept the €40 price increase?",
          description: zh ? "总价从 €332 变为 €372,免费取消政策不变。" : "Total moves from €332 to €372; free cancellation is unchanged.",
          details: [
            { label: zh ? "原价" : "Previous", value: "€332" },
            { label: zh ? "现价" : "Current", value: "€372" },
          ],
          responseSchema: {
            type: "object",
            properties: { approved: { type: "boolean" } },
            required: ["approved"],
          },
        },
        {
          id: "int_hold",
          reason: "confirmation",
          message: zh ? "保留 24 小时占位?" : "Hold the room for 24 hours?",
          description: zh ? "占位不收费,24 小时内可随时取消。" : "The hold is free and can be released anytime within 24 hours.",
          details: [{ label: zh ? "截止" : "Expires", value: "24h" }],
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          responseSchema: {
            type: "object",
            properties: { approved: { type: "boolean" } },
            required: ["approved"],
          },
        },
      ],
    },
  });
  return b.list;
}

function buildApprovalsResume(
  decisions: { approved: boolean; editedArgs?: Record<string, unknown> }[],
  threadId: string,
  runId: string,
  lang: Lang
): TimedEvent[] {
  const b = new Builder(threadId, runId);
  const zh = lang === "zh";
  const priceOk = decisions[0]?.approved ?? false;
  const holdOk = decisions[1]?.approved ?? false;

  b.push(0, { type: EventType.RUN_STARTED });
  b.push(90, {
    type: EventType.STEP_STARTED,
    stepName: priceOk ? "commit" : "revise",
  });
  b.push(70, {
    type: EventType.STATE_DELTA,
    delta: [
      { op: "replace", path: "/price/approved", value: priceOk },
      { op: "replace", path: "/hold", value: holdOk ? { status: "held", expires: "24h" } : null },
      { op: "add", path: "/notes/-", value: priceOk ? (zh ? "接受涨价" : "price increase accepted") : zh ? "价格未确认——未下单" : "price not approved — no booking" },
    ],
  });
  b.push(70, {
    type: EventType.ACTIVITY_DELTA,
    messageId: "act_appr_1",
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/1/state", value: "done" },
      { op: "replace", path: "/steps/2/state", value: priceOk ? "done" : "cancelled" },
    ],
  });
  b.push(90, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_appr_2", role: "assistant" });
  streamText(
    b,
    "msg_appr_2",
    zh
      ? priceOk
        ? holdOk
          ? "价格已接受,房间也占好了——24 小时内可随时取消。其余行程保持不变。"
          : "价格已接受,但没有保留占位。如果之后想改,直接说一声即可。"
        : "价格未确认,所以没有下单。占位状态已按你的选择更新。"
      : priceOk
        ? holdOk
          ? "Price accepted and the room is held for 24 hours — cancellation stays free. The rest of the plan is unchanged."
          : "Price accepted, but no hold was placed. Say the word if you change your mind."
        : "The price was not approved, so nothing was booked. The hold state reflects your decision."
  );
  b.push(80, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_appr_2" });
  b.push(60, { type: EventType.STEP_FINISHED, stepName: priceOk ? "commit" : "revise" });
  b.push(80, {
    type: EventType.CUSTOM,
    name: "suggestions",
    value: zh
      ? ["再查其他酒店", "现在就下单", "调整预算"]
      : ["Check another hotel", "Book now", "Adjust budget"],
  });
  b.push(80, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
  return b.list;
}

/* ── routing ───────────────────────────────────────────────────────── */
export function buildScenarioRun(
  scenario: DemoScenario,
  threadId = THREAD_ID,
  runId = RUN_FIRST,
  lang: Lang = "en"
): TimedEvent[] {
  switch (scenario) {
    case "agents":
      return buildAgentsRun(threadId, runId, lang);
    case "approvals":
      return buildApprovalsRun(threadId, runId, lang);
    default:
      return buildTravelRun(threadId, runId, lang);
  }
}

export function buildScenarioResume(
  scenario: DemoScenario,
  decisions: { approved: boolean; editedArgs?: Record<string, unknown> }[],
  threadId = THREAD_ID,
  runId = RUN_RESUME,
  lang: Lang = "en"
): TimedEvent[] {
  switch (scenario) {
    case "agents":
      // this script never stops on interrupts, so there is nothing to resume
      return [];
    case "approvals":
      return buildApprovalsResume(decisions, threadId, runId, lang);
    default:
      return buildTravelResume(decisions, threadId, runId, lang);
  }
}
