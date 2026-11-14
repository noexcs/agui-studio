/* Accent contrast guard (Fix E).
   All WCAG math is delegated to color2k (getContrast / mix) — nothing is
   hand-rolled here. The guard answers one question per custom accent:

     "given the user-picked accent, which foregrounds stay readable?"

   Three tiers come out of it:
     - light-fg  → white text may sit on the accent (buttons, logo mark)
     - dark-fg   → the accent is too light; use the dark ink instead
     - inkOnLight → the accent is too light to be TEXT on light surfaces
                    (links, em, meta) — use this darkened variant instead

   The host injects the derived values as CSS custom properties
   (--sk-accent-fg / --sk-accent-ink, see host.tsx + tuning.css); skins stay
   pure CSS and simply consume the variables with legacy fallbacks. */

import { getContrast, mix, toHex } from "color2k";

/** WCAG AA for normal-size text (classic links/buttons are 10–13.5px). */
export const AA_NORMAL_TEXT = 4.5;

/** WCAG floor for large text / UI components. Dark skins use the accent as
    highlight & icon color (aurora --violet, terminal --green), so the
    too-dark *hint* fires below this floor, not below 4.5 — otherwise half
    the shipped palette would warn. */
export const AA_LARGE_TEXT = 3;

/** Reference surface for light skins: classic puts accent text on white cards. */
export const LIGHT_SURFACE_REF = "#ffffff";

/** Reference surface for dark skins: aurora --panel-solid, the lightest dark
    panel accent-colored meta text sits on (worst case for dark accents). */
export const DARK_SURFACE_REF = "#0c0e14";

/** Dark foreground candidate = classic --text (gray-900). Used instead of pure
    black so guarded buttons keep the skin's ink tone. */
export const DARK_INK = "#111827";

export type AccentFgTier = "light-fg" | "dark-fg";

export interface AccentGuard {
  /** normalized input color */
  accent: string;
  /** which foreground tier applies to text placed ON the accent */
  tier: AccentFgTier;
  /** concrete foreground for accent backgrounds (white or DARK_INK) */
  onAccentFg: string;
  /** WCAG ratio of onAccentFg against the accent */
  onAccentRatio: number;
  /** WCAG ratio of the accent as text on the light surface (links, em) */
  asTextRatio: number;
  /** WCAG ratio of the accent as text on the dark-surface reference */
  onDarkRatio: number;
  /** accent darkened until it clears AA as text on the light surface;
      null when the accent already passes and should be used as-is */
  inkOnLight: string | null;
  /** ratio of inkOnLight against the light surface (null when inkOnLight is null) */
  inkOnLightRatio: number | null;
  /** accent lightened until it clears AA as text on dark surfaces */
  brightOnDark: string | null;
  brightOnDarkRatio: number | null;
  /** panel hint: accent fails AA as text on light surfaces */
  tooLight: boolean;
  /** panel hint: accent falls below the 3:1 component floor on the dark-surface reference */
  tooDark: boolean;
}

const ratio = (a: string, b: string) => Number(getContrast(a, b).toFixed(2));

/** Normalize any CSS color to #rrggbb; null when unparseable (bad URL param).
    color2k v2 `toHex` parses the color itself and throws on garbage. */
export function safeAccent(accent: string): string | null {
  try {
    return toHex(accent);
  } catch {
    return null;
  }
}

/** Walk the accent toward white in 4% steps until it clears AA on dark. */
function brightenUntilAA(accent: string): { ink: string; ratio: number } | null {
  if (getContrast(accent, DARK_SURFACE_REF) >= AA_NORMAL_TEXT) return null;
  for (let step = 0.04; step <= 0.96; step += 0.04) {
    const candidate = toHex(mix(accent, "#ffffff", step));
    const candidateRatio = ratio(candidate, DARK_SURFACE_REF);
    if (candidateRatio >= AA_NORMAL_TEXT) return { ink: candidate, ratio: candidateRatio };
  }
  return { ink: "#ffffff", ratio: ratio("#ffffff", DARK_SURFACE_REF) };
}

/** Walk the accent toward black in 4% steps until it clears AA on white. */
function darkenUntilAA(accent: string): { ink: string; ratio: number } | null {
  if (getContrast(accent, LIGHT_SURFACE_REF) >= AA_NORMAL_TEXT) return null;
  for (let step = 0.04; step <= 0.96; step += 0.04) {
    const candidate = toHex(mix(accent, "#000000", step));
    const candidateRatio = ratio(candidate, LIGHT_SURFACE_REF);
    if (candidateRatio >= AA_NORMAL_TEXT) return { ink: candidate, ratio: candidateRatio };
  }
  return { ink: "#000000", ratio: ratio("#000000", LIGHT_SURFACE_REF) };
}

/** Judge a user-picked accent: foreground tiers + text-safe ink + hint flags. */
export function accentGuard(accent: string): AccentGuard {
  const normalized = safeAccent(accent) ?? DARK_INK;
  const onWhite = ratio("#ffffff", normalized);
  const onInk = ratio(DARK_INK, normalized);
  const useInk = onInk > onWhite;
  const asText = ratio(normalized, LIGHT_SURFACE_REF);
  const onDark = ratio(normalized, DARK_SURFACE_REF);
  const darkened = darkenUntilAA(normalized);
  const brightened = brightenUntilAA(normalized);
  return {
    accent: normalized,
    tier: useInk ? "dark-fg" : "light-fg",
    onAccentFg: useInk ? DARK_INK : "#ffffff",
    onAccentRatio: useInk ? onInk : onWhite,
    asTextRatio: asText,
    onDarkRatio: onDark,
    inkOnLight: darkened?.ink ?? null,
    inkOnLightRatio: darkened?.ratio ?? null,
    brightOnDark: brightened?.ink ?? null,
    brightOnDarkRatio: brightened?.ratio ?? null,
    tooLight: asText < AA_NORMAL_TEXT,
    tooDark: onDark < AA_LARGE_TEXT,
  };
}
