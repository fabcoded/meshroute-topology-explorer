// SPDX-License-Identifier: MIT
// Canvas 2D drawing of the quality view (spec 7.1, 8): devices as symbols (symbols.js: role, picture, state) whose
// background carries the fill, reception (default), role or power source; links as two lanes per pair in three
// colour-free classes (links.js):
// up-path and route pairs always, heard-only pairs as each device's best three, everything for the focus and in
// debug mode; the selection's up path as a band, its lanes with their values; labels as canvas text placed around
// obstacles. Also hit testing, which shares the symbols' size. Pure except for the context passed in.
// node --test tests/

import { displayLabels, labelsForAll, MAX_LABEL_WIDTH } from "./labels.js";
import { fillColor, lineColorOn, powerCategory } from "./palette.js";
import { toScreen } from "./camera.js";
import {
  BAND, BEST_HEARD, CLASSES, DIM, LANE_OFFSET, classifyPairs, laneGeometry, laneStyle, textBeside, unknownGlyph,
} from "./links.js";
import { SYMBOL_SIZE, drawSymbol, symbolLayers, symbolParts, symbolSize } from "./symbols.js";

/** Roles the map knows (spec 4.2); anything else is drawn as unknown. */
const ROLES = new Set(["coordinator", "router", "end device", "border router", "unknown"]);
/** The node diameter in L0 (spec 7.1): every device has the same symbol size. */
export const NODE_DIAMETER = SYMBOL_SIZE;
/** Hit areas are at least 24 CSS pixels across (spec 9.3, WCAG 2.2 2.5.8). */
export const MIN_HIT = 24;
const LINE_HEIGHT = 14;

/** Hit radius at zoom k: the symbol and 4 px around it (this covers its rounded corners), at least MIN_HIT across. */
export function hitRadius(k) {
  return Math.max(symbolSize(k) / 2 + 4, MIN_HIT / 2);
}

/** Text for a reading's value on a lane, raw LQI: "0 (uncertain)" for 0 (spec 3.1; the panel passes its translation),
 *  "?" for no value or no entry. */
export function valueText(lqi, uncertain = "0 (uncertain)") {
  if (lqi === 0) return uncertain;
  return typeof lqi === "number" && lqi > 0 ? String(lqi) : "?";
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Order of two pairs for the default view: higher rating first, then higher LQI; unknown last. */
const better = (r, s) => ((num(s.rating) ?? -1) - (num(r.rating) ?? -1)) || ((num(s.lqi) ?? -1) - (num(r.lqi) ?? -1));

/** Static part of the picture for one network: nodes with display labels; pairs with their evidence per direction
 *  (ab: a hears b, ba: b hears a; { state, lqi, rating, source, reason } from the data model), class and whether the
 *  default view shows them; every device's up path as node indices; neighbours. */
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
    role: ROLES.has(d.role) ? d.role : "unknown",
    parts: symbolParts({ ...d, role: ROLES.has(d.role) ? d.role : "unknown" }),
    label: labels[i],
    available: d.available !== false,
    rating: num(d.rating) === null ? null : Math.max(0, Math.min(1, d.rating)),
    power: powerCategory(d.powerSource),
  }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const neighbours = nodes.map(() => new Set());
  const { pairs: classed, upPaths } = classifyPairs({ ...network, devices });
  const pairs = [];
  for (const p of classed) {
    const a = index.get(p.a);
    const b = index.get(p.b);
    if (a === undefined || b === undefined || a === b) continue;
    const measured = [p.ab, p.ba].filter((d) => d && d.state === "measured").sort(better)[0] || {};
    pairs.push({ a, b, ab: p.ab, ba: p.ba, cls: p.cls, index: pairs.length, rating: num(measured.rating),
      lqi: num(measured.lqi), shown: p.cls !== "heard" });
    neighbours[a].add(b);
    neighbours[b].add(a);
  }
  // Heard-only pairs by default: each device's best ones; a pair stays if it is among the best of either end.
  const perNode = nodes.map(() => []);
  for (const p of pairs) if (p.cls === "heard") { perNode[p.a].push(p); perNode[p.b].push(p); }
  for (const list of perNode) {
    list.sort((p, q) => better(p, q) || p.index - q.index);
    for (const p of list.slice(0, BEST_HEARD)) p.shown = true;
  }
  const paths = nodes.map((n) => (upPaths.get(n.id) || []).map((id) => index.get(id)).filter((i) => i !== undefined));
  const classes = Object.fromEntries(CLASSES.map((c) => [c, pairs.filter((p) => p.cls === c).length]));
  return { nodes, index, pairs, neighbours, labels, upPaths: paths, classes,
    shownCount: pairs.filter((p) => p.shown).length };
}

/** Nearest device whose hit area contains (px, py), as a node index, or -1. sx, sy: screen positions. */
export function hitTest(scene, sx, sy, k, px, py) {
  let best = -1;
  let bestD = Infinity;
  const reach = hitRadius(k);
  for (let i = 0; i < scene.nodes.length; i++) {
    const d = Math.hypot(sx[i] - px, sy[i] - py);
    if (d <= reach && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/** Text with a halo in the background colour, readable over lines. */
function haloText(ctx, text, x, y, theme, color = theme.foreground) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.background;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** One lane (links.js laneGeometry) with the current stroke style; with a head, the stroke stops at the head's base
 *  and a filled triangle points at the hearer. */
function drawLane(ctx, lane, style) {
  const headLen = 4 + style.width * 1.5;
  const head = style.head && lane.len > headLen + 2;
  const end = head ? lane.len - headLen : lane.len;
  ctx.beginPath();
  ctx.moveTo(lane.x0, lane.y0);
  ctx.lineTo(lane.x0 + lane.ux * end, lane.y0 + lane.uy * end);
  ctx.stroke();
  if (!head) return;
  const half = 2 + style.width * 0.75;
  const bx = lane.x1 - lane.ux * headLen;
  const by = lane.y1 - lane.uy * headLen;
  ctx.beginPath();
  ctx.moveTo(lane.x1, lane.y1);
  ctx.lineTo(bx + lane.nx * half, by + lane.ny * half);
  ctx.lineTo(bx - lane.nx * half, by - lane.ny * half);
  ctx.closePath();
  ctx.fill();
}

/** The selected device's up path as a wide translucent band through its hops (spec 7.1), under its lanes. */
function drawBand(ctx, path, sx, sy, theme) {
  if (!path || path.length < 2) return;
  ctx.globalAlpha = BAND.alpha;
  ctx.setLineDash([]);
  ctx.lineWidth = BAND.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = theme.foreground;
  ctx.beginPath();
  ctx.moveTo(sx[path[0]], sy[path[0]]);
  for (const i of path.slice(1)) ctx.lineTo(sx[i], sy[i]);
  ctx.stroke();
  ctx.lineJoin = "miter";
  ctx.globalAlpha = 1;
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
        if (q.owner !== undefined && q.owner === r.owner) continue; // a label may touch its own symbol
        if (r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h) { hit = true; return; }
      }
    });
    return hit;
  }
}

/** Draw one frame. view: { cam, width, height, dpr, labelZoom, debug, selected, hovered (node indices or -1),
 *  fps (number or null), fill ("reception" | "role" | "power", palette.js FILLS), texts ({ uncertain, parent, route },
 *  words drawn on lanes) }; pos: { x, y, pinned, mesh } arrays by node index; measure(text) for the label font.
 *  Returns what was drawn: { sx, sy, lines (pairs), lanes, glyphs, values, labels, dropped, classes (pairs per
 *  class), order (class of each pair in drawing order), symbols (devices drawn), size (symbol size on screen) }. */
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

  // Links: each direction "R hears S" is a lane from S to R on the right of its travel, styled by the pair's class
  // and its own rating; a direction without a reading gets a glyph instead. While something is in focus, the pairs
  // that do not touch it are drawn first and dimmed, then the selection's up path as a band, then the focus's pairs.
  // Within a layer: heard only, other route, up path, so the links that carry traffic lie on top.
  const size = symbolSize(k);
  const offset = Math.max(1, (LANE_OFFSET * size) / SYMBOL_SIZE);
  const touches = (p) => focusSet.has(p.a) || focusSet.has(p.b);
  const drawn = scene.pairs.filter((p) => segmentVisible(p.a, p.b) && (view.debug || p.shown || touches(p)));
  const dimming = focus.length > 0;
  const layers = dimming ? [drawn.filter((p) => !touches(p)), drawn.filter(touches)] : [drawn];
  const texts = { uncertain: "0 (uncertain)", parent: "Parent", route: "Route", ...(view.texts || {}) };
  const laneTexts = [];
  const glyphs = [];
  const order = [];
  let lanes = 0;
  ctx.font = theme.font;
  layers.forEach((layer, li) => {
    const alpha = dimming && li === 0 ? DIM : 1;
    if (li === 1 && view.selected >= 0) drawBand(ctx, scene.upPaths[view.selected], sx, sy, theme);
    for (const cls of CLASSES) {
      const items = [];
      for (const pair of layer) {
        if (pair.cls !== cls) continue;
        order.push(cls);
        const withValues = view.debug || touches(pair);
        const directions = [[pair.b, pair.a, pair.ab, pair.a], [pair.a, pair.b, pair.ba, pair.b]];
        for (const [from, to, dir, reporter] of directions) {
          const lane = laneGeometry(sx[from], sy[from], sx[to], sy[to], size, size, offset);
          if (!lane) continue;
          const state = dir && (dir.state === "measured" || dir.state === "implied") ? dir.state : "unknown";
          if (state === "unknown") {
            glyphs.push({ text: unknownGlyph(dir && dir.reason), x: lane.mx, y: lane.my, alpha });
            continue;
          }
          const style = laneStyle(cls, state, dir.rating, theme);
          items.push({ lane, style, key: `${style.color}|${style.width}|${style.dash.join(",")}|${style.head}` });
          if (!withValues) continue;
          let text = state === "implied" ? (dir.source === "parent" ? texts.parent : texts.route)
            : valueText(dir.lqi, texts.uncertain);
          if (view.debug && state === "measured") text += ` \u2190 ${scene.nodes[reporter].label}`;
          const w = measure(text);
          if (lane.len < w * Math.abs(lane.ux) + 12) continue; // no room beside this lane: the details list it
          const [tx, ty] = textBeside(lane, w + 4, LINE_HEIGHT, 1);
          laneTexts.push({ text, x: tx, y: ty, w, focused: touches(pair), alpha });
        }
      }
      // Grouped by style so the dash pattern changes once per group, not per lane.
      items.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
      ctx.globalAlpha = alpha;
      let current = null;
      for (const { lane, style, key } of items) {
        if (key !== current) {
          current = key;
          ctx.setLineDash(style.dash);
          ctx.lineCap = style.cap;
          ctx.lineWidth = style.width;
          ctx.strokeStyle = style.color;
          ctx.fillStyle = style.color;
        }
        drawLane(ctx, lane, style);
        lanes++;
      }
    }
  });
  ctx.setLineDash([]);
  ctx.lineCap = "butt";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const g of glyphs) {
    ctx.globalAlpha = g.alpha;
    haloText(ctx, g.text, g.x, g.y, theme, theme.muted);
  }
  ctx.globalAlpha = 1;

  // Devices: plain ones first, the neighbourhood of the focus above them, the focus on top.
  const nodeOrder = [];
  for (let i = 0; i < n; i++) if (!near.has(i)) nodeOrder.push(i);
  for (const i of near) if (!focusSet.has(i)) nodeOrder.push(i);
  for (const i of focus) nodeOrder.push(i);
  // Everything about a device stays inside its symbol (spec 8): offline is no fill (the background keeps lines from
  // showing through), the selection a thicker frame, a pin a mark inside. Hover changes only the highlighting.
  const obstacles = new RectGrid();
  const half = size / 2;
  const lineColors = new Map(); // per fill colour: the reception fill has few distinct colours per frame
  const lineOn = (fill) => {
    if (!lineColors.has(fill)) lineColors.set(fill, lineColorOn(fill, theme));
    return lineColors.get(fill);
  };
  let symbols = 0;
  for (const i of nodeOrder) {
    if (!onScreen(i)) continue;
    const node = scene.nodes[i];
    const x = sx[i];
    const y = sy[i];
    ctx.globalAlpha = dimming && !near.has(i) ? DIM : 1;
    obstacles.add({ x: x - half - 1, y: y - half - 1, w: size + 2, h: size + 2, owner: i });
    const value = node.available ? fillColor(node, view.fill, theme) : null;
    const fill = node.available ? value || theme.node : theme.background;
    const layers = symbolLayers(node.parts, { selected: i === view.selected, pinned: Boolean(pos.pinned[i]) });
    // No value under this fill (not rated, no category): grey plus a slash, so colour is not the only sign.
    drawSymbol(ctx, layers, x, y, size, dpr, { fill, stroke: lineOn(fill), slash: node.available && !value });
    symbols++;
  }

  // Text, in order of importance. A label tries below, above, right and left of its device and is left out if all
  // four would cover another device or text already placed (the details list everything); the coordinator and the
  // focus are always labelled, below if nothing else is free. Order: coordinator and focus, neighbours of the
  // focus, values on the focus's lanes, everyone else from LABEL_SCALE up, values on other lanes (debug).
  ctx.globalAlpha = 1;
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const placed = obstacles; // labels become obstacles for later labels
  let values = 0;
  let shown = 0;
  let dropped = 0;
  const label = (i, forced) => {
    if (!onScreen(i)) return;
    const node = scene.nodes[i];
    const w = measure(node.label) + 4;
    const r = half;
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
    ctx.globalAlpha = dimming && !near.has(i) ? DIM : 1;
    haloText(ctx, node.label, spot[0], spot[1], theme);
    ctx.globalAlpha = 1;
    shown++;
  };
  const value = (t) => {
    const rect = { x: t.x - t.w / 2 - 2, y: t.y - LINE_HEIGHT / 2, w: t.w + 4, h: LINE_HEIGHT };
    if (placed.hits(rect)) return;
    placed.add(rect);
    ctx.globalAlpha = t.alpha;
    haloText(ctx, t.text, t.x, t.y, theme);
    ctx.globalAlpha = 1;
    values++;
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
  const classes = Object.fromEntries(CLASSES.map((c) => [c, drawn.filter((p) => p.cls === c).length]));
  return { sx, sy, lines: drawn.length, lanes, glyphs: glyphs.length, values, labels: shown, dropped, classes, order,
    symbols, size };
}
