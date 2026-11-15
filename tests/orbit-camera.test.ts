import { describe, expect, it } from "vitest";
import { TunnelCamera } from "../packages/agui-skins/src/skins/orbit/tunnelCamera";

/* The camera contract is deliberately pure: no three.js, no DOM. These tests
   pin the stick-to-bottom semantics and the dolly safety bounds. */

const bounds = (minZ: number, maxZ: number) => ({ minZ, maxZ });

describe("orbit tunnel camera", () => {
  it("starts at the live edge with follow engaged", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    expect(camera.following).toBe(true);
    expect(camera.positionZ).toBe(-60);
    expect(camera.targetZ).toBe(-60);
  });

  it("chases a new newest station while following", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    camera.updateBounds(bounds(-80, -10));
    expect(camera.targetZ).toBe(-80);
    expect(camera.following).toBe(true);
  });

  it("wheel input interrupts follow and keeps the user's place when new tokens arrive", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    camera.wheel(-400); // scroll up = travel back
    expect(camera.following).toBe(false);
    const parked = camera.targetZ;
    expect(parked).toBeGreaterThan(-60);
    camera.updateBounds(bounds(-90, -10));
    expect(camera.targetZ).toBe(parked);
    expect(camera.following).toBe(false);
  });

  it("re-engages follow when the user scrolls back to the newest edge", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    camera.wheel(-200);
    expect(camera.following).toBe(false);
    camera.wheel(20_000); // scroll far down, clamped at min
    expect(camera.following).toBe(true);
    expect(camera.targetZ).toBe(-60);
  });

  it("never leaves the bounds under wheel or update spam", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    camera.wheel(-1e9);
    expect(camera.targetZ).toBe(-10);
    camera.wheel(1e9);
    expect(camera.targetZ).toBe(-60);
    camera.updateBounds(bounds(-100, -40));
    camera.wheel(-1e9);
    expect(camera.targetZ).toBeLessThanOrEqual(-40);
    expect(camera.targetZ).toBeGreaterThanOrEqual(-100);
  });

  it("damps toward the target and converges inside the bounds", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    camera.wheel(-300);
    const parked = camera.targetZ;
    // first frame moves a fraction of the way
    const first = camera.tick(1 / 60);
    expect(first).toBeGreaterThan(-60);
    expect(first).toBeLessThan(parked);
    for (let index = 0; index < 600; index += 1) camera.tick(1 / 60);
    expect(camera.positionZ).toBeCloseTo(parked, 3);
  });

  it("snaps instantly for reduced motion and reports progress", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    camera.wheel(-10_000);
    camera.snap();
    expect(camera.positionZ).toBe(-10);
    expect(camera.progress()).toBe(1);
    camera.resume();
    camera.snap();
    expect(camera.positionZ).toBe(-60);
    expect(camera.progress()).toBe(0);
  });

  it("resume() returns to the live edge without easing", () => {
    const camera = new TunnelCamera(bounds(-60, -10));
    camera.wheel(-500);
    camera.resume();
    expect(camera.following).toBe(true);
    expect(camera.snap()).toBe(-60);
  });
});
