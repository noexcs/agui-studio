/* Scripted demo scenarios. The travel scene lives in demo.ts; this module
   adds two protocol-rich scenes and hides the routing behind one API:
   buildScenarioRun / buildScenarioResume. */

import { Builder, buildResumeEvents as buildTravelResume, buildRunEvents as buildTravelRun, RUN_FIRST, RUN_RESUME, THREAD_ID } from "./demo";
import { EventType, type TimedEvent } from "./events";
import type { Lang } from "../i18n";

export type DemoScenario = "agents" | "travel";

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
  return value === "agents" || value === "travel";
}

const pick = (lang: Lang, en: string, zh: string) => (lang === "zh" ? zh : en);

function streamText(b: Builder, messageId: string, text: string, delay = 22, unitSize = 1): void {
  // Chinese has no spaces: splitting on whitespace produced one giant delta for
  // a whole paragraph. Stream CJK by characters (2 per delta) and Latin text
  // word-by-word, so the paced output is genuinely incremental in both locales.
  const cjk = /[\u3400-\u9fff]/.test(text);
  const units = cjk ? Array.from(text) : text.split(/(\s+)/).filter(Boolean);
  const size = cjk ? 2 : Math.max(1, unitSize);
  for (let i = 0; i < units.length; i += size) {
    b.push(delay + (i % 4) * 3, {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: units.slice(i, i + size).join(""),
    });
  }
}

/* ── multi-agent: steps, subagents, tool error, encrypted reasoning ── */
function buildAgentsRun(threadId: string, runId: string, lang: Lang): TimedEvent[] {
  const b = new Builder(threadId, runId);
  const zh = lang === "zh";
  const digest = pick(
    lang,
    [
      "### Merged result",
      "",
      "**Verdict:** the weekend works. Two people fit inside the €722 plan; the only open question is live inventory, because the Ops Agent's stock API timed out and the weather tool returned \`503\`.",
      "",
      "#### What the research found",
      "- **Research Scout** checked 3 sources and confirmed the May events calendar, opening hours and the tram/rail connections.",
      "- Belém and the Jerónimos monastery are best at opening time; the miradouros fill up after 17:00.",
      "- Sintra deserves a full day: train from Rossio, then bus 434 for Pena and the moorish castle.",
      "",
      "#### Suggested shape",
      "| Day | Morning | Afternoon | Note |",
      "| --- | --- | --- | --- |",
      "| Fri | Alfama walk + castle | Sunset at Senhora do Monte | Tram 28 is crowded; walk instead |",
      "| Sat | Belém + pastéis | LX Factory / riverfront | Book Jerónimos online |",
      "| Sun | Sintra day trip | Pena + Quinta da Regaleira | Leave by 08:00 |",
      "",
      "#### Budget",
      "- Hotel: €332 for two nights (free cancellation).",
      "- Food and local transport: €296.",
      "- Tickets and trains: €94.",
      "- **Total: €722**, leaving roughly €78 of slack for a slow lunch or a taxi in the rain.",
      "",
      "#### Next step",
      "1. Retry the Ops Agent's inventory check for the hotel hold.",
      "2. Confirm the Jerónimos time slot and the Sintra train.",
      "3. If inventory stays unknown, I can keep the free-cancellation rate and re-check tomorrow morning.",
      "",
      "The plan, the shared state snapshot and this summary all came from typed AG-UI events.",
    ].join("\n"),
    [
      "### 合并结果",
      "",
      "**结论：** 这个周末可行。两人核心行程在 €722 预算内；唯一没确认的是实时库存——Ops Agent 的库存接口超时，weather 工具也返回 \`503\`。",
      "",
      "#### 调研结论",
      "- **Research Scout** 查了 3 个来源，确认 5 月活动日历、开放时间和电车/火车接驳。",
      "- 贝伦区与热罗尼莫斯修道院最好一开门就到；观景台 17:00 之后人最多。",
      "- 辛特拉值得留一整天：Rossio 坐火车，再换 434 路去佩纳宫和摩尔人城堡。",
      "",
      "#### 行程建议",
      "| 日期 | 上午 | 下午 | 备注 |",
      "| --- | --- | --- | --- |",
      "| 周五 | 阿尔法玛散步 + 圣若热城堡 | 山上圣母观景台看日落 | 28 路电车太挤，建议步行 |",
      "| 周六 | 贝伦区 + 蛋挞 | LX Factory / 河岸 | 修道院提前在线订票 |",
      "| 周日 | 辛特拉一日游 | 佩纳宫 + 雷加莱拉庄园 | 8 点前出发 |",
      "",
      "#### 预算",
      "- 酒店：两晚 €332（可免费取消）。",
      "- 餐饮与市内交通：€296。",
      "- 门票与火车：€94。",
      "- **合计 €722**，大约还剩 €78 缓冲，够一顿慢午餐或下雨时打车。",
      "",
      "#### 接下来",
      "1. 重试 Ops Agent 的库存查询，确认酒店 hold。",
      "2. 确认热罗尼莫斯的时间段和辛特拉火车。",
      "3. 如果库存仍未知，先保留可免费取消的价格，明早再查一次。",
      "",
      "计划、共享状态快照和这段总结都来自类型化的 AG-UI 事件。",
    ].join("\n")
  );

  const reasoningTurn = (id: string, text: string, encrypted = false) => {
    b.push(40, { type: EventType.REASONING_START, messageId: id });
    b.push(30, { type: EventType.REASONING_MESSAGE_START, messageId: id, role: "reasoning" });
    chunkInto(b, 18, id, text);
    if (encrypted) {
      b.push(80, {
        type: EventType.REASONING_ENCRYPTED_VALUE,
        subtype: "message",
        entityId: id,
        encryptedValue: "enc_reasoning_blob_9f2c…",
      });
    }
    b.push(40, { type: EventType.REASONING_MESSAGE_END, messageId: id });
    b.push(30, { type: EventType.REASONING_END, messageId: id });
  };
  const textTurn = (id: string, text: string, parentForTools?: string) => {
    b.push(40, { type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" });
    streamText(b, id, text, 55, 1);
    b.push(50, { type: EventType.TEXT_MESSAGE_END, messageId: id });
  };
  const toolCall = (id: string, name: string, args: Record<string, unknown>, result: unknown, parent?: string) => {
    b.push(60, { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name, ...(parent ? { parentMessageId: parent } : {}) });
    b.args(id, JSON.stringify(args), 18);
    b.push(40, { type: EventType.TOOL_CALL_END, toolCallId: id });
    b.push(150, { type: EventType.TOOL_CALL_RESULT, toolCallId: id, content: JSON.stringify(result) });
  };

  b.push(0, {
    type: EventType.RUN_STARTED,
    metadata: { traceId: "trace_agents_01", model: "deepseek-flash", framework: "pi", sandbox: "local" },
  });

  // model call 1 — thinking first, then the plan
  b.push(60, { type: EventType.STEP_STARTED, stepName: zh ? "规划步骤" : "Plan steps" });
  reasoningTurn(
    "rsn_agents_1",
    pick(
      lang,
      "The request is a weekend plan, but the live facts are fragmented: events, hotels, Sintra transport and weather. I will treat the inventory as the only blocking unknown and keep a cancellable rate until it is confirmed.",
      "这是一个周末规划，但活动、酒店、辛特拉交通和天气都是活信息。我把库存当作唯一阻塞项，在确认之前只保留可取消价格。"
    ),
    true
  );
  b.push(50, { type: EventType.STEP_FINISHED, stepName: zh ? "规划步骤" : "Plan steps" });

  // model call 2 — thinking, then a brief answer + first tool call
  b.push(50, { type: EventType.STEP_STARTED, stepName: zh ? "调研与执行" : "Research & execute" });
  b.push(60, { type: EventType.CUSTOM, name: "handoff", value: { to: "Research Scout", mode: "delegate", parallel: true } });
  b.push(60, {
    type: EventType.SUBAGENT_STARTED,
    subagentId: "sa_research",
    name: "Research Scout",
    description: pick(lang, "searching 3 sources", "检索 3 个来源"),
  });
  b.push(50, {
    type: EventType.SUBAGENT_STARTED,
    subagentId: "sa_ops",
    name: "Ops Agent",
    description: pick(lang, "checking inventory", "检查可订库存"),
  });
  reasoningTurn(
    "rsn_agents_2",
    pick(
      lang,
      "Before delegating I need the May event calendar and the Sintra rail connection. Those are stable facts; the inventory check can fail without invalidating the itinerary.",
      "派发前先确认 5 月活动日历和辛特拉火车接驳，这两个是稳定事实；库存查询失败不应推翻整条行程。"
    )
  );
  // a model turn may stream body text and then call a tool in the same message
  b.push(40, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_agents_research", role: "assistant" });
  streamText(
    b,
    "msg_agents_research",
    pick(
      lang,
      "I will start with the facts I can verify: the May calendar and the train/rail connections. I am calling the search tool now, and will keep this message open until the call is issued.",
      "先查能验证的事实：5 月日历和火车/接驳。我现在调用搜索工具，正文先说到这里。"
    ),
    55,
    1
  );
  b.push(50, {
    type: EventType.TOOL_CALL_START,
    toolCallId: "tc_agents_search",
    toolCallName: "web.search",
    parentMessageId: "msg_agents_research",
  });
  b.args("tc_agents_search", JSON.stringify({ query: "lisbon may events 2026" }), 18);
  b.push(40, { type: EventType.TOOL_CALL_END, toolCallId: "tc_agents_search" });
  b.push(50, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_agents_research" });
  b.push(150, {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: "tc_agents_search",
    content: JSON.stringify({
      results: [
        { title: "Lisbon events — May", url: "https://example.com/events" },
        { title: "Visit Lisboa — May calendar", url: "https://example.com/calendar" },
        { title: "CP — Sintra line", url: "https://example.com/cp" },
      ],
    }),
  });
  b.push(70, { type: EventType.SUBAGENT_FINISHED, subagentId: "sa_research" });

  // model call 3 — thinking, then text, then two more tools
  reasoningTurn(
    "rsn_agents_3",
    pick(
      lang,
      "The search returned three sources, so the dates and rail links are confirmed. Next I need a free-cancellation hotel and the door-to-door Sintra route before I can price the weekend.",
      "搜索结果给了 3 个来源，日期和铁路接驳已确认。接下来要找可免费取消的酒店和辛特拉的门到门路线，才能把周末的价格算出来。"
    )
  );
  textTurn(
    "msg_agents_tools_1",
    pick(
      lang,
      "The May calendar is confirmed. I am now checking two hotel rates with free cancellation, plus the fastest train-bus route to Sintra so the final table has realistic timings.",
      "5 月日历已经确认。现在核对两家可免费取消的酒店，以及去辛特拉最快的火车+巴士路线，保证最终表格里的时间是真实的。"
    ),
    "msg_agents_tools_1"
  );
  toolCall("tc_hotels", "hotel.search", { city: "Lisbon", nights: 2, guests: 2 }, {
    results: [
      { title: "Lisboa Central Hotel — €166/night", url: "https://example.com/hotel-1" },
      { title: "Alfama Boutique — €189/night", url: "https://example.com/hotel-2" },
    ],
  }, "msg_agents_tools_1");
  toolCall("tc_route", "map.route", { from: "Alfama", to: "Sintra" }, { minutes: 45, mode: "train + bus", transfers: 1 }, "msg_agents_tools_1");

  // model call 4 — thinking, then weather tool; it fails, so the next thought handles it
  reasoningTurn(
    "rsn_agents_4",
    pick(
      lang,
      "Hotels are priced and the route is 45 minutes. The remaining dependency is weather, but it only affects packing; if it fails I should not turn the whole plan into an error.",
      "酒店价格和 45 分钟路线都有了。剩下的依赖是天气，但它只影响打包建议；即使失败也不能把整条行程打成错误。"
    )
  );
  textTurn(
    "msg_agents_tools_2",
    pick(
      lang,
      "I have two cancellable hotels and a 45-minute train-bus route. One last check is the forecast; if that call fails I will report the weather as unknown instead of inventing a temperature.",
      "已有两家可取消酒店和 45 分钟火车+巴士路线。最后确认天气；如果调用失败，我会把天气标成未知，不编温度。"
    ),
    "msg_agents_tools_2"
  );
  toolCall("tc_weather", "weather.forecast", { city: "Lisbon", days: 3 }, { error: "upstream 503 — forecast unavailable" }, "msg_agents_tools_2");
  b.push(70, {
    type: EventType.SUBAGENT_ERROR,
    subagentId: "sa_ops",
    message: pick(lang, "inventory API timed out", "库存 API 超时"),
  });
  b.push(50, { type: EventType.STEP_FINISHED, stepName: zh ? "调研与执行" : "Research & execute" });

  // model call 5 — final synthesis
  b.push(50, { type: EventType.STEP_STARTED, stepName: zh ? "合并结果" : "Merge results" });
  reasoningTurn(
    "rsn_agents_5",
    pick(
      lang,
      "I have enough to answer. I will merge the confirmed facts, keep the inventory and weather as explicitly unknown, and close the plan's final steps before the run finishes.",
      "信息够了。合并已确认的事实，把库存和天气明确标成未知，并在 run 结束前把计划的最后几步收尾。"
    )
  );
  b.push(60, {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: "act_agents_1",
    activityType: "PLAN",
    content: {
      title: pick(lang, "Multi-agent run", "多智能体运行"),
      steps: [
        { id: "p1", label: pick(lang, "Plan the split", "拆解任务"), state: "done" },
        { id: "p2", label: pick(lang, "Delegate to 2 subagents", "派发 2 个子 agent"), state: "done" },
        { id: "p3", label: pick(lang, "Verify hotels and routes", "核对酒店与路线"), state: "done" },
        { id: "p4", label: pick(lang, "Merge results", "合并结果"), state: "active" },
        { id: "p5", label: pick(lang, "Write the final plan", "写最终行程"), state: "pending" },
      ],
    },
  });
  b.push(60, {
    type: EventType.STATE_SNAPSHOT,
    snapshot: {
      objective: pick(lang, "Plan a Lisbon weekend", "规划里斯本周末"),
      agents: { research: "done", ops: "error" },
      sources: 3,
      budget: { planned: 722, currency: "EUR" },
      weather: "unknown",
    },
  });
  b.push(60, { type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/weather", value: "unknown" }] });

  b.push(70, { type: EventType.CUSTOM, name: "artifact", value: { kind: "research-digest", sources: 3, subagents: 2 } });
  b.push(80, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_agents_1", role: "assistant" });
  streamText(b, "msg_agents_1", digest, 58, 1);
  b.push(90, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_agents_1" });
  b.push(70, {
    type: EventType.ACTIVITY_DELTA,
    messageId: "act_agents_1",
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/3/state", value: "done" },
      { op: "replace", path: "/steps/4/state", value: "done" },
    ],
  });
  b.push(60, { type: EventType.STEP_FINISHED, stepName: zh ? "合并结果" : "Merge results" });
  b.push(60, {
    type: EventType.CUSTOM,
    name: "suggestions",
    value: zh ? ["重试 Ops Agent", "只看调研摘要", "改为手动查库存"] : ["Retry Ops Agent", "Read research digest", "Check inventory manually"],
  });
  b.push(80, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
  return stretchEvents(b.list, 40_000);
}

function stretchEvents(events: TimedEvent[], targetMs: number): TimedEvent[] {
  const total = events[events.length - 1]?.at ?? 0;
  if (!total) return events;
  const scale = targetMs / total;
  return events.map((item) => ({ ...item, at: Math.round(item.at * scale) }));
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
    default:
      return buildTravelResume(decisions, threadId, runId, lang);
  }
}
