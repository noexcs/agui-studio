import { useEffect, useRef } from "react";

/**
 * Canvas particle text — the skin's signature surface.
 *
 * A small, self-contained implementation (sample the glyph alpha mask, then
 * spring particles toward the sampled points, with pointer repulsion and a
 * click burst). It is inspired by the particle-text pattern popularised by
 * React Bits, but written independently for this skin; no component code is
 * vendored.
 */
export function ParticleText({
  text,
  color = "#dfe2ff",
  accent = "#9b8cff",
  particleSize = 1.7,
  fontWeight = 800,
  className = "",
}: {
  text: string;
  color?: string;
  accent?: string;
  particleSize?: number;
  fontWeight?: number;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles: { x: number; y: number; tx: number; ty: number; vx: number; vy: number; r: number; c: string; a: number; ph: number }[] = [];
    let frame = 0;
    let alive = true;
    const pointer = { x: 0, y: 0, active: false };
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const mix = (a: string, b: string, t: number) => {
      // canvas-safe interpolation without parsing external color formats:
      // use the accent for a fraction of particles and the base for the rest.
      return t > 0.82 ? b : a;
    };

    const build = () => {
      const rect = wrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const family = window.getComputedStyle(wrap).fontFamily || "sans-serif";
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) return;
      probe.font = `${fontWeight} 100px ${family}`;
      const measured = probe.measureText(text).width || 1;
      const size = Math.max(28, Math.min(height * 0.6, (width * 0.9 * 100) / measured));

      const off = document.createElement("canvas");
      off.width = Math.ceil(width);
      off.height = Math.ceil(height);
      const offCtx = off.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;
      offCtx.font = `${fontWeight} ${size}px ${family}`;
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.fillStyle = "#fff";
      offCtx.fillText(text, width / 2, height / 2);
      const data = offCtx.getImageData(0, 0, off.width, off.height).data;

      const gap = Math.max(3, Math.round(size / 30));
      const targets: { x: number; y: number; t: number }[] = [];
      for (let y = 0; y < off.height; y += gap) {
        for (let x = 0; x < off.width; x += gap) {
          if (data[(y * off.width + x) * 4 + 3] > 140) {
            targets.push({ x, y, t: x / Math.max(1, off.width) });
          }
        }
      }
      if (targets.length > 5200) {
        const stride = Math.ceil(targets.length / 5200);
        targets.splice(0, targets.length, ...targets.filter((_, index) => index % stride === 0));
      }

      particles = targets.map((target) => ({
        // start close to the glyph so the first frame already reads as text;
        // the residual spring motion gives the "assembling" feel without a
        // full-screen scatter that hides the hero for a second.
        x: reduced ? target.x : target.x + rand(-16, 16),
        y: reduced ? target.y : target.y + rand(-12, 12),
        tx: target.x,
        ty: target.y,
        vx: 0,
        vy: 0,
        r: particleSize * rand(0.7, 1.35),
        c: mix(color, accent, target.t),
        a: rand(0.45, 0.95),
        ph: rand(0, Math.PI * 2),
      }));
      draw(0);
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        if (!reduced) {
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          p.vx = (p.vx + dx * 0.16) * 0.8;
          p.vy = (p.vy + dy * 0.16) * 0.8;
          if (pointer.active) {
            const px = p.x - pointer.x;
            const py = p.y - pointer.y;
            const dist = Math.hypot(px, py);
            if (dist > 0.01 && dist < 92) {
              const force = ((92 - dist) / 92) * 2.6;
              p.vx += (px / dist) * force;
              p.vy += (py / dist) * force;
            }
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.ph += dt * 0.9;
          p.x += Math.sin(p.ph) * 0.04;
          p.y += Math.cos(p.ph * 0.8) * 0.04;
        }
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(2.2, (now - (frame || now)) / 16.67) || 1;
      frame = now;
      draw(dt);
      requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    const onDown = (event: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      for (const p of particles) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.max(16, Math.hypot(dx, dy));
        const force = 7 + Math.random() * 6;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }
    };

    build();
    const observer = new ResizeObserver(build);
    observer.observe(wrap);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("pointerdown", onDown);
    if (!reduced) requestAnimationFrame(tick);
    document.fonts?.ready.then(build).catch(() => {});

    return () => {
      alive = false;
      observer.disconnect();
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      wrap.removeEventListener("pointerdown", onDown);
    };
  }, [text, color, accent, particleSize, fontWeight]);

  return (
    <div ref={wrapRef} className={`sk-particle-text ${className}`.trim()} data-skin-text="">
      <canvas ref={canvasRef} className="sk-particle-text__canvas" aria-hidden="true" />
      <span className="sk-particle-text__sr">{text}</span>
    </div>
  );
}
