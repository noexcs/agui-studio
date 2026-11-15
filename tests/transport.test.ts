import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgentTransport } from "../src/core/transport";
import { EventType, type BaseEvent } from "../src/core/events";

/* Byte-accurate SSE fixtures: every string becomes one read() chunk, so
   half-frames and coalesced frames are simulated at the byte level. */
const sseStream = (chunks: string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
};

type FakeResponse = { ok: boolean; status?: number; body?: ReadableStream<Uint8Array> | null };
const stubFetch = (response: FakeResponse) => {
  const fetchMock = vi.fn(async () => response as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const collect = (gen: AsyncGenerator<BaseEvent>) =>
  (async () => {
    const out: BaseEvent[] = [];
    for await (const event of gen) out.push(event);
    return out;
  })();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpAgentTransport", () => {
  it("streams frames as events in order and POSTs the run input", async () => {
    const fetchMock = stubFetch({
      ok: true,
      body: sseStream([
        'data: {"type":"RUN_STARTED","threadId":"t1"}\n\n',
        'data: {"type":"TEXT_MESSAGE_START","messageId":"m1"}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"hi"}\n\n',
        'data: {"type":"RUN_FINISHED"}\n\n',
      ]),
    });
    const transport = new HttpAgentTransport({ url: "https://agent.example/run" });

    const events = await collect(transport.run({ text: "hi" }));

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.RUN_FINISHED,
    ]);
    expect(events[2].delta).toBe("hi");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://agent.example/run");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ text: "hi" }));
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Accept: "text/event-stream" });
  });

  it("treats CRLF delimiters the same as LF ones", async () => {
    stubFetch({
      ok: true,
      body: sseStream([
        'data: {"type":"RUN_STARTED"}\r\n\r\n',
        'data: {"type":"TEXT_MESSAGE_CHUNK","messageId":"m1",\r\ndata: "delta":"crlf"}\r\n\r\n',
        'data: {"type":"RUN_FINISHED"}\r\n\r\n',
      ]),
    });

    const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_CHUNK,
      EventType.RUN_FINISHED,
    ]);
    expect(events[1].delta).toBe("crlf");
  });

  it("reassembles a CRLF delimiter that straddles two chunks", async () => {
    stubFetch({
      ok: true,
      body: sseStream([
        'data: {"type":"RUN_STARTED"}\r',
        '\n\r\ndata: {"type":"TEXT_MESSAGE_CHUNK","messageId":"m1","delta":"split"}\n\n',
      ]),
    });

    const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

    expect(events.map((event) => event.type)).toEqual([EventType.RUN_STARTED, EventType.TEXT_MESSAGE_CHUNK]);
    expect(events[1].delta).toBe("split");
  });

  it("joins multi-line data fields into one payload", async () => {
    stubFetch({
      ok: true,
      body: sseStream(['data: {"type":"TEXT_MESSAGE_CHUNK","messageId":"m1",\ndata: "delta":"multi"}\n\n']),
    });

    const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

    expect(events).toEqual([{ type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", delta: "multi" }]);
  });

  it("reassembles a half-frame split across chunks", async () => {
    stubFetch({
      ok: true,
      body: sseStream([
        'data: {"type":"TE',
        'XT_MESSAGE_CHUNK","messageId":"m1","delta":"half"}\n\n',
        'data: {"type":"RUN_FINISHED"}\n\n',
      ]),
    });

    const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

    expect(events.map((event) => event.type)).toEqual([EventType.TEXT_MESSAGE_CHUNK, EventType.RUN_FINISHED]);
    expect(events[0].delta).toBe("half");
  });

  it("yields every complete frame coalesced into one chunk", async () => {
    stubFetch({
      ok: true,
      body: sseStream([
        'data: {"type":"RUN_STARTED"}\n\ndata: {"type":"TEXT_MESSAGE_START","messageId":"m1"}\n\ndata: {"type":"RUN_FINISHED"}\n\n',
      ]),
    });

    const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.RUN_FINISHED,
    ]);
  });

  it("drops frames without a type field and keeps streaming", async () => {
    stubFetch({
      ok: true,
      body: sseStream([
        'data: {"type":"RUN_STARTED"}\n\n',
        'data: {"keepalive":true}\n\n',
        'data: {}\n\n',
        'data: {"type":"TEXT_MESSAGE_CHUNK","messageId":"m1","delta":"after"}\n\n',
        'data: {"type":"RUN_FINISHED"}\n\n',
      ]),
    });

    const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_CHUNK,
      EventType.RUN_FINISHED,
    ]);
    expect(events[1].delta).toBe("after");
  });

  it("surfaces a schema-violating event as RUN_ERROR instead of emitting it (P1-6)", async () => {
    stubFetch({
      ok: true,
      body: sseStream([
        'data: {"type":"RUN_STARTED"}\n\n',
        // recognized type, malformed payload: no delta — the old transport
        // yielded it and the store half-applied it
        'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1"}\n\n',
        'data: {"type":"TEXT_MESSAGE_CHUNK","messageId":"m1","delta":"never"}\n\n',
      ]),
    });

    const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

    expect(events.map((event) => event.type)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(events[1].message).toContain("TEXT_MESSAGE_CONTENT");
    expect(events[1].message).toContain("delta");
  });

  it("keeps extension event types from newer producers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      stubFetch({
        ok: true,
        body: sseStream([
          'data: {"type":"RUN_STARTED"}\n\n',
          'data: {"type":"FUTURE_EVENT","payload":{"a":1}}\n\n',
        ]),
      });

      const events = await collect(new HttpAgentTransport({ url: "x" }).run({}));

      expect(events.map((event) => event.type)).toEqual([EventType.RUN_STARTED, "FUTURE_EVENT"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("fails fast on a malformed JSON frame", async () => {
    stubFetch({
      ok: true,
      body: sseStream(['data: {"type":"RUN_STARTED"}\n\n', 'data: {"type":"RUN_FINISHED"\n\n']),
    });

    await expect(collect(new HttpAgentTransport({ url: "x" }).run({}))).rejects.toThrow(SyntaxError);
  });

  it("fails fast on a JSON frame that is not an object", async () => {
    stubFetch({ ok: true, body: sseStream(['data: 42\n\n']) });
    await expect(collect(new HttpAgentTransport({ url: "x" }).run({}))).rejects.toThrow("not a JSON object");

    stubFetch({ ok: true, body: sseStream(['data: [1,2]\n\n']) });
    await expect(collect(new HttpAgentTransport({ url: "x" }).run({}))).rejects.toThrow("not a JSON object");
  });

  it("stops emitting events after abort", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    let parked = false;
    // After the first frame the stream parks the next read() on the real
    // AbortSignal, then errors exactly like a fetch body does on abort.
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('data: {"type":"RUN_STARTED"}\n\n'));
      },
      pull(c) {
        if (parked) return;
        parked = true;
        return new Promise<void>((resolve) => {
          const onAbort = () => {
            c.error(new DOMException("This operation was aborted", "AbortError"));
            resolve();
          };
          if (controller.signal.aborted) return onAbort();
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({ ok: true, body }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const transport = new HttpAgentTransport({ url: "x" });
    const events: BaseEvent[] = [];
    let caught: unknown;
    try {
      for await (const event of transport.run({}, controller.signal)) {
        events.push(event);
        controller.abort();
      }
    } catch (err) {
      caught = err;
    }

    expect(events).toEqual([{ type: EventType.RUN_STARTED }]);
    expect((caught as Error)?.name).toBe("AbortError");
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("throws with the response status when the server errors", async () => {
    stubFetch({ ok: false, status: 500 });

    await expect(collect(new HttpAgentTransport({ url: "x" }).run({}))).rejects.toThrow("AG-UI transport error 500");
  });

  it("throws when the response has no body", async () => {
    stubFetch({ ok: true, body: null });

    await expect(collect(new HttpAgentTransport({ url: "x" }).run({}))).rejects.toThrow("empty stream");
  });
});
