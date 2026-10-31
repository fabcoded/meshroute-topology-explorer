// SPDX-License-Identifier: MIT
// Canvas 2D drawing of the quality view (spec 7.1, 8): grey devices shaped by role, outlined by state, filled by
// reception (cividis); one line per pair coloured by the better reading; two lanes with values for the focus and in
// debug mode; labels as canvas text. Also marker sizes and hit testing, which share the same geometry.
// Pure except for the context passed in; no Home Assistant objects.  node --test tests/

import { displayLabels, labelsForAll, MAX_LABEL_WIDTH } from "./labels.js";
import { lqiColor, ratingColor } from "./palette.js";
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
/** Distance of each lane from the pair's centre line, CSS pixels. */
const LANE_OFFSET = 3;
/** Line colours are bucketed so thousands of lines cost a few dozen strokes. */
const COLOR_BUCKETS = 32;
/** Opacity of lines outside the selection while something is selected or hovered. */
const FADED = 0.25;

export function markerRadius(role, k) {
  const m = MARKERS[role] || MARKERS.unknown;
  return Math.max(m.min / 2, Math.min((m.size / 2) * k, (m.size / 2) * 1.5));
}

export function hitRadius(role, k) {
  return Math.max(markerRadius(role, k) + 4, MIN_HIT / 2);
}

/** Text for a reading's value on a lane: "0 (uncertain)" for LQI 0 (spec 3.1), "?" for no value or no entry. */
export function valueText(lqi) {
  if (lqi === 0) return "0 (uncertain)";
  return typeof lqi === "number" && lqi > 0 ? String(lqi) : "?";
}

/** Static part of the picture for one network: nodes with display labels, pairs with both readings, neighbours.
 *  lqi in a pair is a number, 0, null (reading without a value) or undefined (no reading in that direction). */
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
    rating: typeof d.rating === "number" && Number.isFinite(d.rating) ? Math.max(0, Math.min(1, d.rating)) : null,
  }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const pairs = new Map();
  const neighbours = nodes.map(() => new Set());
  const better = (a, b) => (b === undefined ? a : a === undefined ? b : (b || 0) > (a || 0) ? b : a);
  for (const r of network.readings || []) {
    const rep = index.get(r && r.reporter);
    const sub = index.get(r && r.subject);
    if (rep === undefined || sub === undefined || rep === sub) continue;
    const a = Math.min(rep, sub);
    const b = Math.max(rep, sub);
    const key = a * nodes.length + b;
    if (!pairs.has(key)) pairs.set(key, { a, b, ab: undefined, ba: undefined });
    const pair = pairs.get(key);
    const lqi = typeof r.lqi === "number" && Number.isFinite(r.lqi) ? r.lqi : null;
    // ab: a hears b (a reported it); ba: b hears a.
    if (rep === a) pair.ab = better(pair.ab, lqi); else pair.ba = better(pair.ba, lqi);
    neighbours[a].add(b);
    neighbours[b].add(a);
  }
  return { nodes, index, pairs: [...pairs.values()], neighbours, labels };
}

/** The better of a pair's two readings for its single line; null if neither has a usable value. */
export function pairValue(pair) {
  const v = [pair.ab, pair.ba].filter((x) => typeof x === "number" && x > 0);
  return v.length ? Math.max(...v) : null;
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

function overlaps(r, placed) {
  for (const q of placed) {
    if (r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h) return true;
  }
  return false;
}

/** Draw one frame. view: { cam, width, height, dpr, density, debug, selected, hovered (node indices or -1),
 *  fps (number or null) }; pos: { x, y, pinned, mesh } arrays by node index; measure(text) for the label font. */
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
  const focus = [view.selected, view.hovered].filter((i) => i >= 0);
  const focusSet = new Set(focus);
  const near = new Set(focus);
  for (const f of focus) for (const j of scene.neighbours[f]) near.add(j);
  const margin = 40;
  const onScreen = (i) => sx[i] > -margin && sx[i] < width + margin && sy[i] > -margin && sy[i] < height + margin;
  const segmentVisible = (a, b) =>
    !(Math.max(sx[a], sx[b]) < -margin || Math.min(sx[a], sx[b]) > width + margin ||
      Math.max(sy[a], sy[b]) < -margin || Math.min(sy[a], sy[b]) > height + margin);

  // Single lines, bucketed by colour; lanes are collected for later.
  const buckets = new Map();
  const lanes = [];
  for (const pair of scene.pairs) {
    if (!segmentVisible(pair.a, pair.b)) continue;
    if (view.debug || focusSet.has(pair.a) || focusSet.has(pair.b)) { lanes.push(pair); continue; }
    const v = pairValue(pair);
    const bucket = v === null ? -1 : Math.round((v / 255) * (COLOR_BUCKETS - 1));
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(pair);
  }
  // One stroke per line, styles set once per bucket: measured in Chromium's software rasterizer, 2 259 lines took
  // 12 ms stroked one by one against 38 ms as one path per colour (overlap handling of large paths); GPU canvases
  // are fast either way.
  ctx.lineCap = "butt";
  ctx.globalAlpha = focus.length ? FADED : 1;
  const strokeEach = (list) => {
    for (const p of list) {
      ctx.beginPath();
      ctx.moveTo(sx[p.a], sy[p.a]);
      ctx.lineTo(sx[p.b], sy[p.b]);
      ctx.stroke();
    }
  };
  for (const [bucket, list] of buckets) {
    const unknown = bucket < 0;
    const value = unknown ? null : Math.max(1, (bucket / (COLOR_BUCKETS - 1)) * 255);
    if (theme.lineRange.casing) {
      ctx.setLineDash([]);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = theme.outline;
      strokeEach(list);
    }
    ctx.setLineDash(unknown ? [4, 4] : []);
    ctx.lineWidth = unknown ? 1 : 1 + (value / 255) * 1.5;
    ctx.strokeStyle = unknown ? theme.muted : lqiColor(value, theme);
    strokeEach(list);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Lanes: each reading "R hears S" travels from S to R and runs on the right of that direction (y points down,
  // so the right-hand normal of (ux, uy) is (-uy, ux)). Geometry first, then strokes grouped by style: switching
  // the dash pattern per lane cost more than the lanes themselves (debug mode, 300 devices).
  const laneTexts = [];
  const laneGroups = new Map(); // colour or "" (unknown, dashed) -> lanes
  ctx.font = theme.font;
  for (const pair of lanes) {
    const focused = focusSet.has(pair.a) || focusSet.has(pair.b);
    for (const [from, to, lqi, reporter] of [[pair.b, pair.a, pair.ab, pair.a], [pair.a, pair.b, pair.ba, pair.b]]) {
      const dx = sx[to] - sx[from];
      const dy = sy[to] - sy[from];
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      const ox = -uy * LANE_OFFSET;
      const oy = ux * LANE_OFFSET;
      const color = lqiColor(lqi, theme) || "";
      if (!laneGroups.has(color)) laneGroups.set(color, []);
      laneGroups.get(color).push({ x0: sx[from] + ox, y0: sy[from] + oy, dx, dy, ux, uy, len });
      let text = valueText(lqi);
      if (view.debug) text += ` \u2190 ${scene.nodes[reporter].label}`;
      const w = measure(text);
      if (len < w + 2 * markerRadius("router", k) + 12) continue; // no room on this lane: the details list it
      // At the middle, beside its own lane: the two values of a pair sit on opposite sides of the line.
      laneTexts.push({ text, x: sx[from] + dx * 0.5 + ox * 3.5, y: sy[from] + dy * 0.5 + oy * 3.5, w, focused });
    }
  }
  ctx.lineWidth = 2;
  for (const [color, group] of [...laneGroups].sort((a, b) => (a[0] === "") - (b[0] === ""))) {
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
  for (const i of order) {
    if (!onScreen(i)) continue;
    const node = scene.nodes[i];
    const r = markerRadius(node.role, k);
    const x = sx[i];
    const y = sy[i];
    shapePath(ctx, node.role, x, y, r);
    // Offline devices are hollow; a background fill keeps lines from showing through.
    ctx.fillStyle = node.available ? ratingColor(node.rating) || theme.node : theme.background;
    ctx.fill();
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

  // Text, in order of importance; anything that would overlap text already placed is left out (the details list
  // every value): labels of the focus (always), of its neighbours, values on the focus's lanes, other labels above
  // the zoom threshold, values on the remaining lanes in debug mode. Overlapping labels could not be read anyway.
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = 14;
  const placed = [];
  const label = (i, forced) => {
    if (!onScreen(i)) return;
    const node = scene.nodes[i];
    const w = measure(node.label);
    const mid = sy[i] + markerRadius(node.role, k) + 3 + lineHeight / 2;
    const rect = { x: sx[i] - w / 2 - 2, y: mid - lineHeight / 2, w: w + 4, h: lineHeight };
    if (!forced && overlaps(rect, placed)) return;
    placed.push(rect);
    haloText(ctx, node.label, sx[i], mid, theme);
  };
  const value = (t) => {
    const rect = { x: t.x - t.w / 2 - 2, y: t.y - lineHeight / 2, w: t.w + 4, h: lineHeight };
    if (overlaps(rect, placed)) return;
    placed.push(rect);
    haloText(ctx, t.text, t.x, t.y, theme);
  };
  for (const i of focus) label(i, true);
  for (const i of near) if (!focusSet.has(i)) label(i, false);
  for (const t of laneTexts) if (t.focused) value(t);
  if (labelsForAll(k, view.density)) {
    const rank = { coordinator: 0, "border router": 1, router: 2, unknown: 3, "end device": 4 };
    const rest = [];
    for (let i = 0; i < n; i++) if (!near.has(i)) rest.push(i);
    rest.sort((a, b) => rank[scene.nodes[a].role] - rank[scene.nodes[b].role] || a - b);
    for (const i of rest) label(i, false);
  }
  for (const t of laneTexts) if (!t.focused) value(t);

  if (view.debug && typeof view.fps === "number") {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    haloText(ctx, `${Math.round(view.fps)} fps`, 8, 8, theme);
  }
  return { sx, sy };
}
