import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import { ConversationStore } from "../src/core/store";
import { buildAgentInput, buildResumeInput, messagesFromEntries } from "../src/core/agui";
import type { Entry } from "../src/core/events";

const entries = [
  { kind: "user", id: "u1", at: 1, text: "hello" },
  { kind: "assistant", id: "a1", at: 2, text: "hi", streaming: false },
  { kind: "tool", id: "tc1", at: 3, name: "search", argsRaw: '{"q":"x"}', args: { q: "x" }, status: "done", result: { ok: true } },
  { kind: "reasoning", id: "r1", at: 4, text: "why", streaming: false, tokens: 1 },
] as unknown as Entry[];

const readBody = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")));
  });

function sendEvent(res: ServerResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

describe("standard RunAgentInput", () => {
  it("keeps only protocol messages and pairs tool entries with an assistant call", () => {
    const messages = messagesFromEntries(entries);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant", "tool"]);
    expect(messages[2].toolCalls?.[0]).toMatchObject({ id: "tc1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } });
    expect(messages[3]).toMatchObject({ role: "tool", toolCallId: "tc1" });
    expect(messages.some((message) => message.role === "reasoning" as never)).toBe(false);
  });

  it("builds a standard input with thread/run/state/tools/context", () => {
    const input = buildAgentInput({ threadId: "t1", runId: "r1", entries, state: { a: 1 } });
    expect(input).toMatchObject({ threadId: "t1", runId: "r1", state: { a: 1 }, tools: [], context: [] });
    expect(input.messages).toHaveLength(4);
    expect(input.resume).toBeUndefined();
  });

  it("uses the documented resume entries", () => {
    const input = buildResumeInput({
      threadId: "t1",
      runId: "r2",
      state: {},
      decisions: [{ interruptId: "int_1", approved: true, editedArgs: { total: 10 } }],
    });
    expect(input.messages).toEqual([]);
    expect(input.resume).toEqual([
      { interruptId: "int_1", status: "resolved", payload: { approved: true, editedArgs: { total: 10 } } },
    ]);
    const declined = buildResumeInput({
      threadId: "t1",
      runId: "r2",
      state: {},
      decisions: [{ interruptId: "int_2", approved: false }],
    });
    expect(declined.resume?.[0]).toMatchObject({ status: "cancelled", payload: { approved: false } });
  });
});

describe("direct AG-UI endpoint (no bridge contract)", () => {
  afterEach(() => {
    /* servers are closed per test */
  });

  it("drives the store and skins from a standard POST/SSE service", async () => {
    let requests = 0;
    const server = createServer(async (req, res) => {
      requests += 1;
      await readBody(req);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      sendEvent(res, { type: "RUN_STARTED", threadId: "thread_direct", runId: "run_direct" });
      sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" });
      sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hello from any AG-UI service" });
      sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: "m1" });
      sendEvent(res, { type: "RUN_FINISHED", outcome: { type: "success" } });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const store = new ConversationStore(false);
    store.setBackend("agui");
    store.setAgentEndpoint({ url: `http://127.0.0.1:${port}/agui` });
    store.send("ping");

    for (let i = 0; i < 100 && store.status !== "done"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(requests).toBe(1);
    expect(store.status).toBe("done");
    expect(store.threadId).toBe("thread_direct");
    expect(store.runId).toBe("run_direct");
    expect(store.transport).toContain("AG-UI");
    expect(store.suggestions).toEqual([]);
    expect(store.capabilities).toEqual({});
    expect(store.entries.find((entry) => entry.kind === "assistant")).toMatchObject({
      text: "hello from any AG-UI service",
    });

    const AuroraPage = skins.find((skin) => skin.id === "aurora")!.ChatPage;
    const { container } = render(
      <SkinHostProvider conversation={store} lang="en" branding={{ agentName: "Endpoint Agent", modelLabel: "remote" }}>
        <AuroraPage />
      </SkinHostProvider>
    );
    expect(container.textContent).toContain("hello from any AG-UI service");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends a standard resume payload when an interrupt is resolved", async () => {
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    const server = createServer(async (req, res) => {
      bodies.push(await readBody(req));
      call += 1;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (call === 1) {
        sendEvent(res, { type: "RUN_STARTED", threadId: "thread_resume", runId: "run_1" });
        sendEvent(res, {
          type: "RUN_FINISHED",
          outcome: {
            type: "interrupt",
            interrupts: [{ id: "int_9", reason: "confirmation", message: "ok?" }],
          },
        });
      } else {
        sendEvent(res, { type: "RUN_STARTED", threadId: "thread_resume", runId: "run_2" });
        sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: "m2", role: "assistant" });
        sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: "m2", delta: "done" });
        sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: "m2" });
        sendEvent(res, { type: "RUN_FINISHED", outcome: { type: "success" } });
      }
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const store = new ConversationStore(false);
    store.setBackend("agui");
    store.setAgentEndpoint({ url: `http://127.0.0.1:${port}/agui` });
    store.send("book it");
    for (let i = 0; i < 100 && store.status !== "interrupted"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(store.status).toBe("interrupted");

    store.resolveInterrupt(true);
    for (let i = 0; i < 100 && store.status !== "done"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(bodies).toHaveLength(2);
    expect(bodies[1].resume).toEqual([
      { interruptId: "int_9", status: "resolved", payload: { approved: true } },
    ]);
    expect(store.lastAgentResume?.[0]).toMatchObject({ interruptId: "int_9", status: "resolved" });

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
