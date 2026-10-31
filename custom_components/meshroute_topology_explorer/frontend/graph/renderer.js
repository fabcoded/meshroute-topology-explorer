// SPDX-License-Identifier: MIT
// Canvas 2D drawing of the quality view (spec 7.1, 8): grey devices shaped by role, outlined by state, filled by
// reception (default), role or power source; by default each device's 3 best pairs as lines coloured by the pair's
// better rating, all pairs of the focus as two lanes with their values, all pairs in debug mode; labels as canvas
// text placed around obstacles.
// Also marker sizes and hit testing, which share the same geometry. Pure except for the context passed in.
// node --test tests/

import { displayLabels, labelsForAll, MAX_LABEL_WIDTH } from "./labels.js";
import { ratingColor, fillColor, powerCategory } from "./palette.js";
import { toScreen } from "./camera.js";

/** Marker sizes in layout units at zoom 1 (diameter or side) and their minimum on screen in CSS pixels (spec 8:
 *  markers keep a minimum size). Markers grow with zoom up to 1.5 times their size, so they never hide the lanes.
 *  Own choice. */
export const MARKERS = Object.freeze({
  coordinator: { size: 20, min: 12 },
  router: { size: 16, min: 10 },
  "end device": { size: 10, min: 7 },
  "border router": { size: 18, min: 12 },
  unknown: { size: 14, min: 9 },
});
/** The node diameter in L0 (spec 7.1): a router, the most common device. */
export const NODE_DIAMETER = MARKERS.router.size;
/** Hit areas are at least 24 CSS pixels across (spec 9.3, WCAG 2.2 2.5.8). */
export const MIN_HIT = 24;
/** Lines per device in the default view: its best pairs by rating (decision by Fabian Schwamborn, 2026-10-31). */
export const BEST_PAIRS = 3;
/** Distance of each lane from the pair's centre line, CSS pixels. */
const LANE_OFFSET = 3;
/** Rating steps for line colours: strokes are grouped by step, weak below strong. */
const COLOR_STEPS = 32;
const LINE_HEIGHT = 14;

export function markerRadius(role, k) {
  const m = MARKERS[role] || MARKERS.unknown;
  return Math.max(m.min / 2, Math.min((m.size / 2) * k, (m.size / 2) * 1.5));
}

export function hitRadius(role, k) {
  return Math.max(markerRadius(role, k) + 4, MIN_HIT / 2);
}

/** Text for a reading's value on a lane, raw LQI: "0 (uncertain)" for 0 (spec 3.1; the panel passes its translation),
 *  "?" for no value or no entry. */
export function valueText(lqi, uncertain = "0 (uncertain)") {
  if (lqi === 0) return uncertain;
  return typeof lqi === "number" && lqi > 0 ? String(lqi) : "?";
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Order of two readings of one direction or of a pair: higher rating first, then higher LQI; unknown last. */
const better = (r, s) => ((num(s.rating) ?? -1) - (num(r.rating) ?? -1)) || ((num(s.lqi) ?? -1) - (num(r.lqi) ?? -1));

/** Static part of the picture for one network: nodes with display labels, pairs with both readings, the pairs shown
 *  by default, neighbours. In a pair, ab is "a hears b" and ba "b hears a", each { lqi, rating } or undefined. */
export function buildScene(network, measure, maxLabelWidth = MAX_LABEL_WIDTH) {
  const seen = new Set();
  const devices = [];
  for (const d of network.devices || []) {
    if (!d || typeof d.id !== "string" || seen.has(d.id)) continue;
    seen.add(d.id);
    devices.push(d);
  }
  const labels = displayLabels(devices, measure, maxLabelWidth);
  const nodes = devices.map((d, i) => ({
    id: d.id,
    role: MARKERS[d.role] ? d.role : "unknown",
    label: labels[i],
    available: d.available !== false,
    rating: num(d.rating) === null ? null : Math.max(0, Math.min(1, d.rating)),
    power: powerCategory(d.powerSource),
  }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const byKey = new Map();
  const neighbours = nodes.map(() => new Set());
  for (const r of network.readings || []) {
    const rep = index.get(r && r.reporter);
    const sub = index.get(r && r.subject);
    if (rep === undefined || sub === undefined || rep === sub) continue;
    const a = Math.min(rep, sub);
    const b = Math.max(rep, sub);
    const key = a * nodes.length + b;
    if (!byKey.has(key)) byKey.set(key, { a, b, ab: undefined, ba: undefined });
    const pair = byKey.get(key);
    const reading = { lqi: num(r.lqi), rating: num(r.rating) };
    const side = rep === a ? "ab" : "ba";
    if (!pair[side] || better(reading, pair[side]) < 0) pair[side] = reading;
    neighbours[a].add(b);
    neighbours[b].add(a);
  }
  const pairs = [...byKey.keys()].sort((p, q) => p - q).map((key, i) => {
    const pair = byKey.get(key);
    const best = [pair.ab, pair.ba].filter(Boolean).sort(better)[0];
    return { ...pair, index: i, rating: best.rating, lqi: best.lqi, best: false };
  });
  // Default lines: each device's best pairs; a pair stays if it is among the best of either end.
  const perNode = nodes.map(() => []);
  for (const p of pairs) { perNode[p.a].push(p); perNode[p.b].push(p); }
  for (const list of perNode) {
    list.sort((p, q) => better(p, q) || p.index - q.index);
    for (const p of list.slice(0, BEST_PAIRS)) p.best = true;
  }
  return { nodes, index, pairs, neighbours, labels, bestCount: pairs.filter((p) => p.best).length };
}

/** Nearest device whose hit area contains (px, py), as a node index, or -1. sx, sy: screen positions. */
export function hitTest(scene, sx, sy, k, px, py) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < scene.nodes.length; i++) {
    const d = Math.hypot(sx[i] - px, sy[i] - py);
    if (d <= hitRadius(scene.nodes[i].role, k) && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

function shapePath(ctx, role, x, y, r) {
  ctx.beginPath();
  if (role === "coordinator") {
    ctx.rect(x - r, y - r, 2 * r, 2 * r);
  } else if (role === "border router") {
    const s = r * 1.25;
    ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

/** Text with a halo in the background colour, readable over lines. */
function haloText(ctx, text, x, y, theme) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.background;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = theme.foreground;
  ctx.fillText(text, x, y);
}

/** Rectangles on a coarse grid, so each label checks only what is near it (thousands of lane values in debug mode). */
class RectGrid {
  constructor(cell = 64) { this.cell = cell; this.cells = new Map(); }
  _keys(r, fn) {
    const c = this.cell;
    for (let gx = Math.floor(r.x / c); gx <= Math.floor((r.x + r.w) / c); gx++) {
      for (let gy = Math.floor(r.y / c); gy <= Math.floor((r.y + r.h) / c); gy++) fn(gx * 65536 + gy);
    }
  }
  add(r) {
    this._keys(r, (key) => {
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(r);
    });
  }
  hits(r) {
    let hit = false;
    this._keys(r, (key) => {
      if (hit) return;
      for (const q of this.cells.get(key) || []) {
        if (q.owner !== undefined && q.owner === r.owner) continue; // a label may touch its own marker
        if (r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h) { hit = true; return; }
      }
    });
    return hit;
  }
}

/** Draw one frame. view: { cam, width, height, dpr, labelZoom, debug, selected, hovered (node indices or -1),
 *  fps (number or null), fill ("reception" | "role" | "power", palette.js FILLS), uncertain (text for LQI 0) };
 *  pos: { x, y, pinned, mesh }
 *  arrays by node index; measure(text) for the label font.
 *  Returns what was drawn: { sx, sy, lines, lanes, labels, dropped }. */
export function drawScene(ctx, scene, pos, view, theme, measure) {
  const { cam, width, height, dpr } = view;
  const n = scene.nodes.length;
  const k = cam.k;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  for (let i = 0; i < n; i++) [sx[i], sy[i]] = toScreen(cam, pos.x[i], pos.y[i], width, height);
  const focus = [view.selected, view.hovered].filter((i, j, all) => i >= 0 && all.indexOf(i) === j);
  const focusSet = new Set(focus);
  const near = new Set(focus);
  for (const f of focus) for (const j of scene.neighbours[f]) near.add(j);
  const margin = 40;
  const onScreen = (i) => sx[i] > -margin && sx[i] < width + margin && sy[i] > -margin && sy[i] < height + margin;
  const segmentVisible = (a, b) =>
    !(Math.max(sx[a], sx[b]) < -margin || Math.min(sx[a], sx[b]) > width + margin ||
      Math.max(sy[a], sy[b]) < -margin || Math.min(sy[a], sy[b]) > height + margin);

  // Lines: unknown first, then by rating step from weak to strong, so the strong links lie on top; within a step in
  // pair order. One stroke per line: in Chromium's software rasterizer 2 259 lines took 12 ms stroked one by one
  // against 38 ms as one path per colour; GPU canvases are fast either way.
  const lines = [];
  const lanes = [];
  for (const pair of scene.pairs) {
    if (!segmentVisible(pair.a, pair.b)) continue;
    if (view.debug || focusSet.has(pair.a) || focusSet.has(pair.b)) lanes.push(pair);
    else if (pair.best) lines.push(pair);
  }
  const step = (p) => (p.rating === null ? -1 : Math.round(p.rating * (COLOR_STEPS - 1)));
  lines.sort((p, q) => step(p) - step(q) || p.index - q.index);
  ctx.lineCap = "butt";
  let current = null;
  for (const p of lines) {
    const s = step(p);
    if (s !== current) {
      current = s;
      const unknown = s < 0;
      ctx.setLineDash(unknown ? [4, 4] : []);
      ctx.lineWidth = unknown ? 1 : 1 + (s / (COLOR_STEPS - 1)) * 1.5;
      ctx.strokeStyle = unknown ? theme.muted : ratingColor(s / (COLOR_STEPS - 1), theme);
    }
    if (theme.lineRange.casing) {
      // A mid-grey background leaves no contrast-safe colours: give each line a casing in the outline colour.
      const style = ctx.strokeStyle;
      const width = ctx.lineWidth;
      ctx.strokeStyle = theme.outline;
      ctx.lineWidth = width + 2;
      ctx.beginPath(); ctx.moveTo(sx[p.a], sy[p.a]); ctx.lineTo(sx[p.b], sy[p.b]); ctx.stroke();
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
    }
    ctx.beginPath();
    ctx.moveTo(sx[p.a], sy[p.a]);
    ctx.lineTo(sx[p.b], sy[p.b]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Lanes: each reading "R hears S" travels from S to R and runs on the right of that direction (y points down, so
  // the right-hand normal of (ux, uy) is (-uy, ux)); coloured by its own rating, labelled with its raw LQI. Geometry
  // first, then strokes grouped by style: switching the dash pattern per lane cost more than the lanes themselves.
  const laneTexts = [];
  const laneGroups = new Map(); // colour or "" (unknown rating, dashed) -> lanes
  ctx.font = theme.font;
  for (const pair of lanes) {
    const focused = focusSet.has(pair.a) || focusSet.has(pair.b);
    const directions = [[pair.b, pair.a, pair.ab, pair.a], [pair.a, pair.b, pair.ba, pair.b]];
    for (const [from, to, reading, reporter] of directions) {
      const dx = sx[to] - sx[from];
      const dy = sy[to] - sy[from];
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      const ox = -uy * LANE_OFFSET;
      const oy = ux * LANE_OFFSET;
      const color = (reading && ratingColor(reading.rating, theme)) || "";
      if (!laneGroups.has(color)) laneGroups.set(color, []);
      laneGroups.get(color).push({ x0: sx[from] + ox, y0: sy[from] + oy, dx, dy, ux, uy, len });
      let text = valueText(reading ? reading.lqi : undefined, view.uncertain);
      if (view.debug) text += ` ← ${scene.nodes[reporter].label}`;
      const w = measure(text);
      if (len < w + 2 * markerRadius("router", k) + 12) continue; // no room on this lane: the details list it
      // At the middle, beside its own lane: the two values of a pair sit on opposite sides of the line.
      laneTexts.push({ text, x: sx[from] + dx * 0.5 + ox * 3.5, y: sy[from] + dy * 0.5 + oy * 3.5, w, focused });
    }
  }
  ctx.lineWidth = 2;
  const byStyle = [...laneGroups].sort((p, q) => (p[0] === "") - (q[0] === "") || (p[0] < q[0] ? -1 : 1));
  for (const [color, group] of byStyle) {
    ctx.setLineDash(color ? [] : [4, 4]);
    ctx.strokeStyle = color || theme.muted;
    ctx.fillStyle = color || theme.muted;
    for (const l of group) {
      ctx.beginPath();
      ctx.moveTo(l.x0, l.y0);
      ctx.lineTo(l.x0 + l.dx, l.y0 + l.dy);
      ctx.stroke();
    }
    // Arrowheads at 60 % of the way, pointing in the direction of travel, where the lane is long enough to show one.
    for (const l of group) {
      if (l.len < 24) continue;
      const ax = l.x0 + l.dx * 0.6;
      const ay = l.y0 + l.dy * 0.6;
      ctx.beginPath();
      ctx.moveTo(ax + l.ux * 4, ay + l.uy * 4);
      ctx.lineTo(ax - l.ux * 3 - l.uy * 3.5, ay - l.uy * 3 + l.ux * 3.5);
      ctx.lineTo(ax - l.ux * 3 + l.uy * 3.5, ay - l.uy * 3 - l.ux * 3.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.setLineDash([]);

  // Devices: plain ones first, the neighbourhood of the focus above them, the focus on top.
  const order = [];
  for (let i = 0; i < n; i++) if (!near.has(i)) order.push(i);
  for (const i of near) if (!focusSet.has(i)) order.push(i);
  for (const i of focus) order.push(i);
  const obstacles = new RectGrid();
  for (const i of order) {
    if (!onScreen(i)) continue;
    const node = scene.nodes[i];
    const r = markerRadius(node.role, k);
    const x = sx[i];
    const y = sy[i];
    obstacles.add({ x: x - r - 1, y: y - r - 1, w: 2 * r + 2, h: 2 * r + 2, owner: i });
    shapePath(ctx, node.role, x, y, r);
    // Offline devices are hollow; a background fill keeps lines from showing through.
    const fill = node.available ? fillColor(node, view.fill, theme) : null;
    ctx.fillStyle = node.available ? fill || theme.node : theme.background;
    ctx.fill();
    if (node.available && !fill) {
      // No value under this fill (not rated, no category): grey plus a slash, so colour is not the only sign.
      const q = r * 0.6;
      ctx.beginPath();
      ctx.moveTo(x - q, y + q);
      ctx.lineTo(x + q, y - q);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = theme.outline;
      ctx.stroke();
      shapePath(ctx, node.role, x, y, r); // the outline below strokes the marker again, not the slash
    }
    const unknown = !pos.mesh[i] || node.role === "unknown";
    ctx.setLineDash(unknown ? [3, 2] : []);
    ctx.lineWidth = focusSet.has(i) ? 2.5 : 1.5;
    ctx.strokeStyle = theme.outline;
    ctx.stroke();
    ctx.setLineDash([]);
    if (pos.pinned[i]) {
      // Pin mark: a short needle from the upper right of the marker with a round head.
      const px = x + r * 0.7;
      const py = y - r * 0.7;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 5, py - 5);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = theme.foreground;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px + 6, py - 6, 3, 0, 2 * Math.PI);
      ctx.fillStyle = theme.foreground;
      ctx.fill();
    }
    if (i === view.selected || i === view.hovered) {
      shapePath(ctx, node.role, x, y, r + 4);
      ctx.lineWidth = i === view.selected ? 2.5 : 1.5;
      ctx.setLineDash(i === view.selected ? [] : [3, 3]);
      ctx.strokeStyle = theme.accent;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Text, in order of importance. A label tries below, above, right and left of its device and is left out if all
  // four would cover another device or text already placed (the details list everything); the coordinator and the
  // focus are always labelled, below if nothing else is free. Order: coordinator and focus, neighbours of the
  // focus, values on the focus's lanes, everyone else from LABEL_SCALE up, values on other lanes (debug).
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const placed = obstacles; // labels become obstacles for later labels
  let shown = 0;
  let dropped = 0;
  const label = (i, forced) => {
    if (!onScreen(i)) return;
    const node = scene.nodes[i];
    const w = measure(node.label) + 4;
    const r = markerRadius(node.role, k);
    const h = LINE_HEIGHT;
    const spots = [
      [sx[i], sy[i] + r + 3 + h / 2], [sx[i], sy[i] - r - 3 - h / 2],
      [sx[i] + r + 4 + w / 2, sy[i]], [sx[i] - r - 4 - w / 2, sy[i]],
    ];
    let spot = null;
    for (const [cx, cy] of spots) {
      if (!placed.hits({ x: cx - w / 2, y: cy - h / 2, w, h, owner: i })) { spot = [cx, cy]; break; }
    }
    if (!spot && !forced) { dropped++; return; }
    if (!spot) spot = spots[0];
    placed.add({ x: spot[0] - w / 2, y: spot[1] - h / 2, w, h });
    haloText(ctx, node.label, spot[0], spot[1], theme);
    shown++;
  };
  const value = (t) => {
    const rect = { x: t.x - t.w / 2 - 2, y: t.y - LINE_HEIGHT / 2, w: t.w + 4, h: LINE_HEIGHT };
    if (placed.hits(rect)) return;
    placed.add(rect);
    haloText(ctx, t.text, t.x, t.y, theme);
  };
  const always = [];
  for (let i = 0; i < n; i++) if (scene.nodes[i].role === "coordinator" && !focusSet.has(i)) always.push(i);
  for (const i of [...focus, ...always]) label(i, true);
  for (const i of near) if (!focusSet.has(i) && !always.includes(i)) label(i, false);
  for (const t of laneTexts) if (t.focused) value(t);
  if (labelsForAll(k, view.labelZoom)) {
    const rank = { coordinator: 0, "border router": 1, router: 2, unknown: 3, "end device": 4 };
    const rest = [];
    for (let i = 0; i < n; i++) if (!near.has(i) && !always.includes(i)) rest.push(i);
    rest.sort((a, b) => rank[scene.nodes[a].role] - rank[scene.nodes[b].role] || a - b);
    for (const i of rest) label(i, false);
  }
  for (const t of laneTexts) if (!t.focused) value(t);

  if (view.debug && typeof view.fps === "number") {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    haloText(ctx, `${Math.round(view.fps)} fps`, 8, 8, theme);
  }
  return { sx, sy, lines: lines.length, lanes: lanes.length, labels: shown, dropped };
}
