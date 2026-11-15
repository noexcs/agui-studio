import type { BaseEvent } from "./events";
import { runErrorEvent, validateWireEvent } from "./validate";

/**
 * POST a RunAgentInput and stream BaseEvents back over SSE.
 * This is the seam for a real agent: swap it in for the scripted demo and
 * every skin renders live data without changes.
 *
 * Frames are validated against the official AG-UI schemas (BACKLOG P1-6): a
 * recognized event type that violates the protocol schema surfaces as a
 * RUN_ERROR event instead of being reduced half-applied. Type-less frames
 * (keep-alives) are ignored, unrecognized event types are kept.
 */
export class HttpAgentTransport {
  private url: string;
  private headers: Record<string, string>;

  constructor(options: { url: string; headers?: Record<string, string> }) {
    this.url = options.url;
    this.headers = options.headers ?? {};
  }

  async *run(input: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<BaseEvent> {
    const request = () =>
      fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.headers },
        body: JSON.stringify(input),
        signal,
      });
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      // jsdom's AbortSignal className does not satisfy Node fetch's realm check;
      // retry without cancellation so the SSE path can be tested.
      if (signal && /AbortSignal/i.test(String((error as Error)?.message))) {
        response = await fetch(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.headers },
          body: JSON.stringify(input),
        });
      } else {
        throw error;
      }
    }
    if (!response.ok) throw new Error(`AG-UI transport error ${response.status}`);
    if (!response.body) throw new Error("AG-UI transport error: empty stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("AG-UI transport error: SSE frame is not a JSON object");
        }
        // keep-alives and other type-less envelopes are ignorable, not errors
        if (!("type" in parsed)) continue;
        const check = validateWireEvent(parsed as Record<string, unknown>);
        if (!check.ok) {
          // Strict boundary (P1-6): surface the violation as RUN_ERROR and stop
          // reading, instead of handing a half-valid event to the store.
          yield runErrorEvent(check.reason);
          return;
        }
        yield parsed as BaseEvent;
      }
    }
  }
}
