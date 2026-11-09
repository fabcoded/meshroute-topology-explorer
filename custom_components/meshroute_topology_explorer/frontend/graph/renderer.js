// SPDX-License-Identifier: MIT
// Canvas 2D drawing of the quality view (spec 7.1, 8): devices as symbols (symbols.js: role, picture, state) whose
// background carries the fill, none (default), role or power source; links as two lanes per pair, each in the look
// its network engine gives it (engines/<type>/scene.js overview and focus; graph/links.js laneStyle), optionally
// coloured by reception. The overview's lanes form a layer of their own, dimmed while something is in focus; a
// selected device shows only its focus (its lanes with the reception at every hearer, a band under its way where the
// engine gives one, unknown ends as dashed stems with "?"; lanes, glyphs and stems above the symbols, the band under
// them) and dims the other devices; the device under the pointer previews its focus within the overview; debug mode
// draws every lane with its value. Labels as canvas text placed
// around obstacles: a block of the device's type above the symbol, its readable name below and optionally the original
// Home Assistant name under that (labels.js). Also hit testing, which shares the symbols' size. What a lane means is
// the engine's; this module only indexes, draws and places. Pure except for the context passed in.
// npm test

import { DEFAULT_LABELS, displayLabels, haLabels, labelLines, labelsForAll, MAX_LABEL_WIDTH } from "./labels.js";
import { fillColor, lineColorOn, powerCategory } from "./palette.js";
import { toScreen } from "./camera.js";
import { BAND, DIM, LANE_OFFSET, STEM, VALUE, laneGeometry, laneStyle, pillCentre, pillDistances, pillSize,
  stemGeometry } from "./links.js";
import { engineFor } from "../engines/index.js";
import { ROLES, SYMBOL_SIZE, drawSymbol, symbolLayers, symbolParts, symbolSize } from "./symbols.js";

/** The node diameter in L0 (spec 7.1): every device has the same symbol size. */
export const NODE_DIAMETER = SYMBOL_SIZE;
/** Hit areas are at least 24 CSS pixels across (spec 9.3, WCAG 2.2 2.5.8). */
export const MIN_HIT = 24;
const LINE_HEIGHT = 14;
/** The original Home Assistant name is a smaller line: 10 px in a 12 px
 *  label font, scaled by this share; its line is a little lower too. Own choice. */
const SMALL_SHARE = 10 / 12;
const SMALL_LINE_HEIGHT = 12;
/** Opacity of the plate under a focus device's label. */
const PLATE_ALPHA = 0.85;

/** Screen length (CSS px) of the shortest focus lane of device `index` at camera `cam`, as drawn by drawScene: the
 *  hops of the engine's focus with `index` selected (engines/<type>/scene.js focus; view: the graph view, whose
 *  engineView overlays the engine's default settings), through laneGeometry; a hop the symbols leave no room for (laneGeometry
 *  null) counts as 0. Infinity without hops. Used by the graph view to zoom on a tap when the paths are too short to
 *  read (spec 9.3). */
export function shortestFocusLane(view, index, cam) {
  const { scene, pos, width, height } = view;
  if (!scene.engine) return Infinity;
  const settings = { ...scene.engine.settings.defaults, ...view.engineView };
  const focus = scene.engine.scene.focus(scene, index, { ...settings, debug: view.debug, selected: index });
  const size = symbolSize(cam.k);
  const offset = Math.max(1, (LANE_OFFSET * size) / SYMBOL_SIZE);
  let shortest = Infinity;
  for (const hop of focus.hops) {
    const [x1, y1] = toScreen(cam, pos.x[hop.s], pos.y[hop.s], width, height);
    const [x2, y2] = toScreen(cam, pos.x[hop.h], pos.y[hop.h], width, height);
    const lane = laneGeometry(x1, y1, x2, y2, size, size, offset);
    shortest = Math.min(shortest, lane ? lane.len : 0);
  }
  return shortest;
}

/** Hit radius at zoom k: the symbol and 4 px around it (this covers its rounded corners), at least MIN_HIT across. */
export function hitRadius(k) {
  return Math.max(symbolSize(k) / 2 + 4, MIN_HIT / 2);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Shortened readable and Home Assistant names of the devices. labelChars (spec 8) set: names are cut by character
 *  count (that many at most, the ellipsis included); null: by width in pixels (dense maps). */
function shortNames(devices, measure, maxLabelWidth, labelChars) {
  if (labelChars) {
    const count = (text) => text.length;
    return { labels: displayLabels(devices, count, labelChars), ha: haLabels(devices, count, labelChars) };
  }
  // The Home Assistant name is drawn in the smaller font.
  return { labels: displayLabels(devices, measure, maxLabelWidth),
    ha: haLabels(devices, (text) => measure(text) * SMALL_SHARE, maxLabelWidth) };
}

/** Shorten the names of an existing scene again, in place (the density changed between pixel and character rule). */
export function relabelScene(scene, measure, maxLabelWidth, labelChars) {
  const { labels, ha } = shortNames(scene.network.devices, measure, maxLabelWidth, labelChars);
  scene.nodes.forEach((n, i) => { n.label = labels[i]; n.haLabel = ha[i]; scene.labels[i] = labels[i]; });
}

/** Static part of the picture for one network: nodes with display labels (readable name, Home Assistant name, kind
 *  for the type line); pairs with their evidence per direction (ab: a hears b, ba: b hears a; { state, lqi, rating,
 *  source, reason } from the data model) and their two lanes; lanes { s, h (node indices of sender and hearer), pair,
 *  dir (the hearer's evidence), key "s>h", index, and the engine's meaning of the lane (engines/<type>/scene.js
 *  lanes) }; neighbours; network (the devices deduplicated); engine: the network's viewer engine (engines/index.js;
 *  null for a network without devices, which has nothing to mean), which adds its own fields once (classify). */
export function buildScene(network, measure, maxLabelWidth = MAX_LABEL_WIDTH, labelChars = null) {
  // No default engine (spec 4.6): a network with devices names its engine or this throws.
  const engine = !(network.devices || []).length && network.engine === undefined ? null : engineFor(network);
  const seen = new Set();
  const devices = [];
  for (const d of network.devices || []) {
    if (!d || typeof d.id !== "string" || seen.has(d.id)) continue;
    seen.add(d.id);
    devices.push(d);
  }
  const { labels, ha } = shortNames(devices, measure, maxLabelWidth, labelChars);
  const nodes = devices.map((d, i) => {
    const role = ROLES.includes(d.role) ? d.role : "unknown";
    const parts = symbolParts({ ...d, role });
    return {
      id: d.id,
      role,
      parts,
      label: labels[i],
      haLabel: ha[i],
      kind: parts.picture && parts.picture !== "unknown" ? parts.picture : null,
      available: d.available !== false,
      rating: num(d.rating) === null ? null : Math.max(0, Math.min(1, d.rating)),
      power: powerCategory(d.powerSource),
    };
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const neighbours = nodes.map(() => new Set());
  const net = { ...network, devices };
  const base = engine ? engine.scene.lanes(net) : { pairs: [], lanes: [], extra: null };
  const pairs = [];
  const pairAt = new Map(); // index in base.pairs -> index in pairs
  base.pairs.forEach((p, k) => {
    const a = index.get(p.a);
    const b = index.get(p.b);
    if (a === undefined || b === undefined || a === b) return;
    pairAt.set(k, pairs.length);
    pairs.push({ a, b, ab: p.ab, ba: p.ba, index: pairs.length, lanes: [] });
    neighbours[a].add(b);
    neighbours[b].add(a);
  });
  const lanes = [];
  const laneByKey = new Map();
  for (const l of base.lanes) {
    const pair = pairAt.get(l.pair);
    if (pair === undefined) continue;
    const s = index.get(l.sender);
    const h = index.get(l.hearer);
    const lane = { s, h, pair, dir: l.dir, ...l.meaning, key: `${s}>${h}`, index: lanes.length };
    pairs[pair].lanes.push(lane.index);
    laneByKey.set(lane.key, lane);
    lanes.push(lane);
  }
  const scene = { engine, network: net, nodes, index, pairs, lanes, laneByKey, neighbours, labels };
  if (engine) engine.scene.classify(scene, base.extra);
  return scene;
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

/** The pill under (px, py), else null: a hit anywhere inside the pill counts, and within at least PILL_HIT (24 px) around
 *  its centre, so a small pill is easy to hit. The nearest centre wins where areas overlap. */
export const PILL_HIT = 24;
export function pillAt(pills, px, py) {
  let best = null;
  let bestD = Infinity;
  for (const p of pills || []) {
    const dx = Math.abs(px - p.x);
    const dy = Math.abs(py - p.y);
    if (dx > Math.max(p.w / 2, PILL_HIT / 2) || dy > Math.max(p.h / 2, PILL_HIT / 2)) continue;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { best = p; bestD = d; }
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

/** Path of an upright pill (rounded ends) centred at (x, y). */
function pillPath(ctx, x, y, w, h) {
  const r = Math.min(h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + r, y - h / 2);
  ctx.lineTo(x + w / 2 - r, y - h / 2);
  ctx.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x - w / 2 + r, y + h / 2);
  ctx.arc(x - w / 2 + r, y, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

/** The entry badge of the path history (board M36 E): a small circle at a device's top right with a question mark drawn
 *  as a route, hops between nodes, so it still reads as "?" at 14 px. BADGE.r is its radius and BADGE.hit the pointer's
 *  reach; badgeCentre() places it from a symbol's centre and size. */
export const BADGE = Object.freeze({ r: 7, hit: 11 });
export const badgeCentre = (x, y, size) => [x + size / 2 - 1, y - size / 2 + 1];
const HOOK = [[-2.4, -1.5], [-1.5, -3.3], [1.2, -3.3], [2.3, -1.4], [0, 0.7], [0, 1.7]];

/** Draw one badge at (bx, by) in the current transform; `hot` (the pointer is over it) draws it dark, else grey. */
export function drawBadge(ctx, bx, by, theme, hot) {
  const color = hot ? theme.foreground : theme.muted;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(bx, by, BADGE.r, 0, 2 * Math.PI);
  ctx.fillStyle = theme.background;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  HOOK.forEach(([px, py], i) => (i ? ctx.lineTo(bx + px, by + py) : ctx.moveTo(bx + px, by + py)));
  ctx.stroke();
  ctx.fillStyle = color;
  for (const [px, py] of [...HOOK.slice(0, 5), [0, 4.1]]) { ctx.beginPath(); ctx.arc(bx + px, by + py, 0.9, 0, 2 * Math.PI); ctx.fill(); }
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

/** The value pill (also the path history window's): the lane stops 2 px before it (a background plate, opaque so a
 *  dimmed lane vanishes behind it too), thin outline in the lane's colour (t.line wide, default 1; t.dash for a ghost),
 *  the text upright inside (spec 7.1). Text with "\n" is stacked, one line each (Thread: RSSI over LQI, spec 5.8).
 *  t: { x, y (centre), w, h, text, color, alpha, line, dash }. */
export function drawPill(ctx, t, theme) {
  const font = theme.font.replace(/(\d+(?:\.\d+)?)px/, `${VALUE.font}px`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.background;
  pillPath(ctx, t.x, t.y, t.w + 4, t.h + 4);
  ctx.fill();
  ctx.globalAlpha = t.alpha ?? 1;
  pillPath(ctx, t.x, t.y, t.w, t.h);
  ctx.lineWidth = t.line ?? 1;
  ctx.setLineDash(t.dash || []);
  ctx.strokeStyle = t.color;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = theme.foreground;
  ctx.font = font;
  const lines = String(t.text).split("\n");
  const step = t.h / lines.length;
  lines.forEach((line, i) => ctx.fillText(line, t.x, t.y - t.h / 2 + step * (i + 0.5) + 0.5));
  ctx.font = theme.font;
  ctx.globalAlpha = 1;
}

/** One lane (links.js laneGeometry) with the current stroke style; with a head, the stroke stops at the head's base
 *  and a filled triangle points at the hearer. */
export function drawLane(ctx, lane, style) {
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
  /** Whether r overlaps anything placed. */
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

/** Draw lanes grouped by style, so the dash pattern changes once per group, not per lane. keepOrder: the items are
 *  sorted by class already (weakest first); only runs of the same style are grouped, so the order of classes stays. */
function strokeLanes(ctx, items, keepOrder = false) {
  if (!keepOrder) items.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
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
  }
  return items.length;
}

/** Whether the type line of labels is drawn at zoom k: from typeZoom (the working scale) up; always without one. */
export function typeShown(k, typeZoom) {
  return typeof typeZoom !== "number" || !Number.isFinite(typeZoom) || k >= typeZoom * (1 - 1e-9);
}

const styleKey = (style) => `${style.color}|${style.width}|${style.dash.join(",")}|${style.head}`;
/** Weakest class first, then grouped by style, so the dash pattern changes once per group. */
const byRankAndStyle = (p, q) => p.rank - q.rank || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0);

/** Draw one frame. view: { cam, width, height, dpr, labelZoom, debug, selected, hovered (node indices or -1),
 *  fps (number or null), fill ("none" | "role" | "power", palette.js FILLS), receptionColors (lanes coloured by their
 *  rating), labels ({ type, name, haName }: lines of a label block), typeZoom (the zoom from which the type line is
 *  drawn: the working scale, so the overview stays calm; none: always), texts ({ uncertain, parent, route,
 *  pathUnknown, kinds }, words drawn on the map), and the engine's own view settings (Zigbee: paths, heard,
 *  returnRoutes, sourceRoute), which only the engine reads }; pos: { x, y, pinned, mesh } arrays by node index;
 *  measure(text) for the label font.
 *  Returns what was drawn: { sx, sy, lines (pairs with a lane or glyph drawn), lanes, glyphs, values, labels, dropped,
 *  classes (lanes drawn per class of the engine, assumed and computed ("predicted") lanes also apart, lanes without
 *  class as "none"), order (class of each lane in drawing order), symbols (devices drawn), size (symbol size on
 *  screen), paths (null, or for the focused device { hops, ends, values: [{ s, h, text, x, y, w, height, drawn, cls,
 *  predicted, places (spots the lane offered: 1 = only its middle) }] }), pills (every value pill drawn: { x, y, w, h
 *  (centre and size), pair: [sender index, hearer index] }, the click targets of spec 9.5). */
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
  const engine = scene.engine;
  const debug = Boolean(view.debug);
  // What the overview draws, a look per lane or null (engines/<type>/scene.js overview), cached per view.
  const looks = engine ? engine.scene.overview(scene, view) : [];
  // The focus: the selection's (on click), else the device under the pointer previews its own, within what the
  // overview draws (the engine's focus decides both, and each hop's look).
  const selecting = view.selected >= 0;
  const pathNode = selecting ? view.selected : view.hovered;
  const route = engine && pathNode >= 0 ? engine.scene.focus(scene, pathNode, view) : null;
  let pathHops = [];
  let pathEnds = [];
  const near = new Set(focus);
  if (route) {
    pathHops = route.hops;
    pathEnds = route.ends;
    if (selecting) for (const j of route.nodes) near.add(j);
    else {
      for (const hop of pathHops) { near.add(hop.s); near.add(hop.h); }
      for (const end of pathEnds) { near.add(end.at); near.add(end.toward); }
    }
  }
  const margin = 40;
  const onScreen = (i) => sx[i] > -margin && sx[i] < width + margin && sy[i] > -margin && sy[i] < height + margin;
  const segmentVisible = (a, b) =>
    !(Math.max(sx[a], sx[b]) < -margin || Math.min(sx[a], sx[b]) > width + margin ||
      Math.max(sy[a], sy[b]) < -margin || Math.min(sy[a], sy[b]) > height + margin);

  // Links: each lane runs from sender to hearer on the right of its travel, in its look and by its own rating. A
  // selection (outside debug mode) draws nothing but its own lanes; otherwise the overview's lanes form a layer of
  // their own, dimmed while something is in focus, and the focus's lanes lie on top at full strength. Within a layer
  // the engine's rank orders them, the weakest first, so the links that carry traffic lie on top.
  const size = symbolSize(k);
  const offset = Math.max(1, (LANE_OFFSET * size) / SYMBOL_SIZE);
  const colored = Boolean(view.receptionColors);
  const dimming = focus.length > 0;
  const alpha = dimming ? DIM : 1;
  const texts = { uncertain: "0 (uncertain)", parent: "Parent", route: "Route", pathUnknown: "path unknown",
    ...(view.texts || {}) };
  const laneTexts = [];
  const glyphs = [];
  const order = [];
  const classes = Object.fromEntries([...(engine ? engine.scene.classes : []), "assumed", "predicted", "none"]
    .map((c) => [c, 0]));
  const pairsDrawn = new Set();
  let lanes = 0;
  ctx.font = theme.font;
  // A lane's value: an upright number in a pill that interrupts the lane (spec 7.1), at the hearer's end: min(a quarter
  // of the lane, 4 symbol diameters) back from the arrowhead's tip. Where that does not fit (lane under 60 px, or the
  // pill would touch a symbol) it moves to the lane's middle; no room even there: no value, the details list it
  // (spec 9.3). Both kinds slide along their own lane for a free place; values of the focus's lanes (extra.path) are
  // never dropped (spec 7.1): they fall back to the middle whatever is there. See value() below.
  const addValue = (lane, text, extra) => {
    // Two lines (Thread routes: RSSI over LQI) stack in a taller pill, as in the path history (ui/history-route.js).
    const rows = String(text).split("\n");
    const one = pillSize(Math.max(...rows.map((row) => measure(row))));
    const w = one.w;
    const h = rows.length > 1 ? one.h * 1.7 : one.h;
    let dists = pillDistances(lane, size, w, h);
    // Then every place along the lane clear of the arrowhead and the start, nearest the first choice first: a value
    // dodges a label or a symbol by sliding along its own lane.
    const along = w * Math.abs(lane.ux) + h * Math.abs(lane.uy);
    const first = dists.length ? dists[0] : lane.len * VALUE.share;
    const slide = [];
    for (let d = VALUE.tip + along / 2; d <= lane.len - VALUE.end - along / 2; d += 4) slide.push(d);
    dists = [...dists, ...slide.sort((p, q) => Math.abs(p - first) - Math.abs(q - first))];
    if (!dists.length) {
      if (!extra.path) return null;
      dists = [lane.len / 2]; // never dropped: the middle, overlap accepted
    }
    let spots = dists.filter((d, i) => dists.findIndex((e) => Math.abs(e - d) < 1) === i).map((d) => pillCentre(lane, d));
    // An engine that wants every focus value apart (focus.separate: Thread routes, board M38) also offers each place
    // shifted to the lane's right, away from the other direction's lane, so the two pills of a short hop sit side by
    // side; value() then keeps them clear of each other and of the hop numbers.
    if (extra.separate) {
      // On the lane or half a pill to its right at every place along it first; only then a full pill height out,
      // to the right or across the other lane to the left (at most one pill height and 6 px, rev11a). The height is
      // that of a two-line pill, so a one-line value ("unused · cost 4") can step clear of a two-line one.
      const tall = Math.max(h, one.h * 1.7);
      const shifted = (shifts) => spots.flatMap(([x, y]) => shifts.map((d) => [x + lane.nx * d, y + lane.ny * d]));
      spots = [...shifted([0, tall / 2 + 4]), ...shifted([tall + 6, -(tall / 2 + 4), -(tall + 6)])];
    }
    const t = { text, x: spots[0][0], y: spots[0][1], w, h, spots, ...extra };
    laneTexts.push(t);
    return t;
  };
  const count = (look) => {
    classes[look.cls || "none"]++;
    if (look.assumed) classes.assumed++;
    if (look.predicted) classes.predicted++;
    order.push(look.cls || "none");
  };
  const skip = new Set(pathHops.map((hop) => `${hop.s}>${hop.h}`)); // directions the focus layer draws itself
  const glyphAt = (s, h, dir, a) => {
    const lane = laneGeometry(sx[s], sy[s], sx[h], sy[h], size, size, offset);
    if (lane) glyphs.push({ text: engine.unknownGlyph(dir && dir.reason), x: lane.mx, y: lane.my, alpha: a });
  };
  if (!selecting || debug) {
    const items = [];
    const ordered = scene.lanes.filter((lane) => !skip.has(lane.key) && segmentVisible(lane.s, lane.h))
      .map((lane) => ({ lane, o: looks[lane.index] })).filter(({ o }) => o)
      .sort((p, q) => p.o.rank - q.o.rank || p.lane.index - q.lane.index);
    for (const { lane, o } of ordered) {
      const dir = lane.dir;
      const state = dir && (dir.state === "measured" || dir.state === "implied") ? dir.state : "unknown";
      if (!o.cls && state === "unknown") { // debug mode only: a direction without a reading gets its glyph
        glyphAt(lane.s, lane.h, dir, alpha);
        pairsDrawn.add(lane.pair);
        continue;
      }
      const geo = laneGeometry(sx[lane.s], sy[lane.s], sx[lane.h], sy[lane.h], size, size, offset);
      if (!geo) continue;
      const style = laneStyle(o.stroke, dir.rating, theme, { colored, state, weight: o.weight });
      items.push({ lane: geo, style, key: styleKey(style), rank: o.rank });
      count(o);
      pairsDrawn.add(lane.pair);
      if (!debug) continue; // values beside every lane in debug mode; otherwise only on the focus's lanes
      let text = engine.laneValue(dir, texts);
      if (state === "measured") text += ` \u2190 ${scene.nodes[lane.h].label}`;
      addValue(geo, text, { path: false, alpha, color: style.color, pair: [lane.s, lane.h] });
    }
    ctx.globalAlpha = alpha;
    lanes += strokeLanes(ctx, items.sort(byRankAndStyle), true);
  }

  ctx.setLineDash([]);
  ctx.lineCap = "butt";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const g of glyphs) {
    ctx.globalAlpha = g.alpha;
    haloText(ctx, g.text, g.x, g.y, theme, theme.muted);
  }
  ctx.globalAlpha = 1;
  // The selection's way as a band under its lanes and the symbols, where the engine gives one; hover previews without it.
  if (route && selecting && route.band) drawBand(ctx, route.band, sx, sy, theme);

  // Devices: plain ones first, the devices on the focus's paths above them, the focus on top.
  const nodeOrder = [];
  for (let i = 0; i < n; i++) if (!near.has(i)) nodeOrder.push(i);
  for (const i of near) if (!focusSet.has(i)) nodeOrder.push(i);
  for (const i of focus) nodeOrder.push(i);
  // Everything about a device stays inside its symbol (spec 8): offline is no fill (the background keeps lines from
  // showing through), the selection a thicker frame, a pin a mark inside. Hover changes only the highlighting.
  const obstacles = new RectGrid();
  const half = size / 2;
  const lineColors = new Map(); // per fill colour: the role and power fills have few distinct colours per frame
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
    // The neutral fill is designed for the theme's own line colour; no flip (spec 8).
    const stroke = node.available && view.fill === "none" ? theme.foreground : lineOn(fill);
    const layers = symbolLayers(node.parts, { selected: i === view.selected, pinned: Boolean(pos.pinned[i]) });
    // No value under this fill (not rated, no category): grey plus a slash, so colour is not the only sign.
    drawSymbol(ctx, layers, x, y, size, dpr, { fill, stroke, slash: node.available && !value });
    symbols++;
  }

  // The focus's lanes: each directed hop once, on the lane of its direction of travel, with the reception at its
  // hearer; an incomplete path ends in a dashed stem towards its goal with "?" (unknown beats wrong). They lie above
  // the symbols: a lane ends outside its own two symbols, so only a third device on its line is crossed, and it no
  // longer hides the lane (a router between another and the coordinator read as the way up, 2026-11-02).
  const pathValues = [];
  const ends = [];
  const hopNumbers = [];
  const numberRects = []; // the hop numbers' boxes, which separate values keep clear of
  if (route) {
    ctx.globalAlpha = 1;
    const items = [];
    const hops = [...pathHops].sort((p, q) => p.rank - q.rank);
    // An engine's hop may bring its own text (hop.text), be drawn in grey (muted), mark the weakest of a way (weak:
    // wider, the pill outlined in the scale's bad colour), carry a hop number, or be context whose value may give way
    // (context: placed like the debug overview's values, after everything else).
    const numbers = [];
    for (const hop of hops) {
      const { s, h, dir } = hop;
      if (!segmentVisible(s, h)) continue;
      const lane = laneGeometry(sx[s], sy[s], sx[h], sy[h], size, size, offset);
      if (!lane) continue;
      const state = dir && (dir.state === "measured" || dir.state === "implied") ? dir.state : "unknown";
      const base = laneStyle(hop.stroke, dir.rating, theme, { colored, state: hop.muted ? "unknown" : state,
        weight: hop.weight });
      const style = hop.weak ? { ...base, width: base.width + 1.5 } : base;
      items.push({ lane, style, key: styleKey(style), rank: hop.rank });
      count(hop);
      let text = hop.text ?? engine.laneValue(dir, texts);
      if (debug && state === "measured" && hop.text === undefined) text += ` \u2190 ${scene.nodes[h].label}`;
      const weakColor = hop.weak && theme.reception ? theme.reception[0] : null;
      const t = addValue(lane, text, { path: !hop.context, context: Boolean(hop.context), alpha: 1,
        color: weakColor || style.color, line: weakColor ? 2 : 1, pair: [s, h], separate: Boolean(route.separate) });
      if (hop.number) numbers.push({ lane, n: hop.number });
      pathValues.push({ s, h, text, cls: hop.cls, predicted: Boolean(hop.predicted), rank: hop.rank, drawn: false,
        ref: t });
    }
    lanes += strokeLanes(ctx, items.sort(byRankAndStyle), true);
    // Hop numbers sit near the sender's end, outside the lane (the value pill sits near the hearer's); drawn after the
    // values, so no pill covers them.
    for (const { lane, n: number } of numbers) {
      const d = Math.min(lane.len * 0.3, 28);
      hopNumbers.push({ x: lane.x0 + lane.ux * d + lane.nx * 11, y: lane.y0 + lane.uy * d + lane.ny * 11, text: String(number) });
    }
    for (const b of hopNumbers) {
      obstacles.add({ x: b.x - 7, y: b.y - 7, w: 14, h: 14 });
      numberRects.push({ x: b.x - 8, y: b.y - 8, w: 16, h: 16 });
    }
    const firstGlyph = glyphs.length; // the overview's glyphs lie under the symbols, the focus's above
    if (selecting) for (const g of route.glyphs) if (segmentVisible(g.s, g.h)) glyphAt(g.s, g.h, g.dir, 1);
    ctx.setLineDash(STEM.dash);
    ctx.lineCap = "butt";
    ctx.lineWidth = STEM.width;
    ctx.strokeStyle = theme.foreground;
    for (const end of pathEnds) {
      const stem = stemGeometry(sx[end.at], sy[end.at], sx[end.toward], sy[end.toward], size, offset);
      if (!stem) continue;
      ctx.beginPath();
      ctx.moveTo(stem.x0, stem.y0);
      ctx.lineTo(stem.x1, stem.y1);
      ctx.stroke();
      ends.push({ ...end, x: stem.gx, y: stem.gy, ux: stem.ux, uy: stem.uy });
    }
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const g of glyphs.slice(firstGlyph)) haloText(ctx, g.text, g.x, g.y, theme, theme.muted);
  }
  ctx.setLineDash([]);
  ctx.lineCap = "butt";

  // Text, in order of importance. A label block tries its places around its device and is left out if all would
  // cover another device or text already placed (the details list everything); the engine's anchors and the focus are
  // always labelled, in the first place if nothing else is free. Order: anchors and focus, the reception at the
  // hops of the focus's paths, "?" and "path unknown" at their unknown ends, the other devices on the paths,
  // everyone else from LABEL_SCALE up, values on other lanes (debug).
  ctx.globalAlpha = 1;
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const placed = obstacles; // labels become obstacles for later labels
  // The type line shows from the working scale up: the overview stays calm.
  const shownLabels = view.labels || DEFAULT_LABELS;
  const lineSwitches = typeShown(k, view.typeZoom) ? shownLabels : { ...shownLabels, type: false };
  let values = 0;
  let shown = 0;
  let dropped = 0;
  // A label block (labels.js labelLines): type above the symbol, readable name and Home Assistant name below it. It
  // tries its places in turn: split around the symbol, then the whole block below, above, right and left (places that
  // come out the same, as with the name alone, are tried once: below, above, right, left). Every line must be free.
  const smallFont = theme.font.replace(/(\d+(?:\.\d+)?)px/, (m, px) => `${Math.round(Number(px) * SMALL_SHARE * 10) / 10}px`);
  const lineOf = (line) => {
    const small = line.role === "ha";
    return { ...line, w: measure(line.text) * (small ? SMALL_SHARE : 1) + 4, h: small ? SMALL_LINE_HEIGHT : LINE_HEIGHT };
  };
  /** Line boxes { line, cx, cy } stacked downwards from top, each centred on cx or aligned at an edge. */
  const stack = (lines, top, x, align) => {
    let y = top;
    return lines.map((line) => {
      const cx = align === "left" ? x + line.w / 2 : align === "right" ? x - line.w / 2 : x;
      const box = { line, cx, cy: y + line.h / 2 };
      y += line.h;
      return box;
    });
  };
  const places = (x, y, above, below) => {
    const r = half;
    const all = [...above, ...below];
    const height = all.reduce((sum, l) => sum + l.h, 0);
    const aboveHeight = above.reduce((sum, l) => sum + l.h, 0);
    const out = [
      [...stack(above, y - r - 3 - aboveHeight, x, "center"), ...stack(below, y + r + 3, x, "center")],
      stack(all, y + r + 3, x, "center"),
      stack(all, y - r - 3 - height, x, "center"),
      stack(all, y - height / 2, x + r + 4, "left"),
      stack(all, y - height / 2, x - r - 4, "right"),
    ];
    const seen = new Set();
    return out.filter((boxes) => {
      const key = boxes.map((b) => `${b.cx.toFixed(1)},${b.cy.toFixed(1)}`).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  // Label boxes of the focus devices (selected, hovered): no value may cover them. Values yield to them only.
  const protectedRects = [];
  // The focus's values as drawn ({ rect, t }), and those a label had to cover: they are drawn again on top.
  const valueRects = [];
  const covered = new Set();
  const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const rectOf = (b) => ({ x: b.cx - b.line.w / 2, y: b.cy - b.line.h / 2, w: b.line.w, h: b.line.h });
  const label = (i, forced) => {
    if (!onScreen(i)) return;
    const node = scene.nodes[i];
    const { above, below } = labelLines(node, lineSwitches, texts.kinds || {});
    if (!above.length && !below.length) return;
    const options = places(sx[i], sy[i], above.map(lineOf), below.map(lineOf));
    let spot = options.find((boxes) => boxes.every((b) => !placed.hits({ ...rectOf(b), owner: i }))) || null;
    if (!spot && !forced) { dropped++; return; }
    if (!spot) {
      // No free place: the place covering least of the focus's values (the first where none is placed yet), so a
      // device lying on a lane keeps its label beside the lane's value where it can; a value it still covers wins.
      const over = (boxes) => boxes.reduce((sum, b) => sum + valueRects.reduce((a, v) => a + overlapArea(rectOf(b), v.rect), 0), 0);
      spot = options.reduce((best, boxes) => (over(boxes) < over(best) ? boxes : best));
      for (const v of valueRects) if (spot.some((b) => overlapArea(rectOf(b), v.rect) > 0)) covered.add(v);
    }
    ctx.globalAlpha = dimming && !near.has(i) ? DIM : 1;
    const isFocus = focusSet.has(i);
    for (const b of spot) {
      const r = rectOf(b);
      placed.add(r);
      if (isFocus) { // a light plate keeps crossing lanes from cutting through the focus label
        protectedRects.push({ x: r.x - 1, y: r.y, w: r.w + 2, h: r.h });
        ctx.globalAlpha = PLATE_ALPHA;
        ctx.fillStyle = theme.background;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      }
      const small = b.line.role === "ha";
      if (small) ctx.font = smallFont;
      haloText(ctx, b.line.text, b.cx, b.cy, theme, b.line.role === "name" ? theme.foreground : theme.muted);
      if (small) ctx.font = theme.font;
    }
    ctx.globalAlpha = 1;
    shown++;
  };
  const pills = new Map(); // every pill drawn this frame, once (a pill covered by a label is drawn again, same place)
  const drawValue = (t) => drawPill(ctx, t, theme);
  // Area of a rectangle covered by device symbols (a pill never covers one where a lane has another place).
  const symbolArea = (r) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (onScreen(i)) sum += overlapArea(r, { x: sx[i] - half, y: sy[i] - half, w: size, h: size });
    }
    return sum;
  };
  const value = (t) => {
    let rect = null;
    // The focus's values sit at their preferred place unless it covers a focus label or a symbol (then the next
    // place on the lane, else the one covering least); they are never dropped. With focus.separate a value placed
    // earlier or a hop number weighs far more than a label or a symbol: no two values cover each other where any
    // place is free, and so does a device symbol. Only the debug overview's values need a free spot and may be
    // dropped.
    let least = Infinity;
    const box = (x, y) => ({ x: x - t.w / 2 - 2, y: y - t.h / 2 - 2, w: t.w + 4, h: t.h + 4 });
    // Separate values treat device symbols as hard as other values (rev11a): a pill on a symbol hides the device.
    const cost = (r) => (t.separate ? ([...valueRects.map((v) => v.rect), ...numberRects]
      .reduce((sum, q) => sum + overlapArea(r, q), 0) + symbolArea(r)) * 1000 : symbolArea(r))
      + protectedRects.reduce((sum, q) => sum + overlapArea(r, q), 0);
    const consider = (x, y) => {
      const r = box(x, y);
      const area = cost(r);
      if (area >= least) return false;
      least = area;
      rect = r;
      t.x = x;
      t.y = y;
      return area === 0;
    };
    for (const [x, y] of t.spots) {
      if (t.path) {
        if (consider(x, y)) break;
        continue;
      }
      const r = box(x, y);
      if (placed.hits(r)) continue;
      rect = r;
      t.x = x;
      t.y = y;
      break;
    }
    // Last resort of separate values: still on another value or a hop number, so stack it against the other
    // direction's pill of the same hop, above, below or beside it, which keeps the two readable as one pair.
    const partner = t.path && t.separate && least >= 1000 && t.pair
      ? valueRects.find((v) => v.t.pair && v.t.pair[0] === t.pair[1] && v.t.pair[1] === t.pair[0]) : null;
    if (partner) {
      const p = partner.t;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (consider(p.x + dx * (p.w / 2 + t.w / 2 + 5), p.y + dy * (p.h / 2 + t.h / 2 + 5))) break;
      }
    }
    if (!rect) return false;
    placed.add(rect);
    if (t.path) valueRects.push({ rect, t });
    drawValue(t);
    values++;
    pills.set(t, { x: t.x, y: t.y, w: t.w, h: t.h, pair: t.pair }); // where it ended up: the click target (spec 9.5)
    return true;
  };
  // An unknown end: "?" at the stem's tip, always, and the words beside it where they fit.
  const endText = (e) => {
    const q = measure("?") + 4;
    placed.add({ x: e.x - q / 2, y: e.y - LINE_HEIGHT / 2, w: q, h: LINE_HEIGHT });
    haloText(ctx, "?", e.x, e.y, theme);
    const w = measure(texts.pathUnknown) + 4;
    const h = LINE_HEIGHT;
    // Ahead along the stem first (away from its device), then the sides.
    const ahead = [e.x + e.ux * (q / 2 + w / 2 + 2), e.y + e.uy * (h + 2)];
    const spots = [ahead, [e.x + q / 2 + 2 + w / 2, e.y], [e.x - q / 2 - 2 - w / 2, e.y], [e.x, e.y + h + 1],
      [e.x, e.y - h - 1]];
    for (const [cx, cy] of spots) {
      const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
      if (placed.hits(rect)) continue;
      placed.add(rect);
      haloText(ctx, texts.pathUnknown, cx, cy, theme, theme.muted);
      return;
    }
  };
  // The engine's anchors are always labelled (Zigbee: the coordinator; Thread: the leader and the border routers).
  const always = engine ? engine.scene.anchors(scene).filter((i) => !focusSet.has(i)) : [];
  // The focus's pills first claim their first places, so the focus labels choose places clear of them (a label on a
  // hub would otherwise lie on a short lane's only place); the values themselves still yield to the labels below.
  for (const t of laneTexts) if (t.path) placed.add({ x: t.x - t.w / 2 - 2, y: t.y - t.h / 2 - 2, w: t.w + 4, h: t.h + 4 });
  for (const i of [...focus, ...always]) label(i, true);
  // Values of the strongest hops claim their places first (the engine's rank; Zigbee: the way up and down, then
  // routes, then computed hops, then heard only): the drawing order puts the weakest first, the room for text goes to
  // the strongest; where there is no room the weaker gives way, and Details list it.
  for (const pv of [...pathValues].sort((p, q) => q.rank - p.rank)) if (pv.ref) pv.drawn = value(pv.ref);
  for (const b of hopNumbers) {
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = theme.background;
    ctx.fillText(b.text, b.x, b.y + 0.5);
  }
  for (const e of ends) endText(e);
  // A device on the focus's paths is always labelled (Router 17 lost its label in a hub
  // position where lane values had taken every place): the values were placed first, so the block takes its first
  // place over them if none is free ("overlap is accepted", 7.1); only the rest of the map yields.
  for (const i of near) if (!focusSet.has(i) && !always.includes(i)) label(i, true);
  for (const v of covered) drawValue(v.t);
  if (labelsForAll(k, view.labelZoom)) {
    // Everyone else in the engine's label order (labelRank: the more central a role, the earlier).
    const rank = (i) => engine.scene.labelRank(scene.nodes[i]);
    const rest = [];
    for (let i = 0; i < n; i++) if (!near.has(i) && !always.includes(i)) rest.push(i);
    rest.sort((a, b) => rank(a) - rank(b) || a - b);
    for (const i of rest) label(i, false);
  }
  for (const t of laneTexts) if (!t.path && !t.context) value(t);

  // The entry badges of the path history: with a selection, every other device offers its pair window (board M36 E).
  if (view.pairBadges && view.selected >= 0) {
    ctx.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      if (i === view.selected || !onScreen(i)) continue;
      const [bx, by] = badgeCentre(sx[i], sy[i], size);
      drawBadge(ctx, bx, by, theme, i === view.badgeHover);
    }
  }

  // Bottom left: the top corners carry the panel's buttons.
  if (view.debug && typeof view.fps === "number") {
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    haloText(ctx, `${Math.round(view.fps)} fps`, 8, height - 8, theme);
  }
  const paths = route ? { hops: pathHops.length, ends: ends.length, numbers: hopNumbers.map(({ x, y, text }) => ({ x, y, text })),
    values: pathValues.map(({ s, h, text, cls, predicted, ref, drawn: shownValue }) => ({ s, h, text, cls, predicted,
      x: ref ? ref.x : null, y: ref ? ref.y : null, w: ref ? ref.w + 4 : null, height: ref ? ref.h : null,
      drawn: shownValue, places: ref ? ref.spots.length : 0 })) } : null;
  return { pills: [...pills.values()], sx, sy, lines: pairsDrawn.size, lanes, glyphs: glyphs.length, values, labels: shown, dropped, classes, order,
    symbols, size, paths };
}
