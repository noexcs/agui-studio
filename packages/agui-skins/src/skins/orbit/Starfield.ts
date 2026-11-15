import * as THREE from "three";

/* ─────────────────────────────────────────────────────────────────────
   Orbit's deep-space backdrop — the v1 star-field skeleton, adapted for
   Orbit v2's single-renderer scene.

   What carried over from the v1 module (task-14 review):
     • one draw call for the whole star field — a single `THREE.Points`
       with 2000 seeded vertices and per-vertex colors;
     • seeded PRNG so screenshots/reloads show the same sky;
     • generated radial sprite (round, glowy stars), DPR-independent;
     • full disposal of geometry/material/texture — the scene owner also
       disposes the renderer;
     • the pointer input is fed in as values: the scene owns rAF and the
       listeners, so this module stays pure three.js.

   v2 additions: three additive nebula sprites (still one texture each,
   no per-frame allocation) and a slow sky drift the scene can freeze for
   reduced motion.
   ───────────────────────────────────────────────────────────────────── */

export interface StarfieldHandle {
  group: THREE.Group;
  dispose: () => void;
}

function makeStarSprite(): THREE.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.32, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.68, "rgba(255,255,255,0.28)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function makeNebulaSprite(color: string, seed: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.45, color.replace(/[\d.]+\)$/, "0.16)"));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  const unit = ((seed * 2654435761) >>> 0) / 4294967296;
  const unit2 = ((seed * 1103515245 + 12345) >>> 0) / 4294967296;
  sprite.position.set((unit - 0.5) * 260, (unit2 - 0.5) * 140, -520 - unit2 * 320);
  sprite.scale.setScalar(380 + unit * 220);
  return sprite;
}

export function createStarfield(): StarfieldHandle {
  const group = new THREE.Group();
  group.rotation.x = 0.06;

  // Seeded PRNG keeps the sky recognizable across reloads/screenshots.
  let seed = 0x0b17a3;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const COUNT = 2000;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const palette = [
    new THREE.Color("#cfd8ff"),
    new THREE.Color("#9d8cff"),
    new THREE.Color("#67f5d0"),
    new THREE.Color("#ffffff"),
  ];
  for (let i = 0; i < COUNT; i += 1) {
    // Flattened spherical shell around a point behind the camera: an even
    // field with obvious depth, all reachable by the slow spin.
    const radius = 260 + rand() * 940;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const sinPhi = Math.sin(phi);
    positions[i * 3] = radius * sinPhi * Math.cos(theta);
    positions[i * 3 + 1] = radius * sinPhi * Math.sin(theta) * 0.62;
    positions[i * 3 + 2] = radius * Math.cos(phi) - 420;
    const pick = rand();
    const color = palette[pick < 0.62 ? 0 : pick < 0.82 ? 1 : pick < 0.93 ? 2 : 3];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const sprite = makeStarSprite();
  const material = new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: true,
    vertexColors: true,
    map: sprite ?? undefined,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  group.add(points);

  const nebulaSprites = [
    makeNebulaSprite("rgba(113,84,255,0.34)", 7),
    makeNebulaSprite("rgba(54,220,205,0.22)", 19),
    makeNebulaSprite("rgba(74,126,255,0.2)", 41),
  ];
  for (const nebula of nebulaSprites) group.add(nebula);

  return {
    group,
    dispose() {
      group.clear();
      geometry.dispose();
      material.dispose();
      sprite?.dispose();
      for (const nebula of nebulaSprites) {
        nebula.material.map?.dispose();
        nebula.material.dispose();
      }
    },
  };
}
