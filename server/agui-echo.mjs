#!/usr/bin/env node
/**
 * Reference AG-UI endpoint (dev only) — the smallest possible standard service.
 *
 *   POST /agui   body: RunAgentInput (threadId, runId, messages, state, resume…)
 *   response:    text/event-stream with AG-UI events
 *
 * It deliberately emits *only* protocol events (no CUSTOM suggestions, no
 * backend-specific payloads) so the studio's direct mode can be exercised
 * against a third-party-shaped agent. Any service that speaks the same
 * contract can replace it.
 *
 *   node server/agui-echo.mjs      # http://127.0.0.1:5180/agui
 */
import { createServer } from "node:http";

const PORT = Number(process.env.AGUI_ECHO_PORT || 5180);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404, CORS);
    res.end("POST an AG-UI RunAgentInput to /agui");
    return;
  }

  let input;
  try {
    input = await readBody(req);
  } catch {
    res.writeHead(400, CORS);
    res.end("invalid JSON");
    return;
  }

  const threadId = input.threadId || `thread_${Date.now().toString(36)}`;
  const runId = input.runId || `run_${Date.now().toString(36)}`;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...CORS,
  });
  const send = (event) =>
    res.write(`data: ${JSON.stringify({ threadId, runId, timestamp: new Date().toISOString(), ...event })}\n\n`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const close = () => res.end();

  try {
    send({ type: "RUN_STARTED", metadata: { provider: "agui-echo", echo: true } });
    await wait(30);

    if (Array.isArray(input.resume) && input.resume.length) {
      const decisions = input.resume.map((item) => item.status).join(", ");
      send({ type: "STEP_STARTED", stepName: "resume" });
      send({ type: "TEXT_MESSAGE_START", messageId: "msg_resume", role: "assistant" });
      send({ type: "TEXT_MESSAGE_CONTENT", messageId: "msg_resume", delta: `Resumed with ${input.resume.length} decision(s): ${decisions}.` });
      send({ type: "TEXT_MESSAGE_END", messageId: "msg_resume" });
      send({ type: "STEP_FINISHED", stepName: "resume" });
      send({ type: "RUN_FINISHED", outcome: { type: "success" } });
      close();
      return;
    }

    const lastUser = [...(input.messages || [])].reverse().find((message) => message.role === "user");
    const prompt = String(lastUser?.content ?? "").slice(0, 120);

    send({ type: "STEP_STARTED", stepName: "respond" });
    send({
      type: "STATE_SNAPSHOT",
      snapshot: { echo: { prompt, threadId }, turns: (input.messages || []).length },
    });
    send({ type: "TEXT_MESSAGE_START", messageId: "msg_echo", role: "assistant" });
    const text = `AG-UI echo (standard RunAgentInput): "${prompt}". Received ${input.messages?.length ?? 0} message(s), state keys: ${Object.keys(input.state ?? {}).length}.`;
    for (let i = 0; i < text.length; i += 12) {
      send({ type: "TEXT_MESSAGE_CONTENT", messageId: "msg_echo", delta: text.slice(i, i + 12) });
      await wait(15);
    }
    send({ type: "TEXT_MESSAGE_END", messageId: "msg_echo" });
    send({ type: "STEP_FINISHED", stepName: "respond" });
    send({ type: "RUN_FINISHED", outcome: { type: "success" } });
  } catch (error) {
    send({ type: "RUN_ERROR", message: String(error?.message || error) });
  } finally {
    close();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`reference AG-UI endpoint on http://127.0.0.1:${PORT}/agui`);
  console.log(`  open the studio with: ?agui=http://127.0.0.1:${PORT}/agui`);
});
