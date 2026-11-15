import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Orbit's deep-space backdrop, isolated in its own lazily imported module.
 *
 * Design constraints (task-14 brief):
 * • one draw call — a single `THREE.Points` with a BufferGeometry of 2000
 *   vertices and per-vertex colors (no per-star objects, no instancing loop);
 * • slow self-rotation + mouse parallax capped at ±6px (rAF is the only
 *   scheduler; React never re-renders for a frame);
 * • `prefers-reduced-motion` disables the loop and the pointer listener
 *   (the page also skips this module entirely when that media query matches,
 *   so the CSS starfield fallback is what reduced-motion users see);
 * • every GPU resource is disposed on unmount: rAF, listeners, observer,
 *   geometry, material, renderer and its WebGL context;
 * • WebGL unavailable → onFail() and the page keeps its CSS starfield.
 */
export default function Starfield({
  onReady,
  onFail,
}: {
  onReady?: () => void;
  onFail?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readyRef = useRef(onReady);
  const failRef = useRef(onFail);
  readyRef.current = onReady;
  failRef.current = onFail;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // jsdom / very old browsers do not expose a WebGL constructor at all.
    if (typeof WebGLRenderingContext === "undefined" && typeof WebGL2RenderingContext === "undefined") {
      failRef.current?.();
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      if (!renderer.getContext()) throw new Error("orbit: no WebGL context");
    } catch {
      failRef.current?.();
      return;
    }

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 1, 1, 2600);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -240);

    const group = new THREE.Group();
    group.rotation.x = 0.06;
    scene.add(group);

    // Seeded PRNG keeps the sky recognizable across reloads/screenshots
    // (Math.random would resurface the field on every mount).
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
      // Flattened spherical shell around a point slightly behind the camera:
      // an even field with obvious depth, all reachable by the slow spin.
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

    // Round, slightly glowy stars: a generated radial sprite keeps the field
    // to one draw call while avoiding the raw square PointsMaterial look.
    const spriteCanvas = document.createElement("canvas");
    spriteCanvas.width = 64;
    spriteCanvas.height = 64;
    const spriteCtx = spriteCanvas.getContext("2d");
    let sprite: THREE.CanvasTexture | null = null;
    if (spriteCtx) {
      const gradient = spriteCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.32, "rgba(255,255,255,0.85)");
      gradient.addColorStop(0.68, "rgba(255,255,255,0.28)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      spriteCtx.fillStyle = gradient;
      spriteCtx.fillRect(0, 0, 64, 64);
      sprite = new THREE.CanvasTexture(spriteCanvas);
    }

    const material = new THREE.PointsMaterial({
      size: 2.2,
      sizeAttenuation: true,
      vertexColors: true,
      map: sprite ?? undefined,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    group.add(points);

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const host = canvas.parentElement ?? canvas;
    const resize = () => {
      const width = Math.max(1, host.clientWidth || window.innerWidth || 1);
      const height = Math.max(1, host.clientHeight || window.innerHeight || 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (reducedMotion) renderer.render(scene, camera);
    };

    let frame = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    let targetX = 0;
    let targetY = 0;

    const renderFrame = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      group.rotation.y += delta * 0.014; // ~0.8°/s — a sky, not a carousel
      camera.position.x += (targetX * 6 - camera.position.x) * 0.045;
      camera.position.y += (-targetY * 6 - camera.position.y) * 0.045;
      camera.lookAt(0, 0, -240);
      renderer.render(scene, camera);
    };

    const loop = () => {
      frame = 0;
      if (disposed || document.hidden) return;
      frame = requestAnimationFrame(loop);
      renderFrame();
    };

    const onPointer = (event: PointerEvent) => {
      targetX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      targetY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };

    const onVisibility = () => {
      if (reducedMotion) return;
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame && !disposed) {
        clock.getDelta(); // swallow the paused interval
        loop();
      }
    };

    const onResize = () => resize();

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    observer?.observe(host);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    if (!reducedMotion) window.addEventListener("pointermove", onPointer, { passive: true });

    resize();
    renderer.render(scene, camera);
    readyRef.current?.();
    if (!reducedMotion) loop();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      scene.clear();
      geometry.dispose();
      material.dispose();
      sprite?.dispose();
      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch {
        // context already gone — nothing left to release
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="or-sky-canvas pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
