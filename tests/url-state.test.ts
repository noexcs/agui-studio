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

  it("carries a non-default demo scenario", () => {
    expect(buildAppQuery({ ...base, scenario: "travel", tuning: {} })).toBe(
      "skin=classic&lang=zh&scenario=travel"
    );
    expect(buildAppQuery({ ...base, scenario: "agents", tuning: {} })).toBe("skin=classic&lang=zh");
  });

  it("keeps backend / scene / full when non-default", () => {
    expect(
      buildAppQuery({ skin: "aurora", lang: "en", backend: "pi", scene: "done", full: true, tuning: {} })
    ).toBe("skin=aurora&lang=en&backend=pi&scene=done&full=1");
  });
});

describe("theme tuning", () => {
  it("keeps whitelisted themes and drops unknown values", () => {
    expect(sanitizeTuning({ theme: "light" })).toEqual({ theme: "light" });
    expect(sanitizeTuning({ theme: "dark" })).toEqual({ theme: "dark" });
    expect(sanitizeTuning({ theme: "solarized" })).toEqual({});
    expect(sanitizeTuning({ theme: null })).toEqual({});
  });

  it("serializes an explicit light pick and omits the dark default", () => {
    const base = { skin: "workbench", lang: "zh" as const, backend: "mock" as const, scene: "live", full: false };
    expect(buildAppQuery({ ...base, tuning: { theme: "light" } })).toBe("skin=workbench&lang=zh&theme=light");
    expect(buildAppQuery({ ...base, tuning: { theme: "dark" } })).toBe("skin=workbench&lang=zh");
    expect(buildAppQuery({ ...base, tuning: {} })).toBe("skin=workbench&lang=zh");
  });

  it("round-trips a shareable light-theme link", () => {
    const base = { skin: "workbench", lang: "en" as const, backend: "mock" as const, scene: "done", full: true };
    const tuning = { theme: "light", accent: "#db2777", textAnim: "rise" } as const;
    const query = buildAppQuery({ ...base, tuning });
    const params = new URLSearchParams(query);
    const restored = sanitizeTuning({
      accent: params.get("accent"),
      anim: params.get("anim"),
      density: params.get("density"),
      motion: params.get("motion"),
      radius: params.get("radius"),
      scale: params.get("scale"),
      theme: params.get("theme"),
    });
    expect(restored).toEqual({ accent: "#db2777", textAnim: "rise", theme: "light" });
  });
});
