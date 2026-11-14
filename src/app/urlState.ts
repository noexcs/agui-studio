import { safeAccent } from "agui-skins";
import type { Lang, SkinDensity, SkinTextAnim, SkinTuning } from "agui-skins";

export type AppBackend = "mock" | "pi" | "fixture";

const TEXT_ANIMS: SkinTextAnim[] = ["none", "fade", "rise"];
const DENSITIES: SkinDensity[] = ["comfortable", "compact"];

/**
 * Normalize user-supplied tuning (URL params are untrusted): drop unparseable
 * colors and unknown enum values instead of letting them reach CSS.
 */
export function sanitizeTuning(input: {
  accent?: string | null;
  anim?: string | null;
  density?: string | null;
}): SkinTuning {
  const tuning: SkinTuning = {};
  const accent = input.accent ? safeAccent(input.accent) : null;
  if (accent) tuning.accent = accent;
  if (input.anim && (TEXT_ANIMS as string[]).includes(input.anim)) {
    tuning.textAnim = input.anim as SkinTextAnim;
  }
  if (input.density && (DENSITIES as string[]).includes(input.density)) {
    tuning.density = input.density as SkinDensity;
  }
  return tuning;
}

/**
 * The single place that turns app state into the shareable query string.
 * Tuning is part of the URL so the customize panel's "share this link" copy
 * is actually true.
 */
export function buildAppQuery(input: {
  skin: string;
  lang: Lang;
  backend: AppBackend;
  scene: string;
  full: boolean;
  tuning: SkinTuning;
}): string {
  const params = new URLSearchParams();
  params.set("skin", input.skin);
  params.set("lang", input.lang);
  if (input.backend !== "mock") params.set("backend", input.backend);
  if (input.scene !== "live") params.set("scene", input.scene);
  if (input.full) params.set("full", "1");

  const accent = input.tuning.accent ? safeAccent(input.tuning.accent) : null;
  if (accent) params.set("accent", accent);
  if (input.tuning.textAnim && input.tuning.textAnim !== "none") params.set("anim", input.tuning.textAnim);
  if (input.tuning.density && input.tuning.density !== "comfortable") params.set("density", input.tuning.density);
  return params.toString();
}
