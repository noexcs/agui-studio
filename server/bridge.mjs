#!/usr/bin/env node
/**
 * pi → AG-UI bridge.
 *
 *   node server/bridge.mjs            # http://127.0.0.1:5179
 *   PI_CLI=/abs/path/to/cli.js node server/bridge.mjs
 *   PI_CWD=/some/workspace node server/bridge.mjs
 *
 * Live mode runs `pi --mode json --no-session "<prompt>"` as a child process and
 * translates pi's JSONL session events into an AG-UI SSE stream. JSON mode is a
 * one-shot run, which matches the request/response shape of the studio.
 *
 * POST /api/run   {prompt, backend?: "pi" | "fixture", instant?}  -> text/event-stream
 * POST /api/stop                                                  -> kills the child run
 * GET  /api/health                                                -> { ok, pi, version }
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPiMapper, stateSnapshotFromPi } from "./pi-map.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5179);
const PI_CWD = process.env.PI_CWD || join(__dirname, "..");
const FIXTURE = join(__dirname, "fixtures", "pi-run.jsonl");
const IS_WIN = process.platform === "win32";

let activeChild = null;
let piProbe = { ok: false, error: "probing pi…" };

/** Resolve the cli.js + node.exe behind the `pi` shim, so we can spawn node
 *  directly: no shell, safe argv quoting, and pi's own node version. */
function resolvePiCli() {
  if (process.env.PI_CLI && existsSync(process.env.PI_CLI)) {
    return { cli: process.env.PI_CLI, node: process.env.PI_NODE || process.execPath };
  }
  try {
    const where = spawnSync(IS_WIN ? "where" : "which", ["pi"], { encoding: "utf8" });
    const paths = (where.stdout || "").split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
    for (const shim of paths) {
      if (!/\.(cmd|ps1|sh)$/i.test(shim)) continue;
      const dir = dirname(shim);
      const text = readFileSync(shim, "utf8");
      const match = text.match(/([^"'\r\n]*?dist[\\/]cli\.js)/);
      if (!match) continue;
      const candidate = match[1].replace(/%~?dp0%?/gi, dir + "\\");
      if (!existsSync(candidate)) continue;
      const localNode = join(dir, "node.exe");
      return { cli: candidate, node: existsSync(localNode) ? localNode : process.execPath };
    }
  } catch {
    /* fall through */
  }
  return null;
}

const PI = resolvePiCli();
const PI_CLI = PI?.cli ?? null;

function probePi() {
  try {
    const result = spawnSync(IS_WIN ? "pi.cmd" : "pi", ["--version"], {
      encoding: "utf8",
      timeout: 15000,
      shell: IS_WIN,
    });
    if (result.status === 0) {
      return { ok: true, version: (result.stdout || "").trim().split("\n")[0], cli: PI_CLI };
    }
    return { ok: false, error: (result.stderr || result.error?.message || "pi --version failed").trim().slice(0, 300) };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 300) };
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

function openStream(res, meta) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...cors,
  });
  let closed = false;
  const send = (event) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify({ ...meta, timestamp: new Date().toISOString(), ...event })}\n\n`);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      res.end();
    } catch {
      /* already gone */
    }
  };
  const heartbeat = setInterval(() => !closed && res.write(": ping\n\n"), 15000);
  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });
  return { send, close };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/* ── live pi (JSON mode) ───────────────────────────────────────────── */
function runPi(req, res, body, runId) {
  const meta = { threadId: body.threadId || `pi_${Date.now().toString(36)}`, runId };
  const stream = openStream(res, meta);
  const mapper = createPiMapper(meta);
  const prompt = String(body.prompt || "");
  let settled = false;
  let stderr = "";

  const cliArgs = ["--mode", "json", "--no-session"];
  if (body.model) cliArgs.push("--model", String(body.model));
  cliArgs.push(prompt);

  const child = PI
    ? spawn(PI.node, [PI.cli, ...cliArgs], { cwd: body.cwd || PI_CWD, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(IS_WIN ? "pi.cmd" : "pi", cliArgs, { cwd: body.cwd || PI_CWD, stdio: ["ignore", "pipe", "pipe"], shell: IS_WIN });

  activeChild = child;

  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!record || typeof record !== "object") continue; // junk line: skip, never crash the run
      if (record.type === "session") {
        stream.send(
          stateSnapshotFromPi(
            { name: "pi", sessionId: record.id, cwd: record.cwd },
            meta
          )
        );
        continue;
      }
      for (const event of mapper.map(record)) {
        if (event.type === "RUN_FINISHED") settled = true;
        stream.send(event);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-3000);
  });

  child.on("error", (error) => {
    stream.send({ type: "RUN_ERROR", message: `cannot start pi: ${error.message}` });
    stream.close();
  });

  child.on("close", (code) => {
    activeChild = null;
    if (!settled && code === 0) {
      // JSON mode exits after the run; pi does not always emit agent_settled
      stream.send({ type: "RUN_FINISHED", outcome: { type: "success" } });
    } else if (!settled) {
      const detail = stderr.trim().split("\n").slice(-3).join(" ");
      stream.send({ type: "RUN_ERROR", message: `pi exited with code ${code}${detail ? " · " + detail : ""}` });
    }
    stream.close();
  });

  req.on("close", () => {
    if (activeChild === child && !settled) {
      try {
        child.kill();
      } catch {
        /* already dead */
      }
    }
  });
}

/* ── fixture replay (no pi / no credentials) ───────────────────────── */
function runFixture(res, body, runId) {
  const meta = { threadId: body.threadId || "pi_fixture", runId };
  const stream = openStream(res, meta);
  const mapper = createPiMapper(meta);

  let records = [];
  try {
    records = readFileSync(FIXTURE, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .reduce((acc, line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) acc.push(parsed);
        } catch {
          /* bad line: skip it instead of failing the whole run */
        }
        return acc;
      }, []);
  } catch (error) {
    stream.send({ type: "RUN_ERROR", message: `fixture missing: ${error.message}` });
    stream.close();
    return;
  }
  if (records.length === 0) {
    // nothing in the fixture maps to a pi record → same RUN_ERROR semantics as a missing file
    stream.send({ type: "RUN_ERROR", message: `fixture missing: no parsable pi records in ${FIXTURE}` });
    stream.close();
    return;
  }

  stream.send(
    stateSnapshotFromPi(
      { name: "pi (fixture)", model: "pi agent · recorded session", tools: ["bash", "read"], thinkingLevel: "medium", cwd: "/work/agui-studio" },
      meta
    )
  );

  if (body.instant) {
    for (const record of records) for (const event of mapper.map(record)) stream.send(event);
    stream.close();
    return;
  }

  const speed = Number(body.speed || 1);
  let index = 0;
  const timer = setInterval(() => {
    if (index >= records.length) {
      clearInterval(timer);
      stream.close();
      return;
    }
    const record = records[index++];
    for (const event of mapper.map(record)) stream.send(event);
  }, Math.max(12, 26 / speed));
  res.on("close", () => clearInterval(timer));
}

/* ── server ────────────────────────────────────────────────────────── */
const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/api/health") {
    json(res, 200, { ok: true, pi: piProbe.ok, version: piProbe.version, piError: piProbe.error, fixture: true });
    return;
  }

  if (url.pathname === "/api/stop" && req.method === "POST") {
    if (activeChild) {
      try {
        activeChild.kill();
      } catch {
        /* ignore */
      }
      activeChild = null;
    }
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/run" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: "invalid JSON body" });
      return;
    }
    const runId = `run_${Date.now().toString(36)}`;
    if (body.backend === "fixture") runFixture(res, body, runId);
    else runPi(req, res, body, runId);
    return;
  }

  json(res, 404, { error: "not found", routes: ["/api/health", "/api/run", "/api/stop"] });
});

piProbe = probePi();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`pi → AG-UI bridge on http://127.0.0.1:${PORT}`);
  console.log(piProbe.ok ? `  pi: ${piProbe.version}${PI_CLI ? " · cli " + PI_CLI : ""}` : `  pi not found (${piProbe.error}) — fixture mode still works`);
  console.log(`  POST /api/run { "prompt": "…", "backend": "pi" | "fixture" }`);
});
