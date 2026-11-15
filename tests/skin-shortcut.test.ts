import { describe, expect, it } from "vitest";
import { skins } from "agui-skins";
import { skinShortcutIndex } from "../src/app/skinShortcut";

describe("skin hotkeys", () => {
  it("maps 1–9 to the first nine skins", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => skinShortcutIndex(String(n)))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("maps 0 to the tenth skin (orbit) — the task-14 gap", () => {
    expect(skinShortcutIndex("0")).toBe(9);
    expect(skins[9].id).toBe("orbit");
  });

  it("ignores non-digit and multi-character keys instead of mapping Space to skin 1", () => {
    for (const key of [" ", "", "a", "10", "00", "Enter", "!"]) {
      expect(skinShortcutIndex(key)).toBeNull();
    }
  });
});
