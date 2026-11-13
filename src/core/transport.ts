import type { BaseEvent } from "./events";

/**
 * POST a RunAgentInput and stream BaseEvents back over SSE.
 * This is the seam for a real agent: swap it in for the scripted demo and
 * every skin renders live data without changes.
 */
export class HttpAgentTransport {
  private url: string;
  private headers: Record<string, string>;

  constructor(options: { url: string; headers?: Record<string, string> }) {
    this.url = options.url;
    this.headers = options.headers ?? {};
  }

  async *run(input: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<BaseEvent> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.headers },
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok) throw new Error(`AG-UI transport error ${response.status}`);
    if (!response.body) throw new Error("AG-UI transport error: empty stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data) yield JSON.parse(data) as BaseEvent;
      }
    }
  }
}
