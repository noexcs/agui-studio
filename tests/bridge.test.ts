import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";

/* Black-box integration test: the bridge runs as a real subprocess on a random
 * free port and is driven over real HTTP + SSE, exactly like the studio does.
 * Only backend:"fixture" is exercised so no live `pi` run is ever started. */

// Anchor on the vitest working directory (the repo root for `pnpm test`).
// import.meta.url is unusable here: under the jsdom environment vitest feeds
// `new URL(..., import.meta.url)` a root-less file:///tests/... base, which
// resolves sibling paths against "/".
const repoPath = (...segments: string[]): string => {
  const resolved = join(process.cwd(), ...segments);
  if (!existsSync(resolved)) {
    throw new Error(`cannot locate ${segments.join("/")} from cwd ${process.cwd()} — run vitest from the repo root`);
  }
  return resolved;
};

const BRIDGE_SCRIPT = repoPath("server", "bridge.mjs");
const PI_MAP_SCRIPT = repoPath("server", "pi-map.mjs");
const FIXTURE_PATH = repoPath("server", "fixtures", "pi-run.jsonl");

type Frame = { type: string; threadId: string; runId: string; timestamp: string } & Record<string, unknown>;

let child: ChildProcess | null = null;
let baseUrl = "";

/** Grab a free ephemeral port by binding to :0 and releasing it. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForBridge(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
      lastError = `health returned ${res.status}`;
    } catch (error) {
      lastError = String((error as Error)?.message ?? error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`bridge subprocess not ready within ${timeoutMs}ms (${lastError})`);
}

/** SIGTERM a bridge subprocess, escalating to SIGKILL, and wait for its exit. */
async function stopBridge(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const enforce = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 2000);
    proc.once("exit", () => {
      clearTimeout(enforce);
      resolve();
    });
  });
}

beforeAll(async () => {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [BRIDGE_SCRIPT], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-1000);
  });
  child.stdout?.resume();

  // fail fast (with stderr context) if the subprocess dies before serving
  const exited = new Promise<never>((_, reject) => {
    child!.once("exit", (code, signal) =>
      reject(
        new Error(
          `bridge subprocess exited before readiness (code=${code} signal=${signal})${stderrTail ? " · " + stderrTail.trim() : ""}`,
        ),
      ),
    );
  });

  try {
    // 25s headroom: the bridge synchronously probes `pi --version` (up to 15s) before listen
    await Promise.race([waitForBridge(baseUrl, 25000), exited]);
  } catch (error) {
    child.kill("SIGKILL");
    child = null;
    throw error;
  }
}, 30000);

afterAll(async () => {
  const proc = child;
  child = null;
  await stopBridge(proc);
});

/** Spawn a bridge from an arbitrary script directory (for doctored fixtures). */
async function startTempBridge(
  scriptDir: string,
): Promise<{ child: ChildProcess; baseUrl: string; close: () => Promise<void> }> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [join(scriptDir, "bridge.mjs")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrTail = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-1000);
  });
  proc.stdout?.resume();
  const exited = new Promise<never>((_, reject) => {
    proc.once("exit", (code, signal) =>
      reject(
        new Error(
          `bridge subprocess exited before readiness (code=${code} signal=${signal})${stderrTail ? " · " + stderrTail.trim() : ""}`,
        ),
      ),
    );
  });
  try {
    await Promise.race([waitForBridge(baseUrl, 25000), exited]);
  } catch (error) {
    proc.kill("SIGKILL");
    throw error;
  }
  return { child: proc, baseUrl, close: () => stopBridge(proc) };
}

function parseSse(raw: string): Frame[] {
  return raw
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter((payload) => payload.length > 0)
    .map((payload) => JSON.parse(payload) as Frame);
}

/** Hard deadline without AbortSignal: jsdom's AbortSignal instances are not
 *  webidl-branded for Node's (undici) fetch, which rejects them outright. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} not completed within ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function postRun(body: Record<string, unknown>, timeoutMs = 10000): Promise<Response> {
  return withTimeout(
    fetch(`${baseUrl}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    timeoutMs,
    `POST /api/run ${JSON.stringify(body)}`,
  );
}

/** POST /api/run and collect the full SSE stream as parsed JSON frames. */
async function runFixture(body: Record<string, unknown>): Promise<{ headers: Headers; frames: Frame[] }> {
  const res = await postRun({ prompt: "Review the skins", backend: "fixture", ...body });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const raw = await withTimeout(res.text(), 10000, "reading the SSE body");
  const frames = parseSse(raw);
  expect(frames.length).toBeGreaterThan(0);
  return { headers: res.headers, frames };
}

/* The recorded assistant reply, assembled from server/fixtures/pi-run.jsonl deltas. */
const EXPECTED_REPLY = [
  "Read all four skins. They share `ChatPage` and `useConversation()`, so the fixes stay inside one folder each.\n\n",
  "### One fix per skin\n\n- **Aurora** — the inspector event list is 9.5px mono. Raise it to 10.5px and drop `+3.85s` to one decimal; it is the densest text on screen.\n" +
    "- **Paper** — margin notes truncate mid-word at 220 chars. Clip on a sentence bound instead, or let the rail scroll without decoration.\n" +
    "- **Terminal** — good. Filter deltas from the trace by default so `TOOL_CALL_*` and `STATE_*` stay legible.\n" +
    "- **Brutalist** — the hard shadow sits on every card; remove it from tool cards so approval keeps the loudest edge.\n",
  "Want me to apply the Aurora and Brutalist changes now? Both are two-line CSS edits and do not touch the shared contract.",
].join("");

describe("bridge subprocess (fixture backend)", () => {
  it("answers GET /api/health with ok:true", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, fixture: true });
  });

  it("streams the recorded fixture run as data:-framed JSON events from STATE_SNAPSHOT to RUN_FINISHED", async () => {
    const { headers, frames } = await runFixture({ instant: true, threadId: "bridge_test_thread" });

    expect(headers.get("cache-control")).toContain("no-cache");

    // every frame is a typed AG-UI event carrying the run metadata
    for (const frame of frames) {
      expect(typeof frame.type).toBe("string");
      expect(frame.type.length).toBeGreaterThan(0);
      expect(frame.threadId).toBe("bridge_test_thread");
      expect(frame.runId).toMatch(/^run_/);
      expect(frame.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }

    // opening frames: the fixture backend announces state first, then the run starts
    expect(frames[0].type).toBe("STATE_SNAPSHOT");
    expect(frames[0].snapshot).toMatchObject({ agent: { name: "pi (fixture)" }, tools: ["bash", "read"] });
    expect(frames[1].type).toBe("RUN_STARTED");

    // closing frame: clean success, no errors anywhere in the stream
    expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    expect(frames[frames.length - 1].outcome).toEqual({ type: "success" });
    expect(frames.filter((frame) => frame.type === "RUN_ERROR")).toHaveLength(0);

    // the tool call lifecycle arrives exactly once, fully paired
    const toolCallIds = (type: string) =>
      new Set(frames.filter((frame) => frame.type === type).map((frame) => frame.toolCallId));
    expect(frames.filter((frame) => frame.type === "TOOL_CALL_START")).toHaveLength(1);
    expect(toolCallIds("TOOL_CALL_START")).toEqual(new Set(["call_read_1"]));
    // pi's id-less toolcall_delta records must still land on the right call (fix round 1)
    expect(toolCallIds("TOOL_CALL_ARGS")).toEqual(new Set(["call_read_1"]));
    expect(toolCallIds("TOOL_CALL_END")).toEqual(new Set(["call_read_1"]));
    expect(toolCallIds("TOOL_CALL_RESULT")).toEqual(new Set(["call_read_1"]));
    expect(frames.filter((frame) => frame.type === "STEP_STARTED").map((frame) => frame.stepName)).toEqual([
      "turn 1",
      "read",
      "turn 2",
    ]);
  });

  it("concatenates TEXT_MESSAGE_CONTENT deltas into the assistant's full recorded reply", async () => {
    const { frames } = await runFixture({ instant: true, threadId: "t_deltas" });

    const content = frames
      .filter((frame) => frame.type === "TEXT_MESSAGE_CONTENT")
      .map((frame) => frame.delta as string)
      .join("");
    expect(content).toBe(EXPECTED_REPLY);

    // lifecycle pairing: every STARTed message is ENDed with the same id
    const messageIds = (type: string) =>
      frames.filter((frame) => frame.type === type).map((frame) => frame.messageId as string).sort();
    expect(messageIds("TEXT_MESSAGE_START")).toEqual([
      "pi_msg_1_text_1",
      "pi_msg_1_text_3",
      "pi_msg_2_text_0",
    ]);
    expect(messageIds("TEXT_MESSAGE_END")).toEqual([
      "pi_msg_1_text_1",
      "pi_msg_1_text_3",
      "pi_msg_2_text_0",
    ]);
  });

  it("replays the identical event sequence in timed (non-instant) mode", async () => {
    const instant = await runFixture({ instant: true, threadId: "t_same" });
    const timed = await runFixture({ speed: 8, threadId: "t_same" });

    expect(timed.frames.map((frame) => frame.type)).toEqual(instant.frames.map((frame) => frame.type));
    expect(timed.frames.filter((frame) => frame.type === "TEXT_MESSAGE_CONTENT").map((f) => f.delta).join("")).toBe(
      EXPECTED_REPLY,
    );
  }, 15000);

  it("delivers the first frame while the replay is still streaming and survives a mid-stream disconnect", async () => {
    // default speed spaces 48 records ~26ms apart; the first frame is written immediately
    const res = await postRun({ prompt: "stream check", backend: "fixture" });
    expect(res.status).toBe(200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let giveUp: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        (async () => {
          while (!raw.includes("\n\n")) {
            const { value, done } = await reader.read();
            if (done) throw new Error("SSE stream ended before delivering a complete frame");
            raw += decoder.decode(value, { stream: true });
          }
        })(),
        new Promise((_, reject) => {
          giveUp = setTimeout(() => reject(new Error("no SSE frame received within 3s")), 3000);
        }),
      ]);

      const firstFrame = JSON.parse(raw.split("\n\n")[0].slice(5).trimStart()) as Frame;
      expect(firstFrame.type).toBe("STATE_SNAPSHOT");
    } finally {
      if (giveUp) clearTimeout(giveUp);
      await reader.cancel().catch(() => {});
    }

    // the bridge must keep serving other clients after the client vanished mid-stream
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as Record<string, unknown>).ok).toBe(true);
  }, 15000);

  it("acknowledges POST /api/stop", async () => {
    const res = await fetch(`${baseUrl}/api/stop`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("rejects invalid JSON bodies with 400", async () => {
    const res = await fetch(`${baseUrl}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid JSON body" });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not found" });
  });
});

/* ── bad-line robustness: the bridge against a doctored fixture copy ──
 * The recorded fixture must stay untouched, so these tests copy the real
 * bridge + mapper byte-for-byte into a temp dir and serve doctored fixtures. */

describe("bridge subprocess (bad fixture lines)", () => {
  let serverDir: string;
  const repoLines = readFileSync(FIXTURE_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim());

  beforeAll(() => {
    serverDir = mkdtempSync(join(tmpdir(), "agui-bridge-badline-"));
    writeFileSync(join(serverDir, "bridge.mjs"), readFileSync(BRIDGE_SCRIPT));
    writeFileSync(join(serverDir, "pi-map.mjs"), readFileSync(PI_MAP_SCRIPT));
    mkdirSync(join(serverDir, "fixtures"), { recursive: true });
  });

  afterAll(() => {
    rmSync(serverDir, { recursive: true, force: true });
  });

  const runInstant = async (url: string) => {
    const res = await fetch(`${url}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "bad lines", backend: "fixture", instant: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    return parseSse(await res.text());
  };

  it("skips non-object fixture lines and still completes the recorded run", async () => {
    // bad lines that parse fine but are not pi records (the crash case pre-fix)
    const mixedFixture = [
      "null",
      repoLines[0],
      "42",
      repoLines[1],
      "true",
      ...repoLines.slice(2),
      "[1,2]",
      '"not a pi record"',
    ].join("\n");
    writeFileSync(join(serverDir, "fixtures", "pi-run.jsonl"), mixedFixture);

    const { baseUrl, close } = await startTempBridge(serverDir);
    try {
      const frames = await runInstant(baseUrl);

      expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
      expect(frames[frames.length - 1].outcome).toEqual({ type: "success" });
      expect(frames.filter((frame) => frame.type === "RUN_ERROR")).toHaveLength(0);
      expect(frames.filter((frame) => frame.type === "TEXT_MESSAGE_CONTENT").map((frame) => frame.delta as string).join("")).toBe(
        EXPECTED_REPLY,
      );
      expect(new Set(frames.filter((frame) => frame.type === "TOOL_CALL_ARGS").map((frame) => frame.toolCallId))).toEqual(
        new Set(["call_read_1"]),
      );

      // the bridge process must have survived the run
      const health = await fetch(`${baseUrl}/api/health`);
      expect(((await health.json()) as Record<string, unknown>).ok).toBe(true);
    } finally {
      await close();
    }
  }, 15000);

  it("answers RUN_ERROR when no fixture line maps to a pi record", async () => {
    writeFileSync(join(serverDir, "fixtures", "pi-run.jsonl"), ["null", "42", "[1,2]", '"nope"'].join("\n"));

    const { baseUrl, close } = await startTempBridge(serverDir);
    try {
      const frames = await runInstant(baseUrl);
      // existing RUN_ERROR semantics: error frame, stream closed, no STATE_SNAPSHOT
      expect(frames.map((frame) => frame.type)).toEqual(["RUN_ERROR"]);
    } finally {
      await close();
    }
  }, 15000);
});
