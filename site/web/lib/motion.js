/* ============================================================================
   motion.js: the physics behind every gesture on the page, and one frame clock.

   Ported from the Pragma site (motion.js + clock.js). Springs are parameterised the way
   Apple's fluid-interfaces talk does it: `response` (seconds to reach the target) and
   `damping` (1 = critically damped, no overshoot).
   ========================================================================== */

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export class Spring {
  constructor(value = 0, { response = 0.4, damping = 1 } = {}) {
    this.v = value; this.target = value; this.vel = 0;
    this.response = response; this.damping = damping;
  }
  set(target) { this.target = target; return this; }
  /** Seed a value without motion. Never use this to interrupt one. */
  jump(v) { this.v = v; this.target = v; this.vel = 0; return this; }
  /** Velocity handoff: continue at the gesture's exact release speed. */
  kick(vel) { this.vel = vel; return this; }
  step(dt) {
    const w = (2 * Math.PI) / this.response;
    const k = w * w, c = 2 * this.damping * w;
    // fixed substeps: a stiff spring integrated on one long frame explodes
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -k * (this.v - this.target) - c * this.vel;
      this.vel += a * h;
      this.v += this.vel * h;
    }
    return this.v;
  }
  get settled() { return Math.abs(this.v - this.target) < 0.002 && Math.abs(this.vel) < 0.02; }
}

/** Progressive resistance past a boundary: follows less the further you pull. */
export const rubberband = (overshoot, dimension, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

/** A short history of pointer samples. Release velocity needs more than the last point. */
export class Tracker {
  constructor(depth = 6) { this.depth = depth; this.pts = []; }
  push(x, y, t) { this.pts.push({ x, y, t }); if (this.pts.length > this.depth) this.pts.shift(); }
  velocity() {
    const p = this.pts;
    if (p.length < 2) return { x: 0, y: 0 };
    const a = p[0], b = p[p.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.001) return { x: 0, y: 0 };
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }
  reset() { this.pts.length = 0; }
}

/** 1:1 drag with the grab offset preserved and rubber-banded walls. */
export function dragPosition(pointer, grab, bounds, dim) {
  const raw = { x: pointer.x - grab.x, y: pointer.y - grab.y };
  return {
    x: raw.x < bounds.minX ? bounds.minX + rubberband(raw.x - bounds.minX, dim.w)
      : raw.x > bounds.maxX ? bounds.maxX + rubberband(raw.x - bounds.maxX, dim.w) : raw.x,
    y: raw.y < bounds.minY ? bounds.minY + rubberband(raw.y - bounds.minY, dim.h)
      : raw.y > bounds.maxY ? bounds.maxY + rubberband(raw.y - bounds.maxY, dim.h) : raw.y,
  };
}

/* ── one frame clock ────────────────────────────────────────────────────────
   It rides GSAP's ticker when GSAP is on the page, because Lenis moves the scroll on that
   ticker: anything that reads a scroll-driven rectangle every frame (the 3D files flying into
   the app window) has to run on the same tick, or it trails the page by a frame and swims. */
const tasks = new Set();
let last = performance.now();
function run(now) {
  // Clamped: after a tab switch the first delta is seconds long, and a spring would jump.
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  for (const task of tasks) task(dt, now);
}
let started = false;
function start() {
  if (started) return;
  started = true;
  if (window.gsap) window.gsap.ticker.add(() => run(performance.now()));
  else { const loop = (now) => { run(now); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
}
export const onTick = (fn) => { start(); tasks.add(fn); return () => tasks.delete(fn); };
