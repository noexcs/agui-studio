/* ─────────────────────────────────────────────────────────────────────
   Wire-boundary validation (BACKLOG P1-6).

   Every BaseEvent that crosses the SSE transport boundary is checked against
   the official generated zod schemas from `@ag-ui/core/schemas` before the
   store reduces it. A recognized event type whose payload does not match the
   protocol schema is a protocol violation and surfaces as a RUN_ERROR instead
   of being half-applied (the previous behaviour silently reduced whatever
   fields happened to parse).

   Two deliberate relaxations of the generated schemas, both commented at the
   site where they are applied:

   1. threadId / runId stay optional on RUN_STARTED / RUN_FINISHED — the store
      resolves identity from its own session state when the wire omits them
      (store.ts dispatch), and that variance is real across AG-UI services.
      Payload fields stay strict: a missing messageId or delta is fatal.
   2. timestamp accepts a string in addition to the spec's integer — our
      BaseEvent type has always allowed ISO strings and the store parses both.

   Events with an unrecognized `type` string are tolerated (warn + keep) so a
   newer producer can extend the protocol without breaking older consumers —
   the same policy as the official enforcement stage, which drops them with a
   warning. Frames with no `type` at all are the keep-alive case and are
   ignored by the transport before validation runs.
   ───────────────────────────────────────────────────────────────────── */
import { EventType } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import { z } from "zod";
import type { BaseEvent } from "./events";

type WireCheck = { ok: true } | { ok: false; reason: string };

/* One generated schema per event type, with the documented relaxations. */
const EVENT_SCHEMA_BY_TYPE = new Map<string, z.ZodType>(
  EventSchema.options.map((option) => {
    const shape = (option as z.ZodObject<z.ZodRawShape>).shape;
    const type = String((shape.type as z.ZodLiteral<string>).value);
    const relaxed = (option as z.ZodObject<z.ZodRawShape>).extend({
      threadId: z.string().optional(),
      runId: z.string().optional(),
      timestamp: z.union([z.number(), z.string()]).optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    });
    return [type, relaxed];
  })
);

const KNOWN_EVENT_TYPES = new Set<string>(Object.values(EventType));

/**
 * Validate one event off the wire. Anything that reaches this function must
 * already be a non-null object; the transport checks that while framing.
 */
export function validateWireEvent(event: Record<string, unknown>): WireCheck {
  const type = event.type;
  // No type field: keep-alive or non-protocol envelope — not ours to judge here
  // (the transport ignores these before calling the schema layer).
  if (typeof type !== "string" || type.length === 0) {
    return { ok: false, reason: "event frame carries no event type" };
  }
  if (!KNOWN_EVENT_TYPES.has(type)) {
    // Extension event from a newer producer: tolerate and surface in the log,
    // like the official enforcement stage does.
    console.warn(`[agui] unrecognized event type '${type}' kept in the log`);
    return { ok: true };
  }
  const schema = EVENT_SCHEMA_BY_TYPE.get(type);
  if (!schema) return { ok: true }; // unreachable: map is built from EventType
  const parsed = schema.safeParse(event);
  if (parsed.success) return { ok: true };
  const issue = parsed.error.issues[0];
  const at = issue.path.length ? ` at '${issue.path.join(".")}'` : "";
  return {
    ok: false,
    reason: `${type} violates the AG-UI schema${at}: ${issue.message}`,
  };
}

/** The RUN_ERROR the boundary produces for a rejected event. */
export function runErrorEvent(reason: string): BaseEvent {
  return { type: EventType.RUN_ERROR, message: reason };
}

/* ── resume payload validation (store's former hand-written mini JSON-Schema) ── */

type ResponseSchema = {
  required?: string[];
  properties?: Record<string, { type?: string }>;
};

/**
 * Convert the interrupt's `responseSchema` (the JSON-Schema dialect AG-UI
 * interrupts carry) into an equivalent zod schema and validate the resume
 * payload against it. Same acceptance rules as the previous hand-written
 * validator: required keys must be present, declared property types must hold,
 * undeclared keys and undeclared types pass through.
 */
export function validateResumePayload(
  responseSchema: unknown,
  payload: Record<string, unknown>
): boolean {
  const schema = responseSchema as ResponseSchema | undefined;
  if (!schema) return true;
  const shape: Record<string, z.ZodType> = {};
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    let field: z.ZodType;
    switch (property?.type) {
      case "boolean":
        field = z.boolean();
        break;
      case "string":
        field = z.string();
        break;
      case "number":
        field = z.number();
        break;
      case "object":
        field = z.record(z.string(), z.any());
        break;
      default:
        field = z.any();
    }
    shape[key] = field.optional();
  }
  let validator = z.looseObject(shape);
  const required = schema.required ?? [];
  if (required.length) {
    // required keys must be present — checked by membership, like the
    // hand-written validator did (a key explicitly set to undefined is JSON-
    // impossible anyway, since JSON.stringify drops undefined values)
    validator = validator.superRefine((value, ctx) => {
      for (const key of required) {
        if (!(key in value)) {
          ctx.addIssue({ code: "custom", input: value, path: [key], message: `required key '${key}' is missing` });
        }
      }
    });
  }
  return validator.safeParse(payload).success;
}
