/* ═══════════════════════════════════════════════════════════════════════
   agui.js — a tiny, dependency-free AG-UI protocol layer.

   It models the parts of the protocol a conversation UI actually needs:
     · typed events (lifecycle / text / tool / state / reasoning / activity)
     · STATE_SNAPSHOT + STATE_DELTA via JSON Patch (RFC 6902)
     · RUN_FINISHED.outcome = interrupt, and resume payloads
   The demo agent is scripted (MockTransport). HttpAgentTransport below is
   the drop-in shape for a real SSE endpoint.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const EventType = Object.freeze({
    RUN_STARTED: "RUN_STARTED",
    RUN_FINISHED: "RUN_FINISHED",
    RUN_ERROR: "RUN_ERROR",
    STEP_STARTED: "STEP_STARTED",
    STEP_FINISHED: "STEP_FINISHED",
    TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
    TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
    TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
    TEXT_MESSAGE_CHUNK: "TEXT_MESSAGE_CHUNK",
    TOOL_CALL_START: "TOOL_CALL_START",
    TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
    TOOL_CALL_END: "TOOL_CALL_END",
    TOOL_CALL_RESULT: "TOOL_CALL_RESULT",
    TOOL_CALL_CHUNK: "TOOL_CALL_CHUNK",
    STATE_SNAPSHOT: "STATE_SNAPSHOT",
    STATE_DELTA: "STATE_DELTA",
    MESSAGES_SNAPSHOT: "MESSAGES_SNAPSHOT",
    ACTIVITY_SNAPSHOT: "ACTIVITY_SNAPSHOT",
    ACTIVITY_DELTA: "ACTIVITY_DELTA",
    REASONING_START: "REASONING_START",
    REASONING_MESSAGE_START: "REASONING_MESSAGE_START",
    REASONING_MESSAGE_CONTENT: "REASONING_MESSAGE_CONTENT",
    REASONING_MESSAGE_END: "REASONING_MESSAGE_END",
    REASONING_END: "REASONING_END",
    REASONING_ENCRYPTED_VALUE: "REASONING_ENCRYPTED_VALUE",
    RAW: "RAW",
    CUSTOM: "CUSTOM",
  });

  /* ── JSON Patch (RFC 6902) — the subset AG-UI producers emit ────────── */
  function parsePointer(path) {
    if (path === "") return [];
    return path
      .split("/")
      .slice(1)
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  }

  function getAt(doc, tokens) {
    let node = doc;
    for (const t of tokens) {
      if (node == null) return undefined;
      node = node[t];
    }
    return node;
  }

  function setAt(doc, tokens, value) {
    if (tokens.length === 0) return value;
    const parent = getAt(doc, tokens.slice(0, -1));
    parent[tokens[tokens.length - 1]] = value;
    return doc;
  }

  function removeAt(doc, tokens) {
    if (tokens.length === 0) return undefined;
    const parent = getAt(doc, tokens.slice(0, -1));
    const key = tokens[tokens.length - 1];
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
    return doc;
  }

  /**
   * Apply an array of JSON Patch operations to `doc` in place.
   * Returns the list of touched paths, so the UI can flash changed nodes.
   */
  function applyPatch(doc, operations) {
    const touched = [];
    for (const op of operations || []) {
      const tokens = parsePointer(op.path);
      switch (op.op) {
        case "add": {
          const last = tokens[tokens.length - 1];
          const parent = getAt(doc, tokens.slice(0, -1));
          if (Array.isArray(parent) && last === "-") parent.push(op.value);
          else if (Array.isArray(parent)) parent.splice(Number(last), 0, op.value);
          else if (tokens.length === 0) doc = op.value;
          else parent[last] = op.value;
          break;
        }
        case "replace":
          if (tokens.length === 0) doc = op.value;
          else setAt(doc, tokens, op.value);
          break;
        case "remove":
          if (tokens.length === 0) doc = undefined;
          else removeAt(doc, tokens);
          break;
        case "test": {
          const current = getAt(doc, tokens);
          if (JSON.stringify(current) !== JSON.stringify(op.value)) {
            throw new Error("JSON Patch test failed at " + op.path);
          }
          break;
        }
        default:
          throw new Error("Unsupported JSON Patch op: " + op.op);
      }
      touched.push(op.path);
    }
    return { doc, touched };
  }

  /* ── token estimate (chars / 4, the usual rule of thumb) ────────────── */
  const estimateTokens = (text) => Math.round((text || "").length / 4);

  /* ═════════════════════════════════════════════════════════════════════
     Scripted demo agent
     ═════════════════════════════════════════════════════════════════════ */

  const THREAD_ID = "thread_01J9F2QP";
  const RUN_1 = "run_7K2A";
  const RUN_2 = "run_7K2B";
  const T0 = Date.now();

  const REASONING = [
    "Two people, €800 all-in, three days in May. May is shoulder season here, so a mid-week",
    " Sintra trip will be quieter and cheaper than June — worth checking train times before",
    " promising it. The two unknowns are lodging and the day-trip cost. I'll pull current",
    " prices, hold a refundable double for €166 a night, and ask before confirming anything",
    " with a card. Everything else can be planned around a €130/day rhythm.",
  ].join("");

  const ANSWER_APPROVED = [
    "### Held — reference LP-88213\n\n",
    "**Lisboa Pessoa Hotel**, a refundable double in the Baixa, 14–17 May. Free cancellation",
    " until 12 May, so keeping it costs nothing.\n\n",
    "### Three days, on foot and by tram\n\n",
    "**Day 1 · Alfama**\n",
    "- Drop bags, climb to **Miradouro de Santa Luzia** — first view of the river, no queue.\n",
    "- Lunch at **Time Out Market**: two or three small plates, shared.\n",
    "- Sunset at **Senhora do Monte**, then fado in a tiny Alfama room (€15 each).\n\n",
    "**Day 2 · Belém, slowly**\n",
    "- Pastéis de Belém before 9am, while the queue is still short.\n",
    "- Jerónimos cloister (the church is free), then the river walk to MAAT.\n",
    "- Dinner back through **LX Factory**.\n\n",
    "**Day 3 · Sintra day trip**\n",
    "- Rossio → Sintra on the CP line: 40 minutes, €4.60 return each.\n",
    "- Pena booked for 09:30, Quinta da Regaleira after lunch.\n",
    "- Last train back around 21:00 — no need to rush.\n\n",
    "### Budget\n\n",
    "| Line | Detail | Cost |\n| --- | --- | --- |\n",
    "| Lodging | 2 nights, refundable double | €332 |\n",
    "| Food | 3 lunches, 2 dinners, pastries | €212 |\n",
    "| Transport | 72h pass ×2 + Sintra rail | €84 |\n",
    "| Activities | Pena ×2, Regaleira ×2, fado | €94 |\n",
    "| **Total** | | **€722** |\n\n",
    "That leaves **€78** — enough for a slow lunch in Sintra or a taxi home in the rain.",
    " Want me to keep the reservation, or release it and find something cheaper?",
  ].join("");

  const ANSWER_DENIED = [
    "### Nothing booked\n\n",
    "I released the hold, so there's no charge and nothing to cancel. The plan below still",
    " works — it just keeps the €332 lodging line flexible.\n\n",
    "**What I'd do instead:** stay in **Alfama or Graça** rather than the Baixa. Guesthouses",
    " there run €130–150 a night in May and put you uphill of the crowds, which is where you",
    " wanted to walk anyway.\n\n",
    "The rest of the itinerary is unchanged: Alfama, Belém, and the Sintra day trip. Should I",
    " search for a room under €150 a night, or leave lodging to you?",
  ].join("");

  const SUGGESTIONS = [
    "Swap Sintra for Cascais",
    "Find a room under €150/night",
    "Make it a food-only weekend",
  ];

  function at(ms) {
    return new Date(T0 + ms).toISOString();
  }

  function chunkText(text, size) {
    const out = [];
    const re = /\S+\s*|\s+/g;
    let m;
    while ((m = re.exec(text))) out.push(m[0]);
    // group words so long answers don't take forever
    const grouped = [];
    for (let i = 0; i < out.length; i += size) grouped.push(out.slice(i, i + size).join(""));
    return grouped;
  }

  function makeBuilder(ctx) {
    const list = [];
    let cursor = 0;
    function push(delay, event) {
      cursor += delay;
      list.push({
        at: cursor,
        event: Object.assign(
          { timestamp: at(cursor), threadId: ctx.threadId, runId: ctx.runId },
          event
        ),
      });
      return list[list.length - 1];
    }
    return { list, push };
  }

  const PLAN = {
    messageId: "act_plan_1",
    activityType: "PLAN",
    content: {
      title: "Trip planner",
      steps: [
        { id: "s1", label: "Understand the request", state: "done" },
        { id: "s2", label: "Research current prices", state: "active" },
        { id: "s3", label: "Draft the itinerary", state: "pending" },
        { id: "s4", label: "Confirm the lodging hold", state: "pending" },
      ],
    },
  };

  const SNAPSHOT = {
    thread: { id: THREAD_ID, title: "Lisbon in three days" },
    trip: {
      destination: "Lisbon, PT",
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
  };

  const BOOKING_ARGS = {
    hotel: "Lisboa Pessoa Hotel",
    check_in: "2026-05-14",
    nights: 2,
    guests: 2,
    total_eur: 332,
    refundable_until: "2026-05-12",
  };

  function streamToolArgs(b, toolCallId, args, step) {
    const json = JSON.stringify(args);
    const pieces = json.match(/.{1,7}/gs) || [];
    for (const piece of pieces) b.push(step, { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: piece });
  }

  /** Phase 1 — research, plan, draft, then stop for human approval. */
  function buildRun(ctx) {
    const b = makeBuilder(ctx);
    b.push(0, { type: EventType.RUN_STARTED });
    b.push(80, { type: EventType.STEP_STARTED, stepName: "understand" });
    b.push(90, { type: EventType.REASONING_START, messageId: "rsn_1" });
    b.push(40, { type: EventType.REASONING_MESSAGE_START, messageId: "rsn_1", role: "reasoning" });

    for (const piece of chunkText(REASONING, 2)) {
      b.push(26, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: "rsn_1", delta: piece });
    }
    b.push(180, { type: EventType.REASONING_MESSAGE_END, messageId: "rsn_1" });
    b.push(60, { type: EventType.REASONING_END, messageId: "rsn_1" });
    b.push(90, {
      type: EventType.CUSTOM,
      name: "reasoning.summary",
      value: { summary: "Two travellers, €800, three days. Check Sintra rail, hold a refundable double.", duration_ms: 1840 },
    });

    b.push(120, { type: EventType.STEP_FINISHED, stepName: "understand" });
    b.push(80, { type: EventType.STEP_STARTED, stepName: "research" });

    b.push(60, { type: EventType.TOOL_CALL_START, toolCallId: "tc_search", toolCallName: "web.search", parentMessageId: "msg_asst_1" });
    streamToolArgs(b, "tc_search", { query: "Lisbon Sintra CP train 2026 return price", max_results: 2 }, 22);
    b.push(70, { type: EventType.TOOL_CALL_END, toolCallId: "tc_search" });

    b.push(620, {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "msg_tool_1",
      role: "tool",
      toolCallId: "tc_search",
      content: JSON.stringify({
        results: [
          { title: "CP — Sintra line timetable & fares", url: "https://www.cp.pt/passageiros/en/train-times", snippet: "Rossio–Sintra, 40 min, €4.60 return." },
          { title: "Visit Lisboa — transport passes", url: "https://www.visitlisboa.com/en/plan/transport", snippet: "72h pass €21, valid on metro, tram and funicular." },
        ],
      }),
    });

    b.push(80, { type: EventType.STEP_FINISHED, stepName: "research" });
    b.push(60, { type: EventType.STEP_STARTED, stepName: "compose" });

    b.push(100, { type: EventType.STATE_SNAPSHOT, snapshot: JSON.parse(JSON.stringify(SNAPSHOT)) });
    b.push(120, { type: EventType.ACTIVITY_SNAPSHOT, messageId: PLAN.messageId, activityType: PLAN.activityType, content: PLAN.content, replace: true });
    b.push(180, {
      type: EventType.ACTIVITY_DELTA,
      messageId: PLAN.messageId,
      activityType: PLAN.activityType,
      patch: [
        { op: "replace", path: "/steps/1/state", value: "done" },
        { op: "replace", path: "/steps/2/state", value: "active" },
      ],
    });

    b.push(120, { type: EventType.STATE_DELTA, delta: [{ op: "add", path: "/itinerary/-", value: { day: 1, area: "Alfama" } }] });
    b.push(240, { type: EventType.TOOL_CALL_START, toolCallId: "tc_book", toolCallName: "booking.hold", parentMessageId: "msg_asst_1" });
    streamToolArgs(b, "tc_book", BOOKING_ARGS, 26);
    b.push(80, { type: EventType.TOOL_CALL_END, toolCallId: "tc_book" });

    b.push(280, {
      type: EventType.RUN_FINISHED,
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "int_hotel_1",
            reason: "tool_call",
            toolCallId: "tc_book",
            message: "Hold the refundable double at Lisboa Pessoa Hotel?",
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

    return b.list;
  }

  /** Phase 2 — resume the interrupted run with the human's decision. */
  function buildResume(ctx, decision) {
    const b = makeBuilder(ctx);
    const approved = decision.approved;
    const args = Object.assign({}, BOOKING_ARGS, decision.editedArgs || {});

    b.push(0, { type: EventType.RUN_STARTED });
    b.push(140, {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "msg_tool_2",
      role: "tool",
      toolCallId: "tc_book",
      content: approved
        ? JSON.stringify({ reservation: "LP-88213", status: "confirmed", total_eur: args.total_eur, cancellation: "free until 2026-05-12" })
        : JSON.stringify({ status: "cancelled_by_user" }),
    });

    b.push(90, {
      type: EventType.ACTIVITY_DELTA,
      messageId: PLAN.messageId,
      activityType: PLAN.activityType,
      patch: [
        { op: "replace", path: "/steps/2/state", value: "done" },
        { op: "replace", path: "/steps/3/state", value: approved ? "done" : "pending" },
      ],
    });

    b.push(80, {
      type: EventType.STATE_DELTA,
      delta: approved
        ? [
            { op: "add", path: "/bookings/-", value: { ref: "LP-88213", hotel: args.hotel, total_eur: args.total_eur, status: "confirmed" } },
            { op: "replace", path: "/budget/lodging", value: args.total_eur },
          ]
        : [{ op: "add", path: "/notes/-", value: "lodging left open — user declined hold" }],
    });

    b.push(120, { type: EventType.TEXT_MESSAGE_START, messageId: "msg_asst_2", role: "assistant" });

    const answer = approved ? ANSWER_APPROVED : ANSWER_DENIED;
    const pieces = chunkText(answer, 2);
    pieces.forEach((piece, i) => {
      b.push(24 + (i % 3) * 6, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "msg_asst_2", delta: piece });

      // interleave state updates so the inspector has something to show
      if (i === 14) b.push(0, { type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/itinerary/0/area", value: "Alfama" }, { op: "add", path: "/itinerary/-", value: { day: 2, area: "Belém" } }] });
      if (i === 30) b.push(0, { type: EventType.STATE_DELTA, delta: [{ op: "add", path: "/itinerary/-", value: { day: 3, area: "Sintra" } }, { op: "replace", path: "/budget/food", value: 212 }] });
      if (i === 46) b.push(0, { type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/budget/transport", value: 84 }, { op: "replace", path: "/budget/activities", value: 94 }] });
    });

    b.push(120, { type: EventType.TEXT_MESSAGE_END, messageId: "msg_asst_2" });
    b.push(90, {
      type: EventType.STATE_DELTA,
      delta: [{ op: "replace", path: "/budget/total", value: 722 }, { op: "replace", path: "/bookings/0/status", value: approved ? "confirmed" : "cancelled" }],
    });
    b.push(120, { type: EventType.STEP_FINISHED, stepName: "compose" });
    b.push(80, { type: EventType.RUN_FINISHED, outcome: { type: "success" } });
    b.push(240, { type: EventType.CUSTOM, name: "suggestions", value: SUGGESTIONS });

    return b.list;
  }

  /* ── scheduler ────────────────────────────────────────────────────── */
  function play(events, onEvent, options) {
    const opts = Object.assign({ speed: 0.9 }, options);
    let cancelled = false;
    let timer = null;
    let index = 0;

    const promise = new Promise((resolve) => {
      function tick() {
        if (cancelled) return resolve({ cancelled: true });
        const item = events[index++];
        if (!item) return resolve({ cancelled: false });
        try {
          onEvent(item.event, index, item);
        } catch (err) {
          console.error("[agui] handler error", err, item.event);
        }
        const next = events[index];
        timer = setTimeout(tick, next ? Math.max(0, (next.at - item.at) / opts.speed) : 0);
      }
      tick();
    });

    return {
      promise,
      cancel() {
        cancelled = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  /* ═════════════════════════════════════════════════════════════════════
     Real transport — kept as the integration seam for a live agent.
     Usage:
       const t = new HttpAgentTransport({ url: "https://agent.local/run" });
       for await (const event of t.run({ threadId, runId, messages, state, tools })) { … }
     ═════════════════════════════════════════════════════════════════════ */
  class HttpAgentTransport {
    constructor({ url, headers }) {
      this.url = url;
      this.headers = headers || {};
    }
    async *run(input, signal) {
      const res = await fetch(this.url, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json", Accept: "text/event-stream" }, this.headers),
        body: JSON.stringify(input),
        signal,
      });
      if (!res.ok) throw new Error("AG-UI transport error " + res.status);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (data) yield JSON.parse(data);
        }
      }
    }
  }

  global.AGUI = {
    EventType,
    applyPatch,
    estimateTokens,
    play,
    ThreadId: THREAD_ID,
    RunIds: { first: RUN_1, resume: RUN_2 },
    build: {
      run: () => buildRun({ threadId: THREAD_ID, runId: RUN_1 }),
      resume: (decision) => buildResume({ threadId: THREAD_ID, runId: RUN_2 }, decision),
    },
    MockMode: true,
    HttpAgentTransport,
  };
})(window);
