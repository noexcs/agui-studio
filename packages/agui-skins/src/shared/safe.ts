/* Defensive value helpers shared by the skins.
 *
 * Third-party AG-UI streams are not written by our demo fixtures: a result can
 * be a string, an array, `null`, or an object with a different shape; a plan can
 * arrive with `description`/`status` instead of `label`/`state`; shared state
 * can be a scalar or an array even though our demo uses an object. Every helper
 * here is total: no throw, no `.map` on an unknown, no `Object.keys` on a
 * primitive. The skins use these instead of trusting the demo contract at the
 * rendering boundary (the contract itself stays unchanged for hosts).
 */

/** Non-null, non-array object. Arrays are values of their own. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Safe `Object.entries`: objects and arrays (index keys) only, [] for scalars. */
export function entriesOf(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  if (isRecord(value)) return Object.entries(value);
  return [];
}

/**
 * True only for `null`/`undefined` and empty objects/arrays. A scalar (0,
 * false, "") is real state and must be rendered, not replaced by "no snapshot".
 */
export function isEmptyState(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

/** Read one field from an unknown object without throwing on scalars/null. */
export function fieldOf(root: unknown, key: string): unknown {
  const record = asRecord(root);
  return record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/**
 * Human-readable text for a single unknown value. Strings are returned whole;
 * objects/arrays become compact JSON so third-party values are never hidden.
 */
export function displayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  return safeJson(value, 0);
}

/** JSON.stringify that cannot throw on circular values / BigInt / functions. */
export function safeJson(value: unknown, space = 2): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === "bigint") return item.toString();
        if (typeof item === "function" || typeof item === "symbol") return String(item);
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      },
      space
    );
    return typeof json === "string" ? json : String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/** Only link protocols that are safe to place in an href. */
export function safeHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const href = value.trim();
  if (!href) return undefined;
  try {
    const url = new URL(href, "https://agui.invalid");
    return url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:" ||
      url.protocol === "tel:"
      ? href
      : undefined;
  } catch {
    return undefined;
  }
}
