/* ─────────────────────────────────────────────────────────────────────
   Demo content + scripted agent. This is the only file that invents
   answers. Swap it for a live transport and nothing else changes.
   Content is bilingual; the builder takes a language code.
   ───────────────────────────────────────────────────────────────────── */
import { EventType, type BaseEvent, type JsonPatchOp, type TimedEvent } from "./events";
import type { Lang } from "../i18n";

export const THREAD_ID = "thread_01J9F2QP";
export const RUN_FIRST = "run_7K2A";
export const RUN_RESUME = "run_7K2B";

export const CAPABILITIES = [
  { id: "tools", label: "tools", value: "4" },
  { id: "reasoning", label: "reasoning", value: "" },
  { id: "state", label: "state", value: "" },
  { id: "interrupts", label: "interrupts", value: "" },
];

interface DemoContent {
  prompt: string;
  reasoning: string;
  approved: string;
  denied: string;
  suggestions: string[];
  planTitle: string;
  steps: string[];
  threadTitle: string;
  destination: string;
  hotel: string;
  interrupt: { message: string; description: string; details: { label: string; value: string }[] };
  bookingArgs: Record<string, unknown>;
}

const EN: DemoContent = {
  prompt:
    "Plan a 3-day Lisbon trip for two in May — food markets, viewpoints, a bit of walking, and a day trip to Sintra. Budget around €800 for both of us.",
  reasoning:
    "Two people, €800 all-in, three days in May. May is shoulder season here, so a mid-week " +
    "Sintra trip will be quieter and cheaper than June — worth checking train times before " +
    "promising it. The two unknowns are lodging and the day-trip cost. I'll pull current " +
    "prices, hold a refundable double for €166 a night, and ask before confirming anything " +
    "with a card. Everything else can be planned around a €130/day rhythm.",
  approved: [
    "### Held — reference LP-88213",
    "",
    "**Lisboa Pessoa Hotel**, a refundable double in the Baixa, 14–17 May. Free cancellation until 12 May, so keeping it costs nothing.",
    "",
    "### Three days, on foot and by tram",
    "",
    "**Day 1 · Alfama**",
    "- Drop bags, climb to **Miradouro de Santa Luzia** — first view of the river, no queue.",
    "- Lunch at **Time Out Market**: two or three small plates, shared.",
    "- Sunset at **Senhora do Monte**, then fado in a tiny Alfama room (€15 each).",
    "",
    "**Day 2 · Belém, slowly**",
    "- Pastéis de Belém before 9am, while the queue is still short.",
    "- Jerónimos cloister (the church is free), then the river walk to MAAT.",
    "- Dinner back through **LX Factory**.",
    "",
    "**Day 3 · Sintra day trip**",
    "- Rossio → Sintra on the CP line: 40 minutes, €4.60 return each.",
    "- Pena booked for 09:30, Quinta da Regaleira after lunch.",
    "- Last train back around 21:00 — no need to rush.",
    "",
    "### Budget",
    "",
    "| Line | Detail | Cost |",
    "| --- | --- | --- |",
    "| Lodging | 2 nights, refundable double | €332 |",
    "| Food | 3 lunches, 2 dinners, pastries | €212 |",
    "| Transport | 72h pass ×2 + Sintra rail | €84 |",
    "| Activities | Pena ×2, Regaleira ×2, fado | €94 |",
    "| **Total** | | **€722** |",
    "",
    "That leaves **€78** — enough for a slow lunch in Sintra or a taxi home in the rain. Want me to keep the reservation, or release it and find something cheaper?",
  ].join("\n"),
  denied: [
    "### Nothing booked",
    "",
    "I released the hold, so there's no charge and nothing to cancel. The plan below still works — it just keeps the €332 lodging line flexible.",
    "",
    "**What I'd do instead:** stay in **Alfama or Graça** rather than the Baixa. Guesthouses there run €130–150 a night in May and put you uphill of the crowds, which is where you wanted to walk anyway.",
    "",
    "The rest of the itinerary is unchanged: Alfama, Belém, and the Sintra day trip. Should I search for a room under €150 a night, or leave lodging to you?",
  ].join("\n"),
  suggestions: ["Swap Sintra for Cascais", "Find a room under €150/night", "Make it a food-only weekend"],
  planTitle: "Trip planner",
  steps: ["Understand the request", "Research current prices", "Draft the itinerary", "Confirm the lodging hold"],
  threadTitle: "Lisbon in three days",
  destination: "Lisbon, PT",
  hotel: "Lisboa Pessoa Hotel",
  interrupt: {
    message: "Hold the refundable double at Lisboa Pessoa Hotel?",
    description: "2 nights, 14–17 May, €332 total. Free cancellation until 12 May. Nothing is charged until check-in.",
    details: [
      { label: "Hotel", value: "Lisboa Pessoa" },
      { label: "Dates", value: "14 – 17 May" },
      { label: "Total", value: "€332" },
    ],
  },
  bookingArgs: {
    hotel: "Lisboa Pessoa Hotel",
    check_in: "2026-05-14",
    nights: 2,
    guests: 2,
    total_eur: 332,
    refundable_until: "2026-05-12",
  },
};

const ZH: DemoContent = {
  prompt:
    "帮我规划一个里斯本三日游：两个人，五月出发，预算 €800 左右。想逛菜市场、看观景台、走走路，再去辛特拉一日游。",
  reasoning:
    "两个人、€800、五月三天。五月是平季，辛特拉放在工作日会比六月安静、也便宜——先查火车班次和票价。" +
    "两个未知数是住宿和一日游成本。我先查现价，订一间每晚 €166 的可免费取消双人房，动卡之前一定先问你。" +
    "其余按每天 €130 的节奏排。",
  approved: [
    "### 已预留 — 订单号 LP-88213",
    "",
    "**里斯本佩索阿酒店**，拜沙区可免费取消的双人房，5 月 14–17 日。5 月 12 日前可免费取消，先留着不花钱。",
    "",
    "### 三天，靠走和电车",
    "",
    "**第一天 · 阿尔法玛**",
    "- 放下行李，爬上**圣卢西亚观景台** —— 第一眼看到河，不用排队。",
    "- 午饭去 **Time Out Market**：点两三份小食分着吃。",
    "- 傍晚去**蒙特圣母观景台**看日落，晚上在阿尔法玛的小屋听法朵（每人 €15）。",
    "",
    "**第二天 · 贝伦，慢慢逛**",
    "- 9 点前去**贝伦蛋挞店**，队伍还短。",
    "- 热罗尼莫斯修道院回廊（教堂免费），再沿河走到 MAAT。",
    "- 晚饭回到 **LX Factory**。",
    "",
    "**第三天 · 辛特拉一日游**",
    "- 罗西奥站坐 CP 线：40 分钟，往返每人 €4.60。",
    "- 佩纳宫订 9:30 的场，午饭后再去雷加莱拉庄园。",
    "- 回程末班车大约 21:00，不用赶。",
    "",
    "### 预算",
    "",
    "| 项目 | 说明 | 花费 |",
    "| --- | --- | --- |",
    "| 住宿 | 两晚，可免费取消双人房 | €332 |",
    "| 餐饮 | 3 顿午饭、2 顿晚饭、蛋挞 | €212 |",
    "| 交通 | 72 小时通票 ×2 + 辛特拉火车 | €84 |",
    "| 门票 | 佩纳宫 ×2、雷加莱拉 ×2、法朵 | €94 |",
    "| **合计** | | **€722** |",
    "",
    "还剩 **€78** —— 够在辛特拉慢慢吃顿午饭，或者下雨时打车回家。要保留这个预订，还是退掉再找更便宜的？",
  ].join("\n"),
  denied: [
    "### 暂未预订",
    "",
    "我把预留释放了，没有扣款，也不用取消。计划照旧，只是把 €332 的住宿一项留作弹性。",
    "",
    "**我的建议**：住**阿尔法玛或格拉萨**，而不是拜沙区。五月的民宿大约 €130–150 一晚，而且你本来就想往坡上走。",
    "",
    "其余行程不变：阿尔法玛、贝伦、辛特拉一日游。要我找 €150 以下的房间，还是住宿你自己定？",
  ].join("\n"),
  suggestions: ["把辛特拉换成卡斯凯什", "找 €150 以下的房间", "改成美食主题周末"],
  planTitle: "行程规划",
  steps: ["理解需求", "查询实时价格", "撰写行程", "确认酒店预留"],
  threadTitle: "里斯本三日",
  destination: "里斯本，葡萄牙",
  hotel: "里斯本佩索阿酒店",
  interrupt: {
    message: "是否预留里斯本佩索阿酒店（可免费取消的双人房）？",
    description: "两晚，5 月 14–17 日，合计 €332。5 月 12 日前可免费取消，入住前不扣款。",
    details: [
      { label: "酒店", value: "里斯本佩索阿" },
      { label: "日期", value: "5 月 14–17 日" },
      { label: "合计", value: "€332" },
    ],
  },
  bookingArgs: {
    hotel: "里斯本佩索阿酒店",
    check_in: "2026-05-14",
    nights: 2,
    guests: 2,
    total_eur: 332,
    refundable_until: "2026-05-12",
  },
};

const CONTENT: Record<Lang, DemoContent> = { en: EN, zh: ZH };

export const promptFor = (lang: Lang): string => CONTENT[lang].prompt;
export const USER_PROMPT = EN.prompt;

const T0 = Date.now();
const at = (ms: number) => new Date(T0 + ms).toISOString();

export function chunkWords(text: string, group = 2): string[] {
  if (/[\u3400-\u9fff]/.test(text)) {
    const chars = Array.from(text);
    const out: string[] = [];
    for (let i = 0; i < chars.length; i += group) out.push(chars.slice(i, i + group).join(""));
    return out;
  }
  const words = text.match(/\S+\s*/g) || [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += group) out.push(words.slice(i, i + group).join(""));
  return out;
}

function pushReasoning(b: Builder, id: string, text: string): void {
  b.push(40, { type: EventType.REASONING_START, messageId: id });
  b.push(30, { type: EventType.REASONING_MESSAGE_START, messageId: id, role: "reasoning" });
  for (const piece of chunkWords(text, 2)) {
    b.push(28, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: id, delta: piece });
  }
  b.push(40, { type: EventType.REASONING_MESSAGE_END, messageId: id });
  b.push(30, { type: EventType.REASONING_END, messageId: id });
}

function stretchEvents(events: TimedEvent[], targetMs: number): TimedEvent[] {
  const total = events[events.length - 1]?.at ?? 0;
  if (!total) return events;
  const scale = targetMs / total;
  return events.map((item) => ({ ...item, at: Math.round(item.at * scale) }));
}

export class Builder {
  list: TimedEvent[] = [];
  cursor = 0;
  constructor(private threadId: string, private runId: string) {}
  push(delay: number, event: BaseEvent): this {
    this.cursor += delay;
    this.list.push({
      at: this.cursor,
      event: { timestamp: at(this.cursor), threadId: this.threadId, runId: this.runId, ...event },
    });
    return this;
  }
  args(toolCallId: string, value: unknown, step: number): this {
    const json = JSON.stringify(value);
    for (let i = 0; i < json.length; i += 7) {
      this.push(step, { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: json.slice(i, i + 7) });
    }
    return this;
  }
}

export interface Decision {
  approved: boolean;
  editedArgs?: Record<string, unknown>;
}

/** Phase 1: reason → research → plan → ask for approval. */
export function buildRunEvents(threadId = THREAD_ID, runId = RUN_FIRST, lang: Lang = "en"): TimedEvent[] {
  const c = CONTENT[lang];
  const b = new Builder(threadId, runId);

  b.push(0, { type: EventType.RUN_STARTED });
  b.push(80, { type: EventType.STEP_STARTED, stepName: lang === "zh" ? "理解需求" : "Understand request" });
  b.push(80, { type: EventType.REASONING_START, messageId: "rsn_1" });
  b.push(40, { type: EventType.REASONING_MESSAGE_START, messageId: "rsn_1", role: "reasoning" });
  for (const piece of chunkWords(c.reasoning, 2)) {
    b.push(26, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: "rsn_1", delta: piece });
  }
  b.push(180, { type: EventType.REASONING_MESSAGE_END, messageId: "rsn_1" });
  b.push(50, { type: EventType.REASONING_END, messageId: "rsn_1" });
  b.push(90, { type: EventType.CUSTOM, name: "reasoning.summary", value: { duration_ms: 1840 } });

  b.push(110, { type: EventType.STEP_FINISHED, stepName: lang === "zh" ? "理解需求" : "Understand request" });
  b.push(70, { type: EventType.STEP_STARTED, stepName: lang === "zh" ? "查资料" : "Research options" });
  b.push(60, {
    type: EventType.TOOL_CALL_START,
    toolCallId: "tc_search",
    toolCallName: "web.search",
    parentMessageId: "msg_asst_1",
  });
  b.args("tc_search", { query: "Lisbon Sintra CP train 2026 return price", max_results: 2 }, 20);
  b.push(70, { type: EventType.TOOL_CALL_END, toolCallId: "tc_search" });
  b.push(600, {
    type: EventType.TOOL_CALL_RESULT,
    messageId: "msg_tool_1",
    role: "tool",
    toolCallId: "tc_search",
    content: JSON.stringify({
      results: [
        { title: "CP — Sintra line timetable & fares", url: "https://www.cp.pt/passageiros/en/train-times", detail: "Rossio–Sintra, 40 min, €4.60 return." },
        { title: "Visit Lisboa — transport passes", url: "https://www.visitlisboa.com/en/plan/transport", detail: "72h pass €21, valid on metro, tram and funicular." },
      ],
    }),
  });

  pushReasoning(
    b,
    "rsn_2",
    lang === "zh"
      ? "火车与交通票的价格已经确认。下一步是把住宿压到可免费取消的价位，再向用户解释 hold 与正式下单的区别，不能把 hold 说成已预订。"
      : "The rail and transport fares are confirmed. Next I need a free-cancellation rate, and I must explain the difference between a hold and an actual booking — a hold is not a confirmed reservation."
  );

  b.push(100, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_asst_0", role: "assistant" });
  for (const piece of chunkWords(
    lang === "zh"
      ? "我先确认了辛特拉火车和 72 小时交通票的价格。按你们两人、五月中旬、慢节奏的偏好，我会把住宿控制在每晚 €166 左右，再留一点预算给观景台和蛋挞。"
      : "I checked the Sintra train and the 72-hour transport pass. For two travellers, mid-May and a slow pace, I will keep lodging around €166/night so there is room for the miradouros and pastéis.",
    2
  )) {
    b.push(34, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "msg_asst_0", delta: piece });
  }
  b.push(80, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_asst_0" });

  b.push(80, { type: EventType.STEP_FINISHED, stepName: lang === "zh" ? "查资料" : "Research options" });
  b.push(60, { type: EventType.STEP_STARTED, stepName: lang === "zh" ? "编写方案" : "Compose plan" });
  b.push(100, {
    type: EventType.STATE_SNAPSHOT,
    snapshot: {
      thread: { id: THREAD_ID, title: c.threadTitle },
      trip: {
        destination: c.destination,
        start: "2026-05-14",
        end: "2026-05-17",
        travelers: 2,
        currency: "EUR",
        budget: 800,
      },
      itinerary: [],
      budget: { lodging: 0, food: 0, transport: 0, activities: 0, total: 0 },
      bookings: [],
      preferences: { pace: "slow", diet: "omnivore", walking: "high" },
    },
  });
  b.push(120, {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: "act_plan_1",
    activityType: "PLAN",
    content: {
      title: c.planTitle,
      steps: c.steps.map((label, i) => ({ id: `s${i + 1}`, label, state: i === 0 ? "done" : i === 1 ? "active" : "pending" })),
    },
    replace: true,
  });
  b.push(170, {
    type: EventType.ACTIVITY_DELTA,
    messageId: "act_plan_1",
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/1/state", value: "done" },
      { op: "replace", path: "/steps/2/state", value: "active" },
    ],
  });
  b.push(120, {
    type: EventType.STATE_DELTA,
    delta: [{ op: "add", path: "/itinerary/-", value: { day: 1, area: lang === "zh" ? "阿尔法玛" : "Alfama" } }],
  });

  b.push(220, {
    type: EventType.TOOL_CALL_START,
    toolCallId: "tc_book",
    toolCallName: "booking.hold",
    parentMessageId: "msg_asst_1",
  });
  b.args("tc_book", c.bookingArgs, 24);
  b.push(70, { type: EventType.TOOL_CALL_END, toolCallId: "tc_book" });

  pushReasoning(
    b,
    "rsn_3",
    lang === "zh"
      ? "酒店与预算已经对齐，现在可以准备 hold。请求审批时要明确总价、取消政策和 hold 的截止时间。"
      : "The hotel and budget now line up, so I can prepare the hold. The approval request should state the total, the cancellation policy and the hold deadline."
  );

  b.push(110, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_asst_1", role: "assistant" });
  for (const piece of chunkWords(
    lang === "zh"
      ? "酒店我选的是可免费取消的房型：两晚 €332，入住前两天可退。现在我先做一个 hold，你确认价格后再正式下单；如果预算想换更低一档，我也可以退回去重选。"
      : "I picked the free-cancellation rate: €332 for two nights, refundable until two days before check-in. I will place a hold now and only book after you confirm the price; if you want a cheaper tier I can step back and reselect.",
    2
  )) {
    b.push(34, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "msg_asst_1", delta: piece });
  }
  b.push(80, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_asst_1" });

  b.push(260, {
    type: EventType.RUN_FINISHED,
    outcome: {
      type: "interrupt",
      interrupts: [
        {
          id: "int_hotel_1",
          reason: "tool_call",
          toolCallId: "tc_book",
          message: c.interrupt.message,
          description: c.interrupt.description,
          details: c.interrupt.details,
          responseSchema: {
            type: "object",
            properties: { approved: { type: "boolean" }, editedArgs: { type: "object" } },
            required: ["approved"],
          },
          metadata: { langgraph: { checkpointId: "ckpt_88f1", nodeId: "tool_executor" } },
        },
      ],
    },
  });

  return stretchEvents(b.list, 14_000);
}

/** Phase 2: resume the interrupted run with the human decision. */
export function buildResumeEvents(
  decisions: Decision | Decision[],
  threadId = THREAD_ID,
  runId = RUN_RESUME,
  lang: Lang = "en"
): TimedEvent[] {
  const list = Array.isArray(decisions) ? decisions : [decisions];
  const decision = list[0] ?? { approved: false };
  const c = CONTENT[lang];
  const b = new Builder(threadId, runId);
  const approved = decision.approved;
  const args = { ...c.bookingArgs, ...(decision.editedArgs || {}) };
  const answer = approved ? c.approved : c.denied;

  b.push(0, { type: EventType.RUN_STARTED });
  b.push(120, {
    type: EventType.TOOL_CALL_RESULT,
    messageId: "msg_tool_2",
    role: "tool",
    toolCallId: "tc_book",
    content: approved
      ? JSON.stringify({ reservation: "LP-88213", status: "confirmed", total_eur: args.total_eur, cancellation: "free until 2026-05-12" })
      : JSON.stringify({ status: "cancelled_by_user" }),
  });
  b.push(80, {
    type: EventType.ACTIVITY_DELTA,
    messageId: "act_plan_1",
    activityType: "PLAN",
    patch: [
      { op: "replace", path: "/steps/2/state", value: "done" },
      { op: "replace", path: "/steps/3/state", value: approved ? "done" : "pending" },
    ],
  });
  b.push(70, {
    type: EventType.STATE_DELTA,
    delta: approved
      ? [
          { op: "add", path: "/bookings/-", value: { ref: "LP-88213", hotel: args.hotel, total_eur: args.total_eur, status: "confirmed" } },
          { op: "replace", path: "/budget/lodging", value: args.total_eur },
        ]
      : [{ op: "add", path: "/notes/-", value: lang === "zh" ? "住宿留空——用户拒绝了预订" : "lodging left open — user declined hold" }],
  });

  pushReasoning(
    b,
    "rsn_4",
    lang === "zh"
      ? approved
        ? "审批结果已通过。先写入订单与预算，再向用户确认取消政策和后续需要手动确认的项。"
        : "审批被拒绝。不要写入订单，保持预算与状态一致，并明确告诉用户住宿仍留空。"
      : approved
        ? "The approval came back positive. Commit the booking and budget first, then confirm the cancellation policy and the remaining manual checks."
        : "The approval was declined. Do not commit the booking; keep budget and state consistent and say clearly that lodging stays open."
  );

  b.push(110, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_asst_2", role: "assistant" });
  chunkWords(answer, 2).forEach((piece, i) => {
    b.push(24 + (i % 3) * 5, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "msg_asst_2", delta: piece });
    const midDeltas: Record<number, JsonPatchOp[]> = {
      10: [{ op: "replace", path: "/itinerary/0/area", value: lang === "zh" ? "阿尔法玛" : "Alfama" }, { op: "add", path: "/itinerary/-", value: { day: 2, area: lang === "zh" ? "贝伦" : "Belém" } }],
      22: [{ op: "replace", path: "/budget/food", value: 212 }, { op: "replace", path: "/budget/transport", value: 84 }],
      32: [{ op: "add", path: "/itinerary/-", value: { day: 3, area: lang === "zh" ? "辛特拉" : "Sintra" } }, { op: "replace", path: "/budget/activities", value: 94 }],
    };
    if (midDeltas[i]) b.push(0, { type: EventType.STATE_DELTA, delta: midDeltas[i] });
  });

  b.push(100, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_asst_2" });
  b.push(80, {
    type: EventType.STATE_DELTA,
    delta: [
      { op: "replace", path: "/budget/total", value: 722 },
      { op: "replace", path: "/bookings/0/status", value: approved ? "confirmed" : "cancelled" },
    ],
  });
  b.push(110, { type: EventType.STEP_FINISHED, stepName: lang === "zh" ? "编写方案" : "Compose plan" });
  b.push(80, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
  b.push(220, { type: EventType.CUSTOM, name: "suggestions", value: c.suggestions });

  return stretchEvents(b.list, 22_000);
}
