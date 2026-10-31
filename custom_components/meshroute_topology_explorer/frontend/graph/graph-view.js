// SPDX-License-Identifier: MIT
// The quality-view map on a <canvas> (spec 7.1, 8, 9.3): runs the layout, draws frames, turns pointer, wheel and key
// input into pan, zoom, pin and selection, and reports what the user did as events. Knows nothing about Home
// Assistant: it reads a Network ({ source, id, devices, readings }, see model/index.js) and a theme of plain colours.
// Usage: const view = new GraphView(canvas, { theme, density }); view.setNetwork(network);
//        view.addEventListener("select", (e) => e.detail.id); view.reveal(id, insets, { zoom: true })
// Events (user actions only; calls from code do not emit): select { id|null }, details-request { id, via:
// "long-press" | "context-menu" | "key" }, hover { id|null }, pin-change { id, pinned, x, y }.
// Density (decision by Fabian Schwamborn, 2026-10-31) only lengthens or shortens the lines: the layout is computed
// once in base units (D = 1) and drawn at base × D; markers, labels, fit and the working scale never depend on D.
// Pinned positions (events, pin(), setNetwork's pinned) are in base lengths L0 of that layout, from its centre, so a
// stored pin keeps its place in the picture whatever the density or the label font.
// node --test tests/

import { Layout, baseLength, DENSITY } from "./layout.js";
import { buildScene, drawScene, hitTest, NODE_DIAMETER } from "./renderer.js";
import { GestureRecognizer } from "./gestures.js";
import { LABEL_SCALE } from "./labels.js";
import { legendEntries } from "./links.js";
import { resolveTheme, FILLS } from "./palette.js";
import {
  ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, bounds, fitCamera, interpolate, panBy, toWorld, toScreen, wheelFactor, zoomAt,
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
/** A revealed device keeps this much room to the edge of the free area (CSS pixels): its label fits beside it. */
const REVEAL_MARGIN = 48;

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
    /** Call fn whenever the device pixel ratio changes (browser zoom, moving to another screen); returns a stop
     *  function. A resolution media query matches only the current ratio, so it is renewed after every change. */
    watchResolution: (fn) => {
      if (!g.matchMedia) return () => {};
      let query = null;
      const onChange = () => { fn(); arm(); };
      const arm = () => {
        if (query) query.removeEventListener("change", onChange);
        query = g.matchMedia(`(resolution: ${g.devicePixelRatio || 1}dppx)`);
        query.addEventListener("change", onChange);
      };
      arm();
      return () => query.removeEventListener("change", onChange);
    },
  };
}

export class GraphView extends EventTarget {
  /** options: theme (colours, see palette.js), density (0.7 / 1 / 1.5, e.g. the stored setting), fill ("reception",
   *  "role" or "power"), texts ({ uncertain, parent, route }), seed, debug, env (timers and media queries, injectable
   *  for tests). */
  constructor(canvas, options = {}) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.env = { ...defaultEnv(), ...(options.env || {}) };
    this.theme = resolveTheme(options.theme);
    this.density = options.density || DENSITY.medium;
    this.seed = options.seed || 1;
    this.debug = Boolean(options.debug);
    this.fill = FILLS.includes(options.fill) ? options.fill : "reception";
    this.texts = { uncertain: "0 (uncertain)", parent: "Parent", route: "Route", ...(options.texts || {}) };
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.hidden = true;
    this.cam = { k: 1, cx: 0, cy: 0 };
    this.fitK = 1;
    this.autoFit = true;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.selected = -1;
    this.hovered = -1;
    this.pinned = new Map();
    this.scene = null;
    this.layout = null;
    this.pos = null;
    this.lastDraw = null;
    this._frame = null;
    this._anim = null;
    this._grab = null;
    this._firstLayout = false;
    this._fps = null;
    this._lastFrame = null;
    this._widths = new Map();
    this._scaleCache = null;
    this._keyMenuAt = -Infinity;
    this.recognizer = new GestureRecognizer(this._gestureHandlers(), {
      setTimeout: (f, ms) => this.env.setTimeout(f, ms),
      clearTimeout: (h) => this.env.clearTimeout(h),
    });
    this._listen();
    this._unwatch = this.env.watchResolution ? this.env.watchResolution(() => this.resize()) : () => {};
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

  /** Change the density (spec 7.1): every position is drawn at base × D, so all lines get longer or shorter while
   *  markers, labels and the zoom stay as they are. No new layout. The selection keeps its place on screen; without
   *  one, the point at the centre of the view stays there. */
  setDensity(density) {
    if (!(density > 0) || density === this.density) return;
    const ratio = density / this.density;
    this.density = density;
    if (!this.scene) return;
    const target = this._anim ? this._anim.to : this.cam;
    this._anim = null;
    const k = target.k;
    const anchor = this.selected >= 0 ? toScreen(target, this.pos.x[this.selected], this.pos.y[this.selected],
      this.width, this.height) : null;
    this._sync();
    if (anchor) {
      const i = this.selected;
      this.cam = { k, cx: this.pos.x[i] - (anchor[0] - this.width / 2) / k,
        cy: this.pos.y[i] - (anchor[1] - this.height / 2) / k };
    } else {
      this.cam = { k, cx: target.cx * ratio, cy: target.cy * ratio };
    }
    this._invalidate();
  }

  setDebug(on) {
    this.debug = Boolean(on);
    this._invalidate();
  }

  /** Choose the fill of the devices (spec 8): "reception" (default), "role" or "power"; anything else is ignored. */
  setFill(fill) {
    if (!FILLS.includes(fill) || fill === this.fill) return;
    this.fill = fill;
    this._invalidate();
  }

  /** Words the map draws itself, translated by the panel: { uncertain } for LQI 0 on a lane, { parent, route } on
   *  a lane that a parent link or a route implies. */
  setTexts(texts) {
    this.texts = { ...this.texts, ...texts };
    this._invalidate();
  }

  /** Legend entries for the links in the current theme (links.js legendEntries): the panel draws them in its words. */
  legend() { return legendEntries(this.theme); }

  setTheme(theme) {
    this.theme = resolveTheme(theme);
    this._widths.clear();
    this._invalidate();
  }

  /** Select a device by id (null clears). Does not emit "select"; follow with reveal() to bring it into view. */
  select(id) {
    this.selected = this.scene && id != null && this.scene.index.has(id) ? this.scene.index.get(id) : -1;
    this._invalidate();
  }

  get selectedId() { return this.selected >= 0 ? this.scene.nodes[this.selected].id : null; }

  /** Parts of the canvas covered by the panel (the drawer, spec 9.1), in CSS pixels. The selection is kept clear of
   *  them: setting new insets pans the map if the selected device would be covered. */
  setInsets(insets = {}) {
    this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
    if (this.selected >= 0) this.reveal(this.selectedId);
  }

  /** Bring a device into the free part of the canvas (outside the insets). With zoom: true, zoom to the working scale
   *  and centre it there (selection from the list, a finding, a double click or the keyboard, spec 9.3), but never
   *  out past the fitted overview (a small network may already show more room than the working scale); without,
   *  pan only as far as needed. Animated unless the user prefers reduced motion. */
  reveal(id, insets = this.insets, { zoom = false, animate = true } = {}) {
    if (!this.scene || !this.scene.index.has(id) || !this.width) return;
    const i = this.scene.index.get(id);
    const ins = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
    let box = { left: ins.left, top: ins.top, right: this.width - ins.right, bottom: this.height - ins.bottom };
    if (box.right - box.left < 2 * REVEAL_MARGIN || box.bottom - box.top < 2 * REVEAL_MARGIN) {
      box = { left: 0, top: 0, right: this.width, bottom: this.height }; // the drawer leaves no room: ignore it
    }
    const from = this._anim ? this._anim.to : this.cam;
    const k = zoom ? this._clampZoom(Math.max(this.workingZoom, this.fitK)) : from.k;
    const x = this.pos.x[i];
    const y = this.pos.y[i];
    let sx;
    let sy;
    if (zoom) {
      sx = (box.left + box.right) / 2;
      sy = (box.top + box.bottom) / 2;
    } else {
      [sx, sy] = toScreen(from, x, y, this.width, this.height);
      const m = Math.min(REVEAL_MARGIN, (box.right - box.left) / 2, (box.bottom - box.top) / 2);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const nx = clamp(sx, box.left + m, box.right - m);
      const ny = clamp(sy, box.top + m, box.bottom - m);
      if (nx === sx && ny === sy) return;
      sx = nx;
      sy = ny;
    }
    this.autoFit = false;
    this._animateTo({ k, cx: x - (sx - this.width / 2) / k, cy: y - (sy - this.height / 2) / k }, animate);
  }

  /** The working scale (spec 7.1, 9.3): the zoom at which, in the base layout (D = 1), the median distance from a
   *  device to its nearest neighbour equals the mean label width. It does not compensate the density: at the same
   *  zoom a spread map shows 1.5 label widths between neighbours, a dense one 0.7. Revealing with zoom goes here. */
  get workingZoom() {
    const { nearest, meanLabel } = this._scales();
    return nearest > 0 ? meanLabel / nearest : this.fitK;
  }

  /** The zoom from which everyone may be labelled: where the drawn nearest-neighbour distance on screen reaches
   *  LABEL_SCALE label widths (labels.js). It is measured on screen, so a spread map shows labels earlier. */
  get labelZoom() {
    const { nearest, meanLabel } = this._scales();
    return nearest > 0 ? (LABEL_SCALE * meanLabel) / (nearest * this.density) : this.fitK;
  }

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

  /** Read the canvas size and device pixel ratio again (ResizeObserver, resolution changes). A canvas without size is
   *  hidden (display: none, a closed tab of the panel): its buffer is left alone and drawing pauses (spec 10). */
  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h || this.canvas.isConnected === false) {
      this.hidden = true;
      return;
    }
    const dpr = this.env.devicePixelRatio();
    const wasHidden = this.hidden;
    this.hidden = false;
    if (w === this.width && h === this.height && dpr === this.dpr) {
      if (wasHidden) this._invalidate();
      return;
    }
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
    this._unwatch();
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

  /** Median nearest-neighbour distance among the devices of the mesh in the base layout (D = 1) and the mean label
   *  width (CSS pixels), cached until the layout moves. Above 400 devices an evenly spread subset of them is measured
   *  (against all), which keeps it cheap while a large layout unfolds. */
  _scales() {
    if (this._scaleCache !== null) return this._scaleCache;
    const { x, y, mesh } = this.layout;
    const ids = [];
    for (let i = 0; i < mesh.length; i++) if (mesh[i]) ids.push(i);
    const step = Math.max(1, Math.ceil(ids.length / 400)); // layout indices: the order does not matter here
    const nearest = [];
    for (let s = 0; s < ids.length; s += step) {
      const i = ids[s];
      let best = Infinity;
      for (const j of ids) {
        if (j === i) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
      if (best < Infinity) nearest.push(Math.sqrt(best));
    }
    nearest.sort((a, b) => a - b);
    const mid = nearest.length >> 1;
    const median = !nearest.length ? 0 : nearest.length % 2 ? nearest[mid] : (nearest[mid - 1] + nearest[mid]) / 2;
    const labels = this.scene.labels;
    const meanLabel = labels.length ? labels.reduce((sum, l) => sum + this._measure(l), 0) / labels.length : 0;
    this._scaleCache = { nearest: median, meanLabel };
    return this._scaleCache;
  }

  _clampZoom(k) {
    return Math.max(this.fitK * ZOOM_MIN, Math.min(this.fitK * ZOOM_MAX, k));
  }

  /** A new layout in base units (D = 1); the density is applied when positions are copied for drawing (_sync). */
  _relayout() {
    const scene = this.scene;
    const l0 = baseLength(scene.labels, this._measure, NODE_DIAMETER);
    const pinned = new Map([...this.pinned].map(([id, p]) => [id, { x: p.x * l0, y: p.y * l0 }]));
    this.layout = new Layout(this.network, { baseLength: l0, density: 1, seed: this.seed, pinned });
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

  /** Copy the layout's positions for drawing, scaled by the density. */
  _sync() {
    const { x, y, pinned, mesh } = this.layout;
    const t = this._toLayout;
    const d = this.density;
    for (let i = 0; i < t.length; i++) {
      this.pos.x[i] = x[t[i]] * d;
      this.pos.y[i] = y[t[i]] * d;
      this.pos.pinned[i] = pinned[t[i]];
      this.pos.mesh[i] = mesh[t[i]];
    }
    this._scaleCache = null;
  }

  /** The fitted view of the medium layout (D = 1), centred on the map: fit never undoes the density, so a dense map
   *  sits smaller inside the margin and a spread one reaches past the window. */
  _fitCamera() {
    if (!this.pos) return fitCamera(null, this.width, this.height, FIT_MARGIN);
    const d = this.density;
    const box = bounds(this.pos.x, this.pos.y);
    const base = box && { minX: box.minX / d, minY: box.minY / d, maxX: box.maxX / d, maxY: box.maxY / d };
    const cam = fitCamera(base, this.width, this.height, FIT_MARGIN);
    return { k: cam.k, cx: cam.cx * d, cy: cam.cy * d };
  }

  _screenOf(i) {
    return toScreen(this.cam, this.pos.x[i], this.pos.y[i], this.width, this.height);
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
    if (this.hidden) return; // resize() asks again once the canvas has a size
    if (this._frame === null && this.env.requestFrame) this._frame = this.env.requestFrame((t) => this._onFrame(t));
  }

  _onFrame() {
    this._frame = null;
    if (this.hidden) return;
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
    if (!this.scene || !this.pos || this.hidden) return;
    if (this._lastFrame !== null && now - this._lastFrame < 250 && now > this._lastFrame) {
      const fps = 1000 / (now - this._lastFrame);
      this._fps = this._fps === null ? fps : this._fps * 0.9 + fps * 0.1;
    }
    this._lastFrame = now;
    const view = {
      cam: this.cam, width: this.width, height: this.height, dpr: this.dpr, labelZoom: this.labelZoom,
      debug: this.debug, selected: this.selected, hovered: this.hovered, fps: this._fps, fill: this.fill,
      texts: this.texts,
    };
    this.lastDraw = drawScene(this.ctx, this.scene, this.pos, view, this.theme, this._measure);
  }

  // ---- input --------------------------------------------------------------------------------------------------

  _hit(x, y) {
    if (!this.scene) return -1;
    const n = this.scene.nodes.length;
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    for (let i = 0; i < n; i++) [sx[i], sy[i]] = this._screenOf(i);
    return hitTest(this.scene, sx, sy, this.cam.k, x, y);
  }

  _emit(type, detail) { this.dispatchEvent(new GraphEvent(type, detail)); }

  _userSelect(index) {
    if (index === this.selected) return;
    this.selected = index;
    this._emit("select", { id: this.selectedId });
    if (index >= 0) this.reveal(this.selectedId); // keep it clear of the drawer
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
      // Double click: releases a pinned device (spec 7.1) and goes to the working scale (decision 2026-10-31).
      doubleTap: (t) => {
        if (!isNode(t)) return;
        if (this.pos.pinned[t.index]) {
          this.unpin(t.id);
          this._sync();
          this._emit("pin-change", { id: t.id, pinned: false });
        }
        this.reveal(t.id, this.insets, { zoom: true });
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
          // Drawn positions are base × D; the layout keeps base units.
          this.layout.pin(t.id, (wx + this._grab.dx) / this.density, (wy + this._grab.dy) / this.density);
          this.layout.reheat();
          this._sync();
        } else {
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
    this._listeners = [];
    const on = (type, fn, opts) => { c.addEventListener(type, fn, opts); this._listeners.push([type, fn, opts]); };
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
      } else if (e.key === "Enter" && this.selected >= 0) {
        e.preventDefault(); this.reveal(this.selectedId, this.insets, { zoom: true });
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
