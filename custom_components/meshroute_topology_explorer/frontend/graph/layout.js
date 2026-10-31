// SPDX-License-Identifier: MIT
// Spring-electrical layout of the quality view (spec 7.1). Pure and deterministic for a seed; no DOM.
// Model: one spring per reading with rest length L = L0 × D × f(q), repulsion between all devices of the mesh scaled
// with (L0 × D)², a pull to the centre (Eades 1984; Fruchterman and Reingold 1991: displacement capped by a cooling
// temperature). Devices without readings sit on a ring just outside the mesh. Pinned devices do not move.
// Usage: const layout = new Layout(network, { baseLength, density, seed }); layout.run(); layout.position(id)
// node --test tests/

import { buildQuadtree, quadtreeForce } from "./quadtree.js";

/** Densities of spec 7.1. */
export const DENSITY = Object.freeze({ dense: 0.7, medium: 1, spread: 1.5 });
/** Spring factor of a reading without a usable value (LQI 0 or none), spec 7.1. */
export const UNKNOWN_FACTOR = 1.5;
/** Settled: the largest move of a step is below this many layout units (spec 12). */
export const SETTLE_MOVE = 0.5;

/** Tuning of the integrator, chosen by measurement on the sample and on synthetic networks (docs/provenance.md,
 *  A2). Every force is proportional to K, so the picture only scales with the density. */
export const PARAMS = Object.freeze({
  repulsion: 0.05, // repulsion R × K² / d between devices, K = L0 × D
  spring: 1, // spring S × K × (d / L − 1): stretch counted relative to the rest length, see the note in step()
  gravity: 0.03, // pull G × distance towards the centre; keeps loose parts near the mesh
  step: 1, // displacement per unit force, divided by (1 + springs at the device) so busy routers do not overshoot
  heat: 0.6, // starting temperature (largest move per step) in K
  cooling: 0.998, // temperature factor per step; slow enough that large networks settle by balance, not by freezing
  maxSteps: 3000, // step budget
  exactBelow: 600, // exact pair sums below this many devices, Barnes-Hut above (speed target, spec 12)
  theta: 0.8, // Barnes-Hut opening criterion
});

/** f(q) of spec 7.1 for an LQI of 0..255; unknown (0, null, not a number) gives 1.5. */
export function springFactor(lqi) {
  if (typeof lqi !== "number" || !(lqi > 0)) return UNKNOWN_FACTOR;
  const q = Math.min(lqi, 255) / 255;
  return 1 + 5 * (1 - q) ** 2;
}

/** L0 of spec 7.1: node diameter plus the mean label width at zoom 1, in layout units. */
export function baseLength(labels, measure, nodeDiameter) {
  if (!labels.length) return nodeDiameter;
  let sum = 0;
  for (const label of labels) sum += measure(label);
  return nodeDiameter + sum / labels.length;
}

/** Small seeded generator (mulberry32): the same seed gives the same layout in every browser and in Node. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Layout {
  /** network: { devices: [{ id }], readings: [{ reporter, subject, lqi }] }; options: baseLength (L0), density (D),
   *  seed, pinned (Map or object id -> { x, y }), params (overrides of PARAMS). */
  constructor(network, { baseLength: l0 = 100, density = DENSITY.medium, seed = 1, pinned = null, params = {} } = {}) {
    this.params = { ...PARAMS, ...params };
    this.K = l0 * density;
    // Sorted ids: the result does not depend on the order in which the adapter lists devices.
    this.ids = [...new Set((network.devices || []).map((d) => d.id))].sort();
    this.index = new Map(this.ids.map((id, i) => [id, i]));
    const n = this.ids.length;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.fx = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.pinned = new Uint8Array(n);
    this.mesh = new Uint8Array(n);
    this.degree = new Uint32Array(n);
    this._buildSprings(network.readings || []);
    this._random = seededRandom(seed);
    this._place(pinned);
    this.temperature = this.params.heat * this.K;
    this.steps = 0;
    this.lastMove = Infinity;
    this.settled = this.meshIds().length === 0;
    this.placeRing();
  }

  /** One spring per distinct (reporter, subject); a duplicate keeps the better value. Readings that name unknown
   *  devices or a device hearing itself are dropped. */
  _buildSprings(readings) {
    const best = new Map();
    for (const r of readings) {
      const a = this.index.get(r && r.reporter);
      const b = this.index.get(r && r.subject);
      if (a === undefined || b === undefined || a === b) continue;
      const key = a * this.ids.length + b;
      const lqi = typeof r.lqi === "number" && r.lqi > 0 ? r.lqi : null;
      if (!best.has(key) || (lqi !== null && (best.get(key).lqi === null || lqi > best.get(key).lqi))) {
        best.set(key, { a, b, lqi });
      }
    }
    const springs = [...best.values()].sort((p, q) => p.a - q.a || p.b - q.b);
    this.springA = new Uint32Array(springs.map((s) => s.a));
    this.springB = new Uint32Array(springs.map((s) => s.b));
    this.springLqi = springs.map((s) => s.lqi);
    this.rest = new Float64Array(springs.map((s) => this.K * springFactor(s.lqi)));
    for (const s of springs) {
      this.mesh[s.a] = 1;
      this.mesh[s.b] = 1;
      this.degree[s.a]++;
      this.degree[s.b]++;
    }
  }

  /** Start positions: pinned devices where they were pinned, the rest at seeded random points in a disc whose area
   *  grows with the number of devices. */
  _place(pinned) {
    const get = (id) => (pinned instanceof Map ? pinned.get(id) : pinned && pinned[id]);
    const radius = this.K * Math.sqrt(Math.max(this.meshIds().length, 1)) * 0.5;
    for (let i = 0; i < this.ids.length; i++) {
      const angle = this._random() * 2 * Math.PI;
      const r = radius * Math.sqrt(this._random());
      this.x[i] = r * Math.cos(angle);
      this.y[i] = r * Math.sin(angle);
      const p = get(this.ids[i]);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        this.x[i] = p.x;
        this.y[i] = p.y;
        this.pinned[i] = 1;
      }
    }
  }

  meshIds() { return this.ids.filter((_, i) => this.mesh[i]); }
  ringIds() { return this.ids.filter((_, i) => !this.mesh[i]); }
  has(id) { return this.index.has(id); }
  isPinned(id) { return this.pinned[this.index.get(id)] === 1; }
  isMesh(id) { return this.mesh[this.index.get(id)] === 1; }

  position(id) {
    const i = this.index.get(id);
    return i === undefined ? null : { x: this.x[i], y: this.y[i] };
  }

  /** Fix a device at (x, y). The others react once the layout is reheated. */
  pin(id, x, y) {
    const i = this.index.get(id);
    if (i === undefined) return;
    this.pinned[i] = 1;
    this.x[i] = x;
    this.y[i] = y;
  }

  unpin(id) {
    const i = this.index.get(id);
    if (i === undefined) return;
    this.pinned[i] = 0;
    if (!this.mesh[i]) this.placeRing();
  }

  /** Let the layout move again with a temperature of fraction × K, e.g. after a drag. */
  reheat(fraction = 0.15) {
    this.temperature = Math.max(this.temperature, fraction * this.K);
    this.settled = this.meshIds().length === 0;
  }

  /** Devices without readings, evenly on a ring just outside the mesh, starting at the top, in id order. The ring
   *  is also wide enough to hold them side by side. */
  placeRing() {
    const ring = [];
    for (let i = 0; i < this.ids.length; i++) if (!this.mesh[i] && !this.pinned[i]) ring.push(i);
    if (!ring.length) return;
    let cx = 0; let cy = 0; let m = 0;
    for (let i = 0; i < this.ids.length; i++) {
      if (this.mesh[i]) { cx += this.x[i]; cy += this.y[i]; m++; }
    }
    if (m) { cx /= m; cy /= m; }
    let reach = 0;
    for (let i = 0; i < this.ids.length; i++) {
      if (this.mesh[i]) reach = Math.max(reach, Math.hypot(this.x[i] - cx, this.y[i] - cy));
    }
    const radius = Math.max(reach + this.K, (ring.length * this.K * 0.5) / (2 * Math.PI));
    ring.forEach((i, j) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * j) / ring.length;
      this.x[i] = cx + radius * Math.cos(angle);
      this.y[i] = cy + radius * Math.sin(angle);
    });
    this.ringCentre = { x: cx, y: cy, r: radius };
  }

  /** One integration step; returns the largest move. */
  step() {
    const { x, y, fx, fy, mesh, pinned, degree, K } = this;
    const p = this.params;
    const n = this.ids.length;
    fx.fill(0);
    fy.fill(0);
    const active = [];
    for (let i = 0; i < n; i++) if (mesh[i]) active.push(i);
    const kk = p.repulsion * K * K;
    if (active.length < p.exactBelow) {
      for (let s = 0; s < active.length; s++) {
        const i = active[s];
        for (let t = s + 1; t < active.length; t++) {
          const j = active[t];
          let dx = x[i] - x[j];
          let dy = y[i] - y[j];
          let d2 = dx * dx + dy * dy;
          if (d2 < 1e-6) {
            // Coincident devices: push apart along a direction fixed by their indices (deterministic).
            dx = Math.cos(i + j);
            dy = Math.sin(i + j);
            d2 = 1;
          }
          const f = kk / d2;
          fx[i] += dx * f; fy[i] += dy * f;
          fx[j] -= dx * f; fy[j] -= dy * f;
        }
      }
    } else {
      const tree = buildQuadtree(active, x, y);
      for (const i of active) {
        const [rx, ry] = quadtreeForce(tree, i, x[i], y[i], kk, p.theta);
        fx[i] += rx; fy[i] += ry;
      }
    }
    const { springA, springB, rest } = this;
    // Relative stretch: a long weak spring at twice its length pulls as hard as a short strong one at twice its
    // length. Measured on the sample (seeds 1-8, medium density, other settings equal): rank correlation -0.85 to
    // -0.86 for this law, -0.78 to -0.85 for logarithmic and -0.80 to -0.88 for plain Hooke springs; this one was
    // the steadiest across seeds (docs/provenance.md, A2).
    const sk = p.spring * K;
    for (let s = 0; s < rest.length; s++) {
      const a = springA[s];
      const b = springB[s];
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const f = (sk * (d / rest[s] - 1)) / d;
      fx[a] += dx * f; fy[a] += dy * f;
      fx[b] -= dx * f; fy[b] -= dy * f;
    }
    let maxMove = 0;
    const t = this.temperature;
    for (const i of active) {
      if (pinned[i]) continue;
      const eta = p.step / (1 + degree[i]);
      let mx = (fx[i] - p.gravity * x[i]) * eta;
      let my = (fy[i] - p.gravity * y[i]) * eta;
      const m = Math.hypot(mx, my);
      if (m > t) { mx *= t / m; my *= t / m; }
      x[i] += mx;
      y[i] += my;
      const moved = Math.min(m, t);
      if (moved > maxMove) maxMove = moved;
    }
    this.temperature *= p.cooling;
    this.steps++;
    this.lastMove = maxMove;
    if (maxMove < SETTLE_MOVE || this.steps >= p.maxSteps) this.settled = true;
    return maxMove;
  }

  /** Step until settled, the step budget is spent or budgetMs has passed (now() is injectable for tests and frames).
   *  Returns the number of steps taken. */
  run({ budgetMs = Infinity, now = () => Date.now() } = {}) {
    const start = now();
    let taken = 0;
    while (!this.settled) {
      this.step();
      taken++;
      if ((taken & 7) === 0 && now() - start >= budgetMs) break;
    }
    this.placeRing();
    return taken;
  }

  /** For each spring: its reading's LQI (null if unknown) and the drawn distance. Used by the fidelity check. */
  springLengths() {
    const out = [];
    for (let s = 0; s < this.rest.length; s++) {
      const a = this.springA[s];
      const b = this.springB[s];
      out.push({ lqi: this.springLqi[s], length: Math.hypot(this.x[b] - this.x[a], this.y[b] - this.y[a]) });
    }
    return out;
  }
}
