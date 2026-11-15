import { type BaseEvent } from "./events";
import { runErrorEvent, validateWireEvent } from "./validate";
import { AGUIError, parseSSEStream, runHttpRequest, verifyEvents } from "@ag-ui/client";
import { EventType as OfficialEventType } from "@ag-ui/core";
import { catchError, EMPTY, map, mergeMap, of, takeWhile, throwError } from "rxjs";
import type { Observable, ObservableInput } from "rxjs";

/**
 * POST a RunAgentInput and stream BaseEvents back over SSE.
 *
 * The streaming internals are the official `@ag-ui/client` pipeline:
 * runHttpRequest (HTTP + reader teardown) → CRLF normalization (see below) →
 * parseSSEStream (frame framing) → schema validation (P1-6) → verifyEvents
 * (protocol state machine) → an Observable→AsyncGenerator adapter, so the
 * class shape the skins and the store consume is unchanged.
 *
 * Behaviour decisions where our semantics intentionally differ from the
 * official client, all commented at the site:
 *  - CRLF delimiters are normalized to LF before official framing (the
 *    official parser only splits on `\n\n`; Task 1 delivered CRLF tolerance).
 *  - type-less frames (keep-alives) are ignored; the official
 *    transformHttpEventStream fails the stream on them.
 *  - verify/schema violations surface as a RUN_ERROR event (strict ruling),
 *    while the official client would error the stream with an AGUIError.
 *  - user aborts rethrow AbortError instead of emitting a RUN_ERROR event,
 *    because the store maps AbortError to a "stopped" run.
 */
export class HttpAgentTransport {
  private url: string;
  private headers: Record<string, string>;

  constructor(options: { url: string; headers?: Record<string, string> }) {
    this.url = options.url;
    this.headers = options.headers ?? {};
  }

  async *run(input: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<BaseEvent> {
    const fetchResponse = async (): Promise<Response> => {
      const init: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.headers },
        body: JSON.stringify(input),
        signal,
      };
      try {
        return await fetch(this.url, init);
      } catch (error) {
        // jsdom's AbortSignal className does not satisfy Node fetch's realm check;
        // retry without cancellation so the SSE path can be tested.
        if (signal && /AbortSignal/i.test(String((error as Error)?.message))) {
          return fetch(this.url, { ...init, signal: undefined });
        }
        throw error;
      }
    };

    /* Official HTTP layer: streams the body as HttpEvents, reads small error
       bodies into the error message, and cancels the reader on teardown. */
    const http$ = runHttpRequest(fetchResponse);

    /* Task 1 compatibility: the official parser splits frames on `\n\n` only,
       so CRLF-only servers would glue frames together. Normalize `\r\n` byte
       pairs to `\n` before parsing (a `\r` split across chunk boundaries is
       carried over), preserving the CRLF semantics the transport shipped with. */
    const carry = { cr: false };
    const normalized$ = http$.pipe(
      map((event) => {
        if (event.type !== "data" || !event.data) return event;
        const { data, cr } = crlfToLf(event.data, carry.cr);
        carry.cr = cr;
        return { ...event, data };
      })
    );

    /* Official SSE framing, then the strict wire boundary. The pipeline is
       typed in official BaseEvents; our BaseEvent is a structural twin whose
       `type` is a string-literal union instead of the official TS enum, so the
       bridge is two casts (here and at the adapter below) rather than a
       rewrite of events.ts. */
    type OfficialEvent = import("@ag-ui/core").BaseEvent;
    const events$ = parseSSEStream(normalized$).pipe(
      mergeMap((json: unknown): ObservableInput<OfficialEvent> => {
        if (typeof json !== "object" || json === null || Array.isArray(json)) {
          throw new Error("Invalid event: the frame is not a JSON object.");
        }
        // keep-alives and other type-less envelopes are ignorable, not errors
        if (!("type" in json)) return EMPTY;
        const check = validateWireEvent(json as Record<string, unknown>);
        if (!check.ok) return of(runErrorEvent(check.reason) as unknown as OfficialEvent);
        return of(json as unknown as OfficialEvent);
      }),
      verifyEvents(),
      // Strict ruling: a stream the verifier rejects surfaces as a RUN_ERROR
      // event (the store renders it) rather than a thrown AGUIError. Transport
      // failures (HTTP, framing, JSON syntax) and user aborts keep propagating.
      catchError((error: unknown): ObservableInput<OfficialEvent> => {
        if (error instanceof AGUIError) {
          return of(runErrorEvent(error.message) as unknown as OfficialEvent);
        }
        return throwError(() => error);
      }),
      // A RUN_ERROR is terminal: the verifier rejects anything after it, so the
      // generator stops reading once one is delivered.
      takeWhile((event: OfficialEvent) => event.type !== OfficialEventType.RUN_ERROR, true)
    );

    yield* observableToAsyncIterator(events$ as unknown as Observable<BaseEvent>);
  }
}

/* ── Observable → AsyncGenerator adapter ──────────────────────────────
   Pull-based queue: the store's `for await` loop drives consumption, and
   the rxjs subscription is torn down whenever the generator exits (return,
   throw or consumer break). ~30 lines of glue; everything above is official. */
function observableToAsyncIterator<T>(source$: Observable<T>): AsyncGenerator<T> {
  const queue: T[] = [];
  let failure: { error: unknown } | undefined;
  let done = false;
  let wake: (() => void) | undefined;

  const subscription = source$.subscribe({
    next: (value) => {
      queue.push(value);
      wake?.();
      wake = undefined;
    },
    error: (error) => {
      failure = { error };
      wake?.();
      wake = undefined;
    },
    complete: () => {
      done = true;
      wake?.();
      wake = undefined;
    },
  });

  const settled = () => queue.length > 0 || done || failure !== undefined;
  const waitForNext = () => new Promise<void>((resolve) => (wake = resolve));

  async function* iterate(): AsyncGenerator<T> {
    try {
      while (true) {
        if (queue.length) {
          yield queue.shift() as T;
          continue;
        }
        if (failure) throw failure.error;
        if (done) return;
        await waitForNext();
        if (!settled()) return; // subscription torn down without a terminal event
      }
    } finally {
      subscription.unsubscribe();
    }
  }

  return iterate();
}

/* ── CRLF normalization (byte level, chunk-boundary safe) ───────────── */
export function crlfToLf(
  input: Uint8Array,
  carriedCR: boolean
): { data: Uint8Array; cr: boolean } {
  const out = new Uint8Array(input.length + 1);
  let write = 0;
  let read = 0;
  if (carriedCR) {
    // The previous chunk ended with a lone `\r`: a leading `\n` here closes a
    // `\r\n` pair (emit a single `\n`); anything else leaves the `\r` intact.
    if (read < input.length && input[read] === 10) read += 1;
    out[write++] = read === 1 ? 10 : 13;
  }
  while (read < input.length) {
    const byte = input[read];
    if (byte === 13) {
      if (read + 1 >= input.length) {
        return { data: out.subarray(0, write), cr: true };
      }
      if (input[read + 1] === 10) {
        read += 2;
        out[write++] = 10;
        continue;
      }
    }
    out[write++] = byte;
    read += 1;
  }
  return { data: out.subarray(0, write), cr: false };
}
