// SPDX-License-Identifier: MIT
// The quality-view map on a <canvas> (spec 7.1, 8, 9.3): runs the layout, draws frames, turns pointer, wheel and key
// input into pan, zoom, pin and selection, and reports what the user did as events. Knows nothing about Home
// Assistant: it reads a Network ({ source, id, devices, readings }) and a theme of plain colours.
// Usage: const view = new GraphView(canvas, { theme, density }); view.setNetwork(network);
//        view.addEventListener("select", (e) => e.detail.id)
// Events (user actions only; calls from code do not emit): select { id|null }, details-request { id, via:
// "long-press" | "context-menu" | "key" }, hover { id|null }, pin-change { id, pinned, x, y }.
// Pinned positions (events, pin(), setNetwork's pinned) are in base lengths K = L0 × D from the centre, so a stored
// pin keeps its place in the picture when the density or the label font changes.
// node --test tests/

import { Layout, baseLength, DENSITY } from "./layout.js";
import { buildScene, drawScene, hitTest, NODE_DIAMETER } from "./renderer.js";
import { GestureRecognizer } from "./gestures.js";
import { resolveTheme } from "./palette.js";
import {
  ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, bounds, fitCamera, interpolate, panBy, toWorld, wheelFactor, zoomAt,
} from "./camera.js";

/** Event with a detail field; CustomEvent is missing in some runtimes the tests use. */
export class GraphEvent extends Event {
  constructor(type, detail) {
    super(type);
    this.detail = detail;
  }
}

/** Time the layout may take inside one frame, and before the first frame (ms). Own choice: leaves room for drawing
 *  at 30 frames per second; small networks settle before the first frame. */
const FRAME_BUDGET_MS = 12;
const FIRST_BUDGET_MS = 40;
/** Duration of animated zoom and fit (ms); none with reduced motion. */
const ZOOM_ANIMATION_MS = 200;
/** Screen margin of the fitted view: room for labels under the outer devices. */
const FIT_MARGIN = 56;

function defaultEnv() {
  const g = globalThis;
  return {
    requestFrame: (f) => g.requestAnimationFrame(f),
    cancelFrame: (h) => g.cancelAnimationFrame(h),
    now: () => (g.performance ? g.performance.now() : Date.now()),
    setTimeout: (f, ms) => g.setTimeout(f, ms),
    clearTimeout: (h) => g.clearTimeout(h),
    devicePixelRatio: () => g.devicePixelRatio || 1,
    reducedMotion: () => Boolean(g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches),
    ResizeObserver: g.ResizeObserver,
  };
}

export class GraphView extends EventTarget {
  /** options: theme (colours, see palette.js), density (0.7 / 1 / 1.5), seed, debug, env (timers and media
   *  queries, injectable for tests). */
  constructor(canvas, options = {}) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.env = { ...defaultEnv(), ...(options.env || {}) };
    this.theme = resolveTheme(options.theme);
    this.density = options.density || DENSITY.medium;
    this.seed = options.seed || 1;
    this.debug = Boolean(options.debug);
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cam = { k: 1, cx: 0, cy: 0 };
    this.fitK = 1;
    this.autoFit = true;
    this.selected = -1;
    this.hovered = -1;
    this.pinned = new Map();
    this.scene = null;
    this.layout = null;
    this.pos = null;
    this._frame = null;
    this._anim = null;
    this._grab = null;
    this._firstLayout = false;
    this._fps = null;
    this._lastFrame = null;
    this._widths = new Map();
    this._keyMenuAt = -Infinity;
    this.recognizer = new GestureRecognizer(this._gestureHandlers(), {
      setTimeout: (f, ms) => this.env.setTimeout(f, ms),
      clearTimeout: (h) => this.env.clearTimeout(h),
    });
    this._listen();
    this.resize();
  }

  // ---- public API -------------------------------------------------------------------------------------------

  /** Show a network. pinned: Map or object id -> { x, y } of stored positions in base lengths (spec 11). The layout
   *  starts from the seed every time, so the same data always gives the same picture. */
  setNetwork(network, { pinned } = {}) {
    if (pinned) this.pinned = new Map(pinned instanceof Map ? pinned : Object.entries(pinned));
    const keep = this.scene ? this.selectedId : null;
    this.network = network || { devices: [], readings: [] };
    this.scene = buildScene(this.network, this._measure);
    // The selection survives a data refresh if the device is still there.
    this.selected = keep !== null && this.scene.index.has(keep) ? this.scene.index.get(keep) : -1;
    this.hovered = -1;
    this._relayout();
  }

  /** Change the density, keeping the zoom: the model is scale-free, so refitting would show the same picture
   *  again; at the same zoom the map visibly tightens or spreads around the centre of the view. */
  setDensity(density) {
    if (density === this.density) return;
    const ratio = density / this.density;
    this.density = density;
    if (!this.scene) return;
    const keep = { k: this.cam.k, cx: this.cam.cx * ratio, cy: this.cam.cy * ratio };
    this._relayout();
    this.autoFit = false;
    this._anim = null;
    this.cam = keep;
  }

  setDebug(on) {
    this.debug = Boolean(on);
    this._invalidate();
  }

  setTheme(theme) {
    this.theme = resolveTheme(theme);
    this._widths.clear();
    this._invalidate();
  }

  /** Select a device by id (null clears). Does not emit "select". */
  select(id) {
    this.selected = this.scene && id != null && this.scene.index.has(id) ? this.scene.index.get(id) : -1;
    this._invalidate();
  }

  get selectedId() { return this.selected >= 0 ? this.scene.nodes[this.selected].id : null; }

  /** Stored positions of pinned devices, for the settings (spec 11). */
  pinnedPositions() { return new Map(this.pinned); }

  /** Pin a device at (x, y) in base lengths. */
  pin(id, x, y) {
    if (!this.layout || !this.layout.has(id)) return;
    this.layout.pin(id, x * this.layout.K, y * this.layout.K);
    this.pinned.set(id, { x, y });
    this.layout.reheat();
    this._invalidate();
  }

  unpin(id) {
    if (!this.layout || !this.layout.has(id)) return;
    this.layout.unpin(id);
    this.pinned.delete(id);
    this.layout.reheat();
    this._invalidate();
  }

  /** Show everything; animated unless the user prefers reduced motion. */
  fit({ animate = true } = {}) {
    this.autoFit = true;
    this._animateTo(this._fitCamera(), animate);
  }

  zoomBy(factor, { animate = true } = {}) {
    this.autoFit = false;
    const target = zoomAt(this._anim ? this._anim.to : this.cam, factor, this.width / 2, this.height / 2,
      this.width, this.height, this.fitK * ZOOM_MIN, this.fitK * ZOOM_MAX);
    this._animateTo(target, animate);
  }

  zoomIn() { this.zoomBy(ZOOM_STEP); }
  zoomOut() { this.zoomBy(1 / ZOOM_STEP); }

  /** Read the canvas size and device pixel ratio again; called by a ResizeObserver when one exists. */
  resize() {
    const w = this.canvas.clientWidth || this.canvas.width || 300;
    const h = this.canvas.clientHeight || this.canvas.height || 150;
    const dpr = this.env.devicePixelRatio();
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (this.pos) {
      const fit = this._fitCamera();
      this.fitK = fit.k;
      if (this.autoFit) this.cam = fit;
    }
    this._invalidate();
  }

  destroy() {
    for (const [type, fn, opts] of this._listeners) this.canvas.removeEventListener(type, fn, opts);
    if (this._observer) this._observer.disconnect();
    if (this._frame !== null) this.env.cancelFrame(this._frame);
    this._frame = null;
  }

  // ---- layout and drawing -----------------------------------------------------------------------------------

  _measure = (text) => {
    let w = this._widths.get(text);
    if (w === undefined) {
      this.ctx.font = this.theme.font;
      w = this.ctx.measureText(text).width;
      this._widths.set(text, w);
    }
    return w;
  };

  _relayout() {
    const scene = this.scene;
    const l0 = baseLength(scene.labels, this._measure, NODE_DIAMETER);
    const K = l0 * this.density;
    const pinned = new Map([...this.pinned].map(([id, p]) => [id, { x: p.x * K, y: p.y * K }]));
    this.layout = new Layout(this.network, { baseLength: l0, density: this.density, seed: this.seed, pinned });
    const n = scene.nodes.length;
    this._toLayout = Int32Array.from(scene.nodes, (node) => this.layout.index.get(node.id));
    this.pos = { x: new Float64Array(n), y: new Float64Array(n), pinned: new Uint8Array(n), mesh: new Uint8Array(n) };
    this.layout.run({ budgetMs: FIRST_BUDGET_MS, now: this.env.now });
    this._firstLayout = !this.layout.settled;
    this._sync();
    if (this.autoFit) {
      this.cam = this._fitCamera();
      this._anim = null;
    }
    this.fitK = this._fitCamera().k;
    this._invalidate();
  }

  _sync() {
    const { x, y, pinned, mesh } = this.layout;
    const t = this._toLayout;
    for (let i = 0; i < t.length; i++) {
      this.pos.x[i] = x[t[i]];
      this.pos.y[i] = y[t[i]];
      this.pos.pinned[i] = pinned[t[i]];
      this.pos.mesh[i] = mesh[t[i]];
    }
  }

  _fitCamera() {
    return fitCamera(this.pos ? bounds(this.pos.x, this.pos.y) : null, this.width, this.height, FIT_MARGIN);
  }

  _animateTo(target, animate) {
    if (!animate || this.env.reducedMotion()) {
      this.cam = target;
      this._anim = null;
    } else {
      this._anim = { from: this.cam, to: target, start: this.env.now() };
    }
    this._invalidate();
  }

  _invalidate() {
    if (this._frame === null && this.env.requestFrame) this._frame = this.env.requestFrame((t) => this._onFrame(t));
  }

  _onFrame() {
    this._frame = null;
    const now = this.env.now();
    let again = false;
    if (this.layout && !this.layout.settled) {
      this.layout.run({ budgetMs: FRAME_BUDGET_MS, now: this.env.now });
      this._sync();
      if (this._firstLayout) {
        // While a new layout unfolds the view follows it; after a drag it stays where the user left it.
        const fit = this._fitCamera();
        this.fitK = fit.k;
        if (this.autoFit && !this._anim) this.cam = fit;
      }
      again = !this.layout.settled;
      if (!again) this._firstLayout = false;
    }
    if (this._anim) {
      const p = Math.min(1, (now - this._anim.start) / ZOOM_ANIMATION_MS);
      const eased = 1 - (1 - p) ** 3;
      this.cam = interpolate(this._anim.from, this._anim.to, eased);
      if (p >= 1) this._anim = null; else again = true;
    }
    // With reduced motion the first layout is not shown while it moves; the finished picture appears at once.
    if (!(this._firstLayout && this.env.reducedMotion())) this.draw(now);
    if (again) this._invalidate();
  }

  /** Draw one frame now. */
  draw(now = this.env.now()) {
    if (!this.scene || !this.pos) return;
    if (this._lastFrame !== null && now - this._lastFrame < 250 && now > this._lastFrame) {
      const fps = 1000 / (now - this._lastFrame);
      this._fps = this._fps === null ? fps : this._fps * 0.9 + fps * 0.1;
    }
    this._lastFrame = now;
    const view = {
      cam: this.cam, width: this.width, height: this.height, dpr: this.dpr, density: this.density, debug: this.debug,
      selected: this.selected, hovered: this.hovered, fps: this._fps,
    };
    drawScene(this.ctx, this.scene, this.pos, view, this.theme, this._measure);
  }

  // ---- input --------------------------------------------------------------------------------------------------

  _hit(x, y) {
    if (!this.scene) return -1;
    const n = this.scene.nodes.length;
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    const { k, cx, cy } = this.cam;
    for (let i = 0; i < n; i++) {
      sx[i] = (this.pos.x[i] - cx) * k + this.width / 2;
      sy[i] = (this.pos.y[i] - cy) * k + this.height / 2;
    }
    return hitTest(this.scene, sx, sy, k, x, y);
  }

  _emit(type, detail) { this.dispatchEvent(new GraphEvent(type, detail)); }

  _userSelect(index) {
    if (index === this.selected) return;
    this.selected = index;
    this._emit("select", { id: this.selectedId });
    this._invalidate();
  }

  _requestDetails(index, via) {
    this._userSelect(index);
    this._emit("details-request", { id: this.scene.nodes[index].id, via });
  }

  _gestureHandlers() {
    const isNode = (t) => t && t.kind === "node";
    return {
      hitTest: (x, y) => {
        const i = this._hit(x, y);
        return i >= 0 ? { kind: "node", id: this.scene.nodes[i].id, index: i } : { kind: "background" };
      },
      tap: (t) => this._userSelect(isNode(t) ? t.index : -1),
      doubleTap: (t) => {
        if (!isNode(t) || !this.pos.pinned[t.index]) return;
        this.unpin(t.id);
        this._sync();
        this._emit("pin-change", { id: t.id, pinned: false });
      },
      longPress: (t) => { if (isNode(t)) this._requestDetails(t.index, "long-press"); },
      dragStart: (t, p0) => {
        this._anim = null;
        this.autoFit = false;
        if (!isNode(t)) return;
        const [wx, wy] = toWorld(this.cam, p0.x, p0.y, this.width, this.height);
        this._grab = { dx: this.pos.x[t.index] - wx, dy: this.pos.y[t.index] - wy };
      },
      drag: (t, p, dx, dy) => {
        if (isNode(t)) {
          const [wx, wy] = toWorld(this.cam, p.x, p.y, this.width, this.height);
          this.layout.pin(t.id, wx + this._grab.dx, wy + this._grab.dy);
          this.layout.reheat();
          this._sync();
        } else {
          this.autoFit = false;
          this.cam = panBy(this.cam, dx, dy);
        }
        this._invalidate();
      },
      dragEnd: (t) => {
        if (!isNode(t)) return;
        const at = this.layout.position(t.id);
        const stored = { x: at.x / this.layout.K, y: at.y / this.layout.K };
        this.pinned.set(t.id, stored);
        this._emit("pin-change", { id: t.id, pinned: true, ...stored });
      },
      pinch: (factor, cx, cy, dx, dy) => {
        this.autoFit = false;
        this._anim = null;
        this.cam = zoomAt(panBy(this.cam, dx, dy), factor, cx, cy, this.width, this.height,
          this.fitK * ZOOM_MIN, this.fitK * ZOOM_MAX);
        this._invalidate();
      },
    };
  }

  _point(e) {
    const r = this.canvas.getBoundingClientRect();
    return { pointerId: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  }

  _setHover(index) {
    if (index === this.hovered) return;
    this.hovered = index;
    this.canvas.style.cursor = index >= 0 ? "pointer" : "";
    this._emit("hover", { id: index >= 0 ? this.scene.nodes[index].id : null });
    this._invalidate();
  }

  _listen() {
    const c = this.canvas;
    if (c.getAttribute("tabindex") === null) c.setAttribute("tabindex", "0"); // keys need focus
    c.style.touchAction = "none"; // the page must not scroll or zoom under a gesture on the map
    const on = (type, fn, opts) => { c.addEventListener(type, fn, opts); this._listeners.push([type, fn, opts]); };
    this._listeners = [];
    on("pointerdown", (e) => {
      // The right button belongs to the context menu, the middle one to the browser.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } }
      this.recognizer.down(this._point(e));
    });
    on("pointermove", (e) => {
      if (this.recognizer.has(e.pointerId)) {
        this.recognizer.move(this._point(e));
      } else if (e.pointerType === "mouse" && !e.buttons) {
        const p = this._point(e);
        this._setHover(this._hit(p.x, p.y));
      }
    });
    on("pointerup", (e) => this.recognizer.up(this._point(e)));
    on("pointercancel", (e) => this.recognizer.cancel(this._point(e)));
    on("pointerleave", (e) => { if (e.pointerType === "mouse") this._setHover(-1); });
    on("wheel", (e) => {
      e.preventDefault();
      const p = this._point(e);
      this.autoFit = false;
      this._anim = null;
      this.cam = zoomAt(this.cam, wheelFactor(e.deltaY, e.deltaMode), p.x, p.y, this.width, this.height,
        this.fitK * ZOOM_MIN, this.fitK * ZOOM_MAX);
      this._invalidate();
    }, { passive: false });
    on("contextmenu", (e) => {
      // A menu key press was already handled in keydown; a right-click is ours only on a device (spec 9.2).
      if (e.timeStamp - this._keyMenuAt < 500) { e.preventDefault(); return; }
      const p = this._point(e);
      const i = this._hit(p.x, p.y);
      if (i < 0) return;
      e.preventDefault();
      this._requestDetails(i, "context-menu");
    });
    on("keydown", (e) => {
      const menu = e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
      if (menu) {
        this._keyMenuAt = e.timeStamp;
        if (this.selected >= 0) { e.preventDefault(); this._requestDetails(this.selected, "key"); }
      } else if (e.key === "Escape" && this.selected >= 0) {
        this._userSelect(-1);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault(); this.zoomIn();
      } else if (e.key === "-") {
        e.preventDefault(); this.zoomOut();
      } else if (e.key === "0") {
        e.preventDefault(); this.fit();
      }
    });
    if (this.env.ResizeObserver) {
      this._observer = new this.env.ResizeObserver(() => this.resize());
      this._observer.observe(c);
    }
  }
}
