import { describe, expect, it } from "vitest";
import { buildAppQuery, sanitizeTuning } from "../src/app/urlState";

describe("sanitizeTuning", () => {
  it("normalizes hex colors and drops unknown enums", () => {
    expect(
      sanitizeTuning({ accent: "#DB2777", anim: "rise", density: "compact", motion: "fast", radius: "round", scale: "large" })
    ).toEqual({
      accent: "#db2777",
      textAnim: "rise",
      density: "compact",
      motion: "fast",
      radius: "round",
      textScale: "large",
    });
  });

  it("ignores malformed accents and enum values", () => {
    expect(sanitizeTuning({ accent: "oops", anim: "wobble", density: "dense", motion: "zoom", radius: "blob", scale: "huge" })).toEqual({});
    expect(sanitizeTuning({ accent: null, anim: null, density: null })).toEqual({});
  });
});

describe("buildAppQuery", () => {
  const base = { skin: "classic", lang: "zh" as const, backend: "mock" as const, scene: "live", full: false };

  it("omits default values", () => {
    expect(buildAppQuery({ ...base, tuning: {} })).toBe("skin=classic&lang=zh");
  });

  it("carries the current tuning so the link is shareable", () => {
    expect(
      buildAppQuery({
        ...base,
        tuning: { accent: "#db2777", textAnim: "rise", density: "compact", motion: "fast", radius: "round", textScale: "large" },
      })
    ).toBe("skin=classic&lang=zh&accent=%23db2777&anim=rise&density=compact&motion=fast&radius=round&scale=large");
  });

  it("keeps backend / scene / full when non-default", () => {
    expect(
      buildAppQuery({ skin: "aurora", lang: "en", backend: "pi", scene: "done", full: true, tuning: {} })
    ).toBe("skin=aurora&lang=en&backend=pi&scene=done&full=1");
  });
});
