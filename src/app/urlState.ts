import { safeAccent } from "agui-skins";
import { DEFAULT_SCENARIO, type DemoScenario } from "../core/demo-scenarios";
import type { Lang, SkinDensity, SkinMotion, SkinRadius, SkinTextAnim, SkinTextScale, SkinTuning } from "agui-skins";

export type AppBackend = "mock" | "pi" | "fixture";

const TEXT_ANIMS: SkinTextAnim[] = ["none", "fade", "rise"];
const DENSITIES: SkinDensity[] = ["comfortable", "compact"];
const MOTIONS: SkinMotion[] = ["slow", "normal", "fast"];
const RADII: SkinRadius[] = ["sharp", "soft", "round"];
const TEXT_SCALES: SkinTextScale[] = ["compact", "normal", "large"];

/**
 * Normalize user-supplied tuning (URL params are untrusted): drop unparseable
 * colors and unknown enum values instead of letting them reach CSS.
 */
export function sanitizeTuning(input: {
  accent?: string | null;
  anim?: string | null;
  density?: string | null;
  motion?: string | null;
  radius?: string | null;
  scale?: string | null;
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
  if (input.motion && (MOTIONS as string[]).includes(input.motion)) {
    tuning.motion = input.motion as SkinMotion;
  }
  if (input.radius && (RADII as string[]).includes(input.radius)) {
    tuning.radius = input.radius as SkinRadius;
  }
  if (input.scale && (TEXT_SCALES as string[]).includes(input.scale)) {
    tuning.textScale = input.scale as SkinTextScale;
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
  scenario?: DemoScenario;
}): string {
  const params = new URLSearchParams();
  params.set("skin", input.skin);
  params.set("lang", input.lang);
  if (input.backend !== "mock") params.set("backend", input.backend);
  if (input.scene !== "live") params.set("scene", input.scene);
  if (input.full) params.set("full", "1");
  const scenario = input.scenario ?? DEFAULT_SCENARIO;
  if (scenario !== DEFAULT_SCENARIO) params.set("scenario", scenario);

  const accent = input.tuning.accent ? safeAccent(input.tuning.accent) : null;
  if (accent) params.set("accent", accent);
  if (input.tuning.textAnim && input.tuning.textAnim !== "none") params.set("anim", input.tuning.textAnim);
  if (input.tuning.density && input.tuning.density !== "comfortable") params.set("density", input.tuning.density);
  if (input.tuning.motion && input.tuning.motion !== "normal") params.set("motion", input.tuning.motion);
  if (input.tuning.radius) params.set("radius", input.tuning.radius);
  if (input.tuning.textScale && input.tuning.textScale !== "normal") params.set("scale", input.tuning.textScale);
  return params.toString();
}
