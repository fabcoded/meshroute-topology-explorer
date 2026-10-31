// SPDX-License-Identifier: MIT
// One gesture model for mouse, pen and touch (spec 9.3), fed with plain pointer records so it runs without a DOM:
// a press that moves less than 8 px is a tap, more is a drag (on a device: pin and move; on the background: pan);
// 500 ms without moving 8 px is a long press; two pointers pinch. Timers are injectable for tests.
// node --test tests/

/** Movement in CSS pixels below which a press is still a tap (spec 9.3). */
export const TAP_SLOP = 8;
/** Long press duration in ms (spec 9.3). */
export const LONG_PRESS_MS = 500;
/** Two taps on the same target within this time and distance are a double tap (unpins, spec 7.1). Common platform
 *  convention; own choice. */
export const DOUBLE_TAP_MS = 400;

/** Handlers (all optional): hitTest(x, y) -> target ({ kind: "node", id } or { kind: "background" }),
 *  tap(target, p), doubleTap(target, p), longPress(target, p), dragStart(target, p0, p), drag(target, p, dx, dy),
 *  dragEnd(target, p), pinch(factor, cx, cy, dx, dy), gestureEnd(). Points are { x, y }. */
export class GestureRecognizer {
  constructor(handlers = {}, timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) }) {
    this.h = handlers;
    this.timers = timers;
    this.pointers = new Map(); // pointerId -> { x, y }
    this.g = null; // the gesture in progress
    this.lastTap = null;
  }

  get active() { return this.g !== null; }
  has(pointerId) { return this.pointers.has(pointerId); }

  _call(name, ...args) {
    const f = this.h[name];
    return typeof f === "function" ? f(...args) : undefined;
  }

  _clearTimer() {
    if (this.g && this.g.timer !== null) {
      this.timers.clearTimeout(this.g.timer);
      this.g.timer = null;
    }
  }

  /** e: { pointerId, x, y, t } in CSS pixels relative to the canvas, t in ms. */
  down(e) {
    this.pointers.set(e.pointerId, { x: e.x, y: e.y });
    if (this.pointers.size === 2) {
      // A second finger turns whatever the first one did into a pinch; a node drag ends where it is.
      this._clearTimer();
      if (this.g && this.g.phase === "drag") this._call("dragEnd", this.g.target, this.g.last);
      const [a, b] = [...this.pointers.values()];
      this.g = { phase: "pinch", timer: null, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    const target = this._call("hitTest", e.x, e.y) || { kind: "background" };
    const start = { x: e.x, y: e.y };
    this.g = { phase: "pending", target, start, last: start, t: e.t, timer: null };
    const g = this.g;
    g.timer = this.timers.setTimeout(() => {
      g.timer = null;
      if (this.g === g && g.phase === "pending") {
        g.phase = "long";
        this._call("longPress", g.target, g.last);
      }
    }, LONG_PRESS_MS);
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.x, y: e.y });
    const g = this.g;
    if (!g) return;
    if (g.phase === "pinch") {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      this._call("pinch", dist / g.dist, cx, cy, cx - g.cx, cy - g.cy);
      Object.assign(g, { dist, cx, cy });
      return;
    }
    const p = { x: e.x, y: e.y };
    if (g.phase === "pending") {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) <= TAP_SLOP) { g.last = p; return; }
      this._clearTimer();
      g.phase = "drag";
      this._call("dragStart", g.target, g.start, p);
      // The first drag step covers the whole way from the press, so the map or device stays under the pointer.
      this._call("drag", g.target, p, p.x - g.start.x, p.y - g.start.y);
      g.last = p;
      return;
    }
    if (g.phase === "drag") {
      this._call("drag", g.target, p, p.x - g.last.x, p.y - g.last.y);
      g.last = p;
    }
    // "long": the press already did its job; moving afterwards does nothing until release.
  }

  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.phase === "pinch") {
      // The finger that stays may pan, but never becomes a tap.
      if (this.pointers.size === 1) {
        const [rest] = this.pointers.values();
        this.g = { phase: "drag", target: { kind: "background" }, start: rest, last: rest, t: e.t, timer: null };
      } else if (this.pointers.size >= 2) {
        // A third finger left: pinch on with the two that remain, measured from here.
        const [a, b] = [...this.pointers.values()];
        Object.assign(g, { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
      } else {
        this.g = null;
        this._call("gestureEnd");
      }
      return;
    }
    this._clearTimer();
    this.g = null;
    const p = { x: e.x, y: e.y };
    if (g.phase === "pending") {
      const prev = this.lastTap;
      const same = prev && e.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) <= TAP_SLOP &&
        prev.target.kind === g.target.kind && prev.target.id === g.target.id;
      this._call("tap", g.target, p);
      if (same) {
        this.lastTap = null;
        this._call("doubleTap", g.target, p);
      } else {
        this.lastTap = { t: e.t, x: p.x, y: p.y, target: g.target };
      }
    } else if (g.phase === "drag") {
      this._call("dragEnd", g.target, p);
    }
    this._call("gestureEnd");
  }

  /** The browser took the pointer away (scrolling, a system gesture): end without a tap. */
  cancel(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.g;
    this._clearTimer();
    this.g = null;
    if (g && g.phase === "drag") this._call("dragEnd", g.target, g.last);
    this._call("gestureEnd");
  }
}
