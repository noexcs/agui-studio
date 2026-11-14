/**
 * Deep agent (LangGraph Agent Server) → AG-UI SSE.
 *
 * The agent itself is a real `create_deep_agent` graph served by
 * `langgraph dev` (server/deepagent/agent.py). @ag-ui/langgraph is the official
 * adapter: it runs the graph and emits AG-UI events natively, so this module
 * only forwards those events to the browser SSE stream — no event synthesis.
 *
 * Requires the Agent Server on LANGGRAPH_URL (default http://127.0.0.1:2024).
 */
import { LangGraphAgent } from "@ag-ui/langgraph";

const GRAPH_ID = process.env.LANGGRAPH_GRAPH_ID || "deep_agent";
const DEPLOYMENT_URL = process.env.LANGGRAPH_URL || "http://127.0.0.1:2024";

let activeAgent = null;

export async function deepagentHealth() {
  try {
    const res = await fetch(`${DEPLOYMENT_URL}/ok`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { reachable: false, graphId: GRAPH_ID, deploymentUrl: DEPLOYMENT_URL };
    return { reachable: true, graphId: GRAPH_ID, deploymentUrl: DEPLOYMENT_URL };
  } catch {
    return { reachable: false, graphId: GRAPH_ID, deploymentUrl: DEPLOYMENT_URL };
  }
}

export function stopDeepagent() {
  try {
    activeAgent?.abortRun?.();
  } catch {
    /* ignore */
  }
  activeAgent = null;
}

export async function runDeepagent(res, body, runId, { openStream }) {
  const threadId = body.threadId || `da_${Date.now().toString(36)}`;
  const meta = { threadId, runId };
  const stream = openStream(res, meta);
  const prompt = String(body.prompt || "").trim() || "Introduce what you can do.";

  const agent = new LangGraphAgent({
    graphId: GRAPH_ID,
    deploymentUrl: DEPLOYMENT_URL,
    emitInterruptOutcome: true,
    initialMessages: [{ id: `msg_${runId}`, role: "user", content: prompt }],
  });
  activeAgent = agent;

  // The adapter calls one `on…Event` callback per AG-UI event. A proxy keeps
  // this future-proof: new event types are forwarded without a code change.
  const subscriber = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string" || !/^on[A-Z].*Event$/.test(prop)) return undefined;
        return (arg) => {
          const event = arg?.event ?? arg;
          if (event && typeof event.type === "string") stream.send(event);
        };
      },
    }
  );

  try {
    await agent.runAgent({}, subscriber);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/abort/i.test(message)) stream.send({ type: "RUN_ERROR", message });
  } finally {
    activeAgent = null;
    stream.close();
  }
}
