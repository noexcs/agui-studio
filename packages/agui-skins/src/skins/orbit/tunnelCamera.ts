/* ─────────────────────────────────────────────────────────────────────
   TunnelCamera — the scroll/flight model for Orbit v2, with no three.js
   dependency so the follow/dolly contract is unit-testable.

   Semantics (stick-to-bottom equivalent):
     • the camera looks down the tunnel (-Z) and auto-follows the newest
       station, keeping `followGap` units between the lens and it;
     • wheel input dollies the camera; it interrupts auto-follow until the
       user travels back to the newest end, which re-engages following;
     • target and position are clamped to the model bounds at every step —
       the camera can never fly through geometry or leave the tunnel;
     • damping is frame-rate independent (exponential smoothing).
   ───────────────────────────────────────────────────────────────────── */

export interface CameraBounds {
  minZ: number;
  maxZ: number;
}

export interface TunnelCameraOptions {
  /** smoothing rate; higher = snappier (default 7.5) */
  damping?: number;
  /** world units per wheel pixel (default 0.16 — one chamber per ~120px) */
  wheelSpeed?: number;
  /** distance kept to the newest station when following (default 17) */
  followGap?: number;
}

export class TunnelCamera {
  private readonly damping: number;
  private readonly wheelSpeed: number;
  private readonly followGap: number;

  /** current camera z (smoothed) */
  positionZ: number;
  /** target camera z (raw wheel/target) */
  targetZ: number;
  /** true while the camera is pinned to the newest station */
  following = true;
  minZ: number;
  maxZ: number;

  constructor(bounds: CameraBounds, options: TunnelCameraOptions = {}) {
    this.damping = options.damping ?? 7.5;
    this.wheelSpeed = options.wheelSpeed ?? 0.16;
    this.followGap = options.followGap ?? 17;
    this.minZ = bounds.minZ;
    this.maxZ = Math.max(bounds.minZ, bounds.maxZ);
    this.positionZ = this.minZ;
    this.targetZ = this.minZ;
  }

  /** Recompute bounds from a new scene model. While following, chase the
      newest station; while the user is travelling, keep their absolute
      position (clamped) instead of yanking them to the new end. */
  updateBounds(bounds: CameraBounds): void {
    this.minZ = bounds.minZ;
    this.maxZ = Math.max(bounds.minZ, bounds.maxZ);
    if (this.following) {
      this.targetZ = this.minZ;
    } else {
      this.targetZ = clamp(this.targetZ, this.minZ, this.maxZ);
    }
    this.positionZ = clamp(this.positionZ, this.minZ, this.maxZ);
  }

  /** Wheel input. Positive wheel delta (scroll down) travels forward into
      the tunnel (z decreases). Re-engages following at the newest bound. */
  wheel(deltaY: number): void {
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    this.following = false;
    this.targetZ = clamp(this.targetZ - deltaY * this.wheelSpeed, this.minZ, this.maxZ);
    if (this.targetZ <= this.minZ + 0.01) {
      this.following = true;
      this.targetZ = this.minZ;
    }
  }

  /** Explicit "jump to live" (keyboard / follow affordance). */
  resume(): void {
    this.following = true;
    this.targetZ = this.minZ;
  }

  /** Advance the damped position by dt seconds. Returns the camera z. */
  tick(dt: number): number {
    // clamp dt so a tab-return cannot teleport the camera across the room
    const step = clamp(dt, 0, 0.1);
    const factor = 1 - Math.exp(-this.damping * step);
    this.positionZ += (this.targetZ - this.positionZ) * factor;
    if (Math.abs(this.targetZ - this.positionZ) < 0.0005) this.positionZ = this.targetZ;
    this.positionZ = clamp(this.positionZ, this.minZ, this.maxZ);
    return this.positionZ;
  }

  /** Reduced motion / initial paint: no easing, land on the target now. */
  snap(): number {
    this.positionZ = clamp(this.targetZ, this.minZ, this.maxZ);
    return this.positionZ;
  }

  /** 0 = newest (live edge), 1 = oldest (fully rolled back). */
  progress(): number {
    const span = this.maxZ - this.minZ;
    if (span <= 0.0001) return 0;
    return clamp((this.positionZ - this.minZ) / span, 0, 1);
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
