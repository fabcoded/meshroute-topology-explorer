// SPDX-License-Identifier: MIT
// Canvas 2D drawing of the quality view (spec 7.1, 8): devices as symbols (symbols.js: role, picture, state) whose
// background carries the fill, none (default), role or power source; links as two lanes per pair, each with the class
// of its own direction (links.js), optionally coloured by reception. What is drawn follows the stage of
// "Communication paths" (decision by Fabian Schwamborn, 2026-11-01, board M11): the overview shows the up and down
// lanes of all devices (the option "heard only" adds the selection's best heard-only partners); a selected device shows only its
// own lanes of the stage, every hop with the reception at its hearer, its way up as a band, unknown ends as dashed
// stems with "?", and dims the other devices; the device under the pointer previews its lanes within the overview; debug mode draws every lane
// with its value. Labels as canvas text placed around obstacles: a block of the device's type above the symbol, its
// readable name below and optionally the original Home Assistant name under that (labels.js). Also hit testing,
// which shares the symbols' size. Pure except for the context passed in.
// node --test tests/

import { DEFAULT_LABELS, displayLabels, haLabels, labelLines, labelsForAll, MAX_LABEL_WIDTH } from "./labels.js";
import { fillColor, lineColorOn, powerCategory } from "./palette.js";
import { toScreen } from "./camera.js";
import {
  BAND, BEST_HEARD, CLASSES, DEFAULT_PATHS, DIM, LANE_OFFSET, STEM, VALUE_AT, classifyLanes, hasRoutes, laneClass,
  laneGeometry, laneStyle, overviewShows, pathStage, stemGeometry, textBeside, unknownGlyph,
} from "./links.js";
import { SYMBOL_SIZE, drawSymbol, symbolLayers, symbolParts, symbolSize } from "./symbols.js";
import { nodePaths, unknownEnd } from "../model/node-paths.js";
import { theoreticalLanes } from "../model/theoretical.js";

/** Roles the map knows (spec 4.2); anything else is drawn as unknown. */
const ROLES = new Set(["coordinator", "router", "end device", "border router", "unknown"]);
/** The node diameter in L0 (spec 7.1): every device has the same symbol size. */
export const NODE_DIAMETER = SYMBOL_SIZE;
/** Hit areas are at least 24 CSS pixels across (spec 9.3, WCAG 2.2 2.5.8). */
export const MIN_HIT = 24;
const LINE_HEIGHT = 14;
/** The original Home Assistant name is a smaller line (design by Fabian Schwamborn, 2026-11-01): 10 px in a 12 px
 *  label font, scaled by this share; its line is a little lower too. Own choice. */
const SMALL_SHARE = 10 / 12;
const SMALL_LINE_HEIGHT = 12;
/** Places a lane's value tries, as shares of the lane from the sender: a quarter before the hearer first (VALUE_AT,
 *  decision by Fabian Schwamborn, 2026-11-01), then a little further back, then closer to the hearer. Own choice. */
/** Opacity of the plate under a focus device's label. */
const PLATE_ALPHA = 0.85;
const VALUE_SPOTS = Object.freeze([VALUE_AT, 0.6, 0.88]);
/** Further places along its own lane for a focus value that would cover a focus device's label (A4s, Codex review 1.6,
 *  main session decision 2026-11-01); tried after VALUE_SPOTS, still beside the lane and before the hearer. */
const EXTRA_SPOTS = Object.freeze([0.4, 0.5, 0.72, 0.8, 0.95, 0.15]);

/** Screen length (CSS px) of the shortest focus lane of device `index` at camera `cam`, as drawn by drawScene: the
 *  lanes of the selection's paths in the view's stage (heard-only partners included when `view.heard`), through
 *  laneGeometry; a hop the symbols leave no room for (laneGeometry null) counts as 0. Infinity without hops. Used
 *  by the graph view to zoom on a tap when the paths are too short to read (spec 9.3). */
export function shortestFocusLane(view, index, cam) {
  const { scene, pos, width, height } = view;
  const route = scenePaths(scene, index, pathStage(view.paths), view.sourceRoute === "assume" ? "assume" : "off",
    Boolean(view.heard));
  const size = symbolSize(cam.k);
  const offset = Math.max(1, (LANE_OFFSET * size) / SYMBOL_SIZE);
  let shortest = Infinity;
  for (const hop of route.hops.values()) {
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

/** Text for a reading's value on a lane, raw LQI: "0 (uncertain)" for 0 (spec 3.1; the panel passes its translation),
 *  "?" for no value or no entry. */
export function valueText(lqi, uncertain = "0 (uncertain)") {
  if (lqi === 0) return uncertain;
  return typeof lqi === "number" && lqi > 0 ? String(lqi) : "?";
}

/** The value of a lane (a direction's evidence, data model 4.3): the raw LQI at the hearer, "Parent" or "Route" where
 *  only a parent link or a route implies it; without a reading the legend's glyph (unknownGlyph: "–" where the
 *  hearer's table was read and does not list the sender, "?" where there is no table to ask; decision by the main
 *  session, 2026-11-01). Texts: the panel's words. */
export function laneValue(dir, texts) {
  if (dir && dir.state === "implied") return dir.source === "parent" ? texts.parent : texts.route;
  if (dir && dir.scale === "thread-lqi") return threadValue(dir);
  const text = valueText(dir ? dir.lqi : null, texts.uncertain);
  return text === "?" ? unknownGlyph(dir && dir.reason) : text;
}

/** What a Thread lane shows at its arrow (spec 7.1; board recommendation, main session 2026-11-01, M15 asks the owner):
 *  "rssi" = the RSSI in dBm, the link quality 0-3 only where no RSSI was reported (the details list both); "lqi" = the
 *  link quality first. The one switch for the owner's choice. */
export const THREAD_VALUE = "rssi";

/** A Thread direction's value at the arrow: "-75 dBm", or "LQI 3" (THREAD_VALUE); the unknown glyph without either. */
export function threadValue(dir, mode = THREAD_VALUE) {
  const rssi = dir && typeof dir.rssi === "number" ? `${String(dir.rssi).replace("-", "\u2212")} dBm` : null;
  const lqi = dir && typeof dir.lqi === "number" ? `LQI ${dir.lqi}` : null;
  const text = mode === "lqi" ? lqi || rssi : rssi || lqi;
  return dir && dir.state === "measured" && text ? text : unknownGlyph(dir && dir.reason);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Order of two pairs for the default view: higher rating first, then higher LQI; unknown last. */
const better = (r, s) => ((num(s.rating) ?? -1) - (num(r.rating) ?? -1)) || ((num(s.lqi) ?? -1) - (num(r.lqi) ?? -1));

/** Static part of the picture for one network: nodes with display labels (readable name, Home Assistant name, kind
 *  for the type line); pairs with their evidence per direction (ab: a hears b, ba: b hears a; { state, lqi, rating,
 *  source, reason } from the data model) and their two lanes; lanes { s, h (node indices of sender and hearer), pair,
 *  dir (the hearer's evidence), up, downMeasured, downAssumed, route (what the lane carries, links.js classifyLanes),
 *  key "s>h" }; every device's up path as node indices; neighbours. Classes per source-route stage: sceneClasses. */
export function buildScene(network, measure, maxLabelWidth = MAX_LABEL_WIDTH) {
  const seen = new Set();
  const devices = [];
  for (const d of network.devices || []) {
    if (!d || typeof d.id !== "string" || seen.has(d.id)) continue;
    seen.add(d.id);
    devices.push(d);
  }
  const labels = displayLabels(devices, measure, maxLabelWidth);
  const ha = haLabels(devices, (text) => measure(text) * SMALL_SHARE, maxLabelWidth); // drawn in the smaller font
  const nodes = devices.map((d, i) => {
    const role = ROLES.has(d.role) ? d.role : "unknown";
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
  const classified = classifyLanes({ ...network, devices });
  const pairs = [];
  const pairAt = new Map(); // index in classified.pairs -> index in pairs
  classified.pairs.forEach((p, k) => {
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
  for (const l of classified.lanes) {
    const pair = pairAt.get(l.pair);
    if (pair === undefined) continue;
    const s = index.get(l.sender);
    const h = index.get(l.hearer);
    const lane = { s, h, pair, dir: l.dir, up: l.up, downMeasured: l.downMeasured, downAssumed: l.downAssumed,
      route: l.route, key: `${s}>${h}`, index: lanes.length };
    pairs[pair].lanes.push(lane.index);
    laneByKey.set(lane.key, lane);
    lanes.push(lane);
  }
  const paths = nodes.map((n) => (classified.upPaths.get(n.id) || []).map((id) => index.get(id))
    .filter((i) => i !== undefined));
  const coordinator = nodes.findIndex((n) => n.role === "coordinator");
  // routes false (Thread, spec 4.6): no paths and no stages; the overview draws every lane with a class and a click
  // shows the device's own lanes (scenePaths).
  return { nodes, index, pairs, lanes, laneByKey, neighbours, labels, upPaths: paths, coordinator,
    routes: hasRoutes(network), pathNet: classified.network, pathCache: new Map(), classCache: new Map(), backbone: null };
}

/** The backbone the overview draws from the stage "all" on (spec 5.7, 7.1; decision by Fabian Schwamborn,
 *  2026-11-01): every lane a theoretical path between two devices uses, computed once per scene (the network's
 *  theoretical lanes are cached as well), not per frame. { kind (per lane: null, "route" when a table, neighbour or
 *  parent link takes it, "predicted" when only a computed route discovery does), counts: { route, predicted } }. */
export function sceneBackbone(scene) {
  if (scene.backbone) return scene.backbone;
  const kind = scene.lanes.map(() => null);
  const counts = { route: 0, predicted: 0 };
  for (const { sender, hearer, hows } of scene.pathNet ? theoreticalLanes(scene.pathNet).values() : []) {
    const lane = scene.laneByKey.get(`${scene.index.get(sender)}>${scene.index.get(hearer)}`);
    if (!lane) continue;
    kind[lane.index] = [...hows].every((h) => h === "discovery") ? "predicted" : "route";
    counts[kind[lane.index]]++;
  }
  scene.backbone = { kind, counts };
  return scene.backbone;
}

/** Classes of the scene's lanes under a source-route stage ("off" or "assume"), cached per scene: { cls (per lane, one
 *  of CLASSES or null), assumed (per lane: drawn as an assumed down lane), heardOnly (per pair: a reading in some
 *  direction and no up, down or route lane in either), rank (per pair: its best heard lane's reception, the rating
 *  at that lane's hearer, for ranking partners), counts (lanes per class, assumed counted apart as well) }. */
export function sceneClasses(scene, sourceRoute = "off") {
  const mode = sourceRoute === "assume" ? "assume" : "off";
  if (scene.classCache.has(mode)) return scene.classCache.get(mode);
  const cls = scene.lanes.map((l) => laneClass(l, mode));
  const assumed = scene.lanes.map((l, i) => cls[i] === "down" && !l.downMeasured);
  const heardOnly = scene.pairs.map((p) => p.lanes.some((i) => cls[i] === "heard")
    && p.lanes.every((i) => cls[i] === "heard" || cls[i] === null));
  // A heard-only pair ranks by its best heard lane: the rating is relative to that lane's hearer (spec 5.4).
  const rank = scene.pairs.map((p) => p.lanes.filter((i) => cls[i] === "heard").map((i) => scene.lanes[i].dir)
    .sort(better)[0] || {});
  const counts = Object.fromEntries([...CLASSES, "assumed"].map((c) => [c, 0]));
  cls.forEach((c, i) => { if (c) counts[c]++; if (assumed[i]) counts.assumed++; });
  const result = { cls, assumed, heardOnly, rank, counts };
  scene.classCache.set(mode, result);
  return result;
}

/** How strongly a hop of the focus's paths is drawn when two paths share it: up or measured down, then assumed down,
 *  then a route between devices, then a hop only a computed route discovery takes, then heard only (a hop a measured
 *  walk takes is never drawn as assumed, one a table or a neighbour entry proves never as computed). */
const strength = (cls, assumed, predicted = false) => (cls === "route" ? (predicted ? 1.5 : 2) : cls === "heard" ? 1
  : assumed ? 3 : 4);

/** The heard-only partners of device i for the option "heard only (best 3)" (the one place to change the rule): pairs
 *  with a heard lane and no up, down or route lane (sc.heardOnly), and in the stage "all" none of whose lanes the
 *  device's own theoretical paths (`hops`, keys "s>h") take; the best BEST_HEARD by rating at the hearer. */
function heardPartners(scene, i, sc, hops, stage) {
  const taken = (pair) => stage !== "coordinator" && pair.lanes.some((li) => hops.has(scene.lanes[li].key));
  return scene.pairs.filter((p) => (p.a === i || p.b === i) && sc.heardOnly[p.index] && !taken(p))
    .sort((x, y) => better(sc.rank[x.index], sc.rank[y.index]) || x.index - y.index).slice(0, BEST_HEARD);
}

/** The lanes of node i in a stage of "Communication paths" (links.js PATH_STAGES), cached per scene: { hops: Map
 *  "s>h" -> { s, h, dir, cls, assumed, predicted } (each directed hop once, dir the reception at h with how the hop is
 *  taken, cls the class it is drawn with, predicted: only a computed route discovery takes it), ends: [{ at, toward,
 *  cls }] (incomplete paths, with the class of their path), glyphs: [{ s, h, dir }] (directions without a reading of
 *  the heard-only partners), nodes: Set of every device on a path, named as a goal or a partner, paths (the model's,
 *  for tests) }. "coordinator": the device's way up and down (model/node-paths.js); "all" adds its theoretical way to
 *  and from every other device as routes, the out tree and the in tree (spec 5.7); `heard` adds its best heard-only
 *  partners in both directions (all stages). A path to or from the coordinator is up or down (the coordinator's own view lists its
 *  routes). sourceRoute: "assume" draws assumed return paths (model/source-routes.js), "off" leaves them unknown. */
export function scenePaths(scene, i, stage = DEFAULT_PATHS, sourceRoute = "off", heard = false) {
  const mode = pathStage(stage);
  const sr = sourceRoute === "assume" ? "assume" : "off";
  const key = `${i}|${mode}|${sr}|${heard ? 1 : 0}`;
  if (scene.pathCache.has(key)) return scene.pathCache.get(key);
  const hops = new Map();
  const ends = [];
  const glyphs = [];
  const nodes = new Set([i]);
  if (scene.routes === false) {
    // Thread (spec 3.2): no routes, so no paths: the device's own lanes, each with its class (parent link or
    // neighbour) and its value, and the glyph of each direction without a reading.
    const sc = sceneClasses(scene, "off");
    for (const pair of scene.pairs) {
      if (pair.a !== i && pair.b !== i) continue;
      nodes.add(pair.a);
      nodes.add(pair.b);
      for (const li of pair.lanes) {
        const lane = scene.lanes[li];
        if (sc.cls[li]) hops.set(lane.key, { s: lane.s, h: lane.h, dir: lane.dir, cls: sc.cls[li], assumed: false, predicted: false });
        else glyphs.push({ s: lane.s, h: lane.h, dir: lane.dir });
      }
    }
    const result = { hops, ends, glyphs, nodes, paths: [] };
    scene.pathCache.set(key, result);
    return result;
  }
  const coordinator = scene.coordinator >= 0 ? scene.nodes[scene.coordinator].id : null;
  const paths = scene.pathNet
    ? nodePaths(scene.pathNet, scene.nodes[i].id, mode === "coordinator" ? "coordinator" : "all", { sourceRoute: sr })
    : [];
  const at = (id) => scene.index.get(id);
  const seenEnds = new Set();
  for (const p of paths) {
    // The coordinator's own routes (its stage-1 view) are its ways down and up; a theoretical path (its hops say how
    // they are taken) is a route for every device, the coordinator's trees included: where it runs over someone's up
    // or down lane, drawScene draws that lane's own class.
    const theoretical = p.hops.some((hop) => hop.how);
    const cls = p.kind === "up" ? "up" : p.kind === "down" ? "down" : theoretical ? "route"
      : p.from === coordinator ? "down" : p.to === coordinator ? "up" : "route";
    const assumed = cls === "down" && p.assumed === true;
    for (const id of p.ids) if (at(id) !== undefined) nodes.add(at(id));
    for (const hop of p.hops) {
      const s = at(hop.sender);
      const h = at(hop.hearer);
      if (s === undefined || h === undefined) continue;
      const predicted = cls === "route" && hop.how === "discovery";
      const st = strength(cls, assumed, predicted);
      const had = hops.get(`${s}>${h}`);
      if (had && strength(had.cls, had.assumed, had.predicted) >= st) continue;
      hops.set(`${s}>${h}`, { s, h, dir: hop, cls, assumed, predicted });
    }
    const end = unknownEnd(p);
    if (!end || at(end.at) === undefined || at(end.toward) === undefined) continue;
    const k = `${at(end.at)}>${at(end.toward)}`;
    if (seenEnds.has(k)) continue;
    seenEnds.add(k);
    ends.push({ at: at(end.at), toward: at(end.toward), cls });
    nodes.add(at(end.toward)); // the goal is named, so the stem points at something the user can read
  }
  if (heard) {
    // The checkbox "heard only (best 3)" (decision by Fabian Schwamborn, 2026-11-01): the 3 best partners of device i with
    // a reading and no lane drawn between the two in this stage: no up, down or route lane (heardOnly) and, from the
    // stage "all" on, no hop of the device's own theoretical paths (decision of the main session, same day).
    const sc = sceneClasses(scene, sr);
    const partners = heardPartners(scene, i, sc, hops, mode);
    for (const pair of partners) {
      nodes.add(pair.a);
      nodes.add(pair.b);
      for (const li of pair.lanes) {
        const lane = scene.lanes[li];
        if (sc.cls[li] === "heard") {
          hops.set(lane.key, { s: lane.s, h: lane.h, dir: lane.dir, cls: "heard", assumed: false, predicted: false });
        } else if (!lane.dir || lane.dir.state === "unknown") {
          glyphs.push({ s: lane.s, h: lane.h, dir: lane.dir }); // a path hop on this lane shows its "?" itself
        }
      }
    }
  }
  const result = { hops, ends, glyphs, nodes, paths };
  scene.pathCache.set(key, result);
  return result;
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
 *  fps (number or null), fill ("none" | "role" | "power", palette.js FILLS), paths (the stage of "Communication
 *  paths": "coordinator" | "all", links.js PATH_STAGES), heard (the checkbox "heard only", on click only), receptionColors (lanes coloured by their rating),
 *  labels ({ type, name, haName }: lines of a label block), typeZoom (the zoom from which the type line is drawn:
 *  the working scale, so the overview stays calm; none: always), sourceRoute ("off" | "assume": assumed return paths),
 *  texts ({ uncertain, parent, route, rx, pathUnknown, kinds }, words drawn on the map) }; pos: { x, y, pinned, mesh }
 *  arrays by node index; measure(text) for the label font.
 *  Returns what was drawn: { sx, sy, lines (pairs with a lane or glyph drawn), lanes, glyphs, values, labels, dropped,
 *  classes (lanes drawn per class, assumed down lanes also apart, lanes without class as "none"), order (class of each
 *  lane in drawing order), symbols (devices drawn), size (symbol size on screen), paths (null, or for the focused
 *  device { hops, ends, values: [{ s, h, text, x, y, w, height, drawn, cls, predicted }] }) }. classes also counts the
 *  focus's computed hops apart ("predicted"). */
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
  const routes = scene.routes !== false; // Thread has no stages: its overview draws every lane with a class
  const stage = routes ? pathStage(view.paths) : "coordinator";
  const sourceRoute = view.sourceRoute === "assume" ? "assume" : "off";
  const debug = Boolean(view.debug);
  const sc = sceneClasses(scene, sourceRoute);
  // What the overview of the stage draws (decisions by Fabian Schwamborn, 2026-11-01): up and down lanes; from "all"
  // on the backbone of theoretical paths as routes, lanes only a computed discovery takes lighter; never heard-only
  // lanes (stage 3 adds partners on click only); every lane in its own class in debug mode, with the glyphs of
  // directions without a reading. overview(lane): { cls, predicted } or null when the overview leaves it out.
  const bb = stage !== "coordinator" && !debug ? sceneBackbone(scene) : null;
  const overview = (lane) => {
    const cls = sc.cls[lane.index];
    if (debug || cls === "up" || cls === "down" || (!routes && cls)) return { cls, predicted: false };
    const kind = bb ? bb.kind[lane.index] : null;
    if (!kind || !overviewShows("route", stage, { backbone: true })) return null;
    return { cls: "route", predicted: kind === "predicted" };
  };
  const laneShown = (lane) => overview(lane) !== null;
  // The lanes of the focus: the selection's (its stage on click), else the device under the pointer previews its own,
  // but only lanes the overview of the stage draws anyway (hover never adds what the stage hides).
  const selecting = view.selected >= 0;
  const pathNode = selecting ? view.selected : view.hovered;
  const route = pathNode >= 0 ? scenePaths(scene, pathNode, stage, sourceRoute, selecting && Boolean(view.heard)) : null;
  let pathHops = [];
  let pathEnds = [];
  const near = new Set(focus);
  if (route) {
    // Stage 1: a lane keeps its strongest class whatever is in focus (main session, 2026-11-01): a hop of the focus's
    // ways on someone's up or down lane is drawn as that lane. From stage 2 on the focus's own tree decides (main
    // session, 2026-11-01, board M11 rule 5): scenePaths already gives each hop the strongest of the selection's own
    // ways (its up and down lanes, tables, neighbours, parent and child links, else discovery = computed); the
    // network-wide backbone does not reach into the focus, or nearly every computed hop would look proven.
    // Only the selection's stage-1 lanes (its up and down paths; the coordinator's routes down and up) override: they
    // are the same lanes in both stages for a device, but the coordinator's trees come as routes in stage 2.
    const own = stage !== "coordinator" ? scenePaths(scene, pathNode, "coordinator", sourceRoute).hops : null;
    const strongest = (hop) => {
      if (own) {
        const s1 = own.get(`${hop.s}>${hop.h}`);
        return s1 && strength(s1.cls, s1.assumed) > strength(hop.cls, hop.assumed, hop.predicted)
          ? { ...hop, cls: s1.cls, assumed: s1.assumed, predicted: false } : hop;
      }
      const lane = scene.laneByKey.get(`${hop.s}>${hop.h}`);
      if (!lane) return hop;
      const lc = sc.cls[lane.index];
      const la = lc === "down" && sc.assumed[lane.index];
      if ((lc === "up" || lc === "down") && strength(lc, la) > strength(hop.cls, hop.assumed, hop.predicted)) {
        return { ...hop, cls: lc, assumed: la, predicted: false };
      }
      if (lc === "route" && strength("route", false) > strength(hop.cls, hop.assumed, hop.predicted)) {
        return { ...hop, cls: "route", assumed: false, predicted: false };
      }
      return hop;
    };
    pathHops = [...route.hops.values()].map(strongest);
    pathEnds = route.ends;
    if (!selecting && !debug) {
      // A preview keeps only what the overview draws, in a class it draws: routes from the stage "all" on, where the
      // backbone carries them; heard-only partners wait for the click.
      const previewed = (cls) => (!routes ? Boolean(cls) : overviewShows(cls, stage, { backbone: true }));
      pathHops = pathHops.filter((hop) => {
        const lane = scene.laneByKey.get(`${hop.s}>${hop.h}`);
        return previewed(hop.cls) && Boolean(lane) && laneShown(lane);
      });
      pathEnds = pathEnds.filter((end) => previewed(end.cls));
    }
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

  // Links: each lane runs from sender to hearer on the right of its travel, styled by its own class and rating. A
  // selection (outside debug mode) draws nothing but its own lanes; otherwise the overview's lanes form a layer of
  // their own, dimmed while something is in focus, and the focus's lanes lie on top at full strength. Within a layer:
  // lanes without class (debug), heard only, routes between devices, down, up, so the links that carry traffic lie on
  // top.
  const size = symbolSize(k);
  const offset = Math.max(1, (LANE_OFFSET * size) / SYMBOL_SIZE);
  const colored = Boolean(view.receptionColors);
  const dimming = focus.length > 0;
  const alpha = dimming ? DIM : 1;
  const texts = { uncertain: "0 (uncertain)", parent: "Parent", route: "Route", rx: "RX:", pathUnknown: "path unknown",
    ...(view.texts || {}) };
  const laneTexts = [];
  const glyphs = [];
  const order = [];
  const classes = Object.fromEntries([...CLASSES, "assumed", "predicted", "none"].map((c) => [c, 0]));
  const pairsDrawn = new Set();
  let lanes = 0;
  ctx.font = theme.font;
  // A lane's value: "RX:" over the value at the hearer, beside the lane on its right, a quarter of the lane before
  // the hearer (VALUE_AT); on a short lane it moves back just enough to stay beside its own lane. If that spot is
  // taken, it tries a little further back and a little closer to the hearer, always beside its own lane. No room:
  // the details list it (spec 9.3). Values of the focus's lanes (extra.path) do not yield: see value() below.
  const addValue = (lane, text, extra) => {
    const w = Math.max(measure(texts.rx), measure(text));
    const h = 2 * LINE_HEIGHT;
    const along = w * Math.abs(lane.ux) + h * Math.abs(lane.uy);
    // A focus lane's value is never dropped (board M11 rule 8, owner 2026-11-01): on a short lane it sits at its
    // middle, beside the lane, where the lane is long enough for nothing else. Other values yield (spec 9.3).
    if (along + 8 > lane.len && !extra.path) return null;
    const half = Math.min(0.5, along / 2 / lane.len);
    const spots = [];
    for (const share of extra.path ? [...VALUE_SPOTS, ...EXTRA_SPOTS] : VALUE_SPOTS) {
      const at = Math.max(half, Math.min(1 - half, share));
      if (!spots.some((p) => Math.abs(p.at - at) < 0.02)) spots.push({ at, xy: textBeside(lane, w + 4, h, 1, at) });
    }
    // Last resort for a focus value: the same places on the lane's other side, tried only if its own side would cover a
    // focus label (A4s); a short lane running along the label has no free spot on its own side.
    if (extra.path) {
      const flipped = { ...lane, nx: -lane.nx, ny: -lane.ny };
      for (const p of [...spots]) spots.push({ at: p.at, xy: textBeside(flipped, w + 4, h, 1, p.at) });
      // Still no free place (a short lane running along the label of a hub): past either end of the lane, still beside its
      // line (A4t: with wider density factors the test sample hit this on Coordinator 0 > 7).
      for (const at of [1.25, 1.6, -0.25, -0.6]) for (const l of [lane, flipped]) spots.push({ at, xy: textBeside(l, w + 4, h, 1, at) });
    }
    const t = { lines: [texts.rx, text], x: spots[0].xy[0], y: spots[0].xy[1], w, h, spots: spots.map((p) => p.xy),
      ...extra };
    laneTexts.push(t);
    return t;
  };
  const count = (cls, assumed, predicted = false) => {
    classes[cls || "none"]++;
    if (assumed) classes.assumed++;
    if (predicted) classes.predicted++;
    order.push(cls || "none");
  };
  const rank = (cls) => (cls ? CLASSES.indexOf(cls) + 1 : 0);
  /** A focus hop's rank: a hop only a computed route discovery takes sits just below the routes a table proves. */
  const hopRank = (hop) => rank(hop.cls) - (hop.predicted ? 0.5 : 0);
  const skip = new Set(pathHops.map((hop) => `${hop.s}>${hop.h}`)); // directions the focus layer draws itself
  const glyphAt = (s, h, dir, a) => {
    const lane = laneGeometry(sx[s], sy[s], sx[h], sy[h], size, size, offset);
    if (lane) glyphs.push({ text: unknownGlyph(dir && dir.reason), x: lane.mx, y: lane.my, alpha: a });
  };
  if (!selecting || debug) {
    const items = [];
    const ordered = scene.lanes.filter((lane) => !skip.has(lane.key) && segmentVisible(lane.s, lane.h))
      .map((lane) => ({ lane, o: overview(lane) })).filter(({ o }) => o)
      .sort((p, q) => hopRank(p.o) - hopRank(q.o) || p.lane.index - q.lane.index);
    for (const { lane, o } of ordered) {
      const { cls, predicted } = o;
      const dir = lane.dir;
      const state = dir && (dir.state === "measured" || dir.state === "implied") ? dir.state : "unknown";
      if (!cls && state === "unknown") { // debug mode only: a direction without a reading gets its glyph
        glyphAt(lane.s, lane.h, dir, alpha);
        pairsDrawn.add(lane.pair);
        continue;
      }
      const geo = laneGeometry(sx[lane.s], sy[lane.s], sx[lane.h], sy[lane.h], size, size, offset);
      if (!geo) continue;
      const assumed = cls === "down" && sc.assumed[lane.index];
      const style = laneStyle(cls, dir.rating, theme, { colored, assumed, state, predicted });
      items.push({ lane: geo, style, key: styleKey(style), rank: hopRank(o) });
      count(cls, assumed, predicted);
      pairsDrawn.add(lane.pair);
      if (!debug) continue; // values beside every lane in debug mode; otherwise only on the focus's lanes
      let text = laneValue(dir, texts);
      if (state === "measured") text += ` \u2190 ${scene.nodes[lane.h].label}`;
      addValue(geo, text, { path: false, alpha });
    }
    ctx.globalAlpha = alpha;
    lanes += strokeLanes(ctx, items.sort(byRankAndStyle), true);
  }

  // The focus's lanes: each directed hop once, on the lane of its direction of travel, with the reception at its
  // hearer; an incomplete path ends in a dashed stem towards its goal with "?" (unknown beats wrong).
  const pathValues = [];
  const ends = [];
  if (route) {
    ctx.globalAlpha = 1;
    // The selection's way up as a band under its lanes; hover previews without it.
    if (selecting) drawBand(ctx, scene.upPaths[view.selected], sx, sy, theme);
    const items = [];
    const hops = [...pathHops].sort((p, q) => hopRank(p) - hopRank(q));
    for (const hop of hops) {
      const { s, h, dir, cls, assumed, predicted } = hop;
      if (!segmentVisible(s, h)) continue;
      const lane = laneGeometry(sx[s], sy[s], sx[h], sy[h], size, size, offset);
      if (!lane) continue;
      const state = dir && (dir.state === "measured" || dir.state === "implied") ? dir.state : "unknown";
      const style = laneStyle(cls, dir.rating, theme, { colored, assumed, state, predicted });
      items.push({ lane, style, key: styleKey(style), rank: hopRank(hop) });
      count(cls, assumed, predicted);
      let text = laneValue(dir, texts);
      if (debug && state === "measured") text += ` \u2190 ${scene.nodes[h].label}`;
      const t = addValue(lane, text, { path: true, alpha: 1 });
      pathValues.push({ s, h, text, cls, predicted: Boolean(predicted), rank: hopRank(hop), drawn: false, ref: t });
    }
    lanes += strokeLanes(ctx, items.sort(byRankAndStyle), true);
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

  // Text, in order of importance. A label block tries its places around its device and is left out if all would
  // cover another device or text already placed (the details list everything); the coordinator and the focus are
  // always labelled, in the first place if nothing else is free. Order: coordinator and focus, the reception at the
  // hops of the focus's paths, "?" and "path unknown" at their unknown ends, the other devices on the paths,
  // everyone else from LABEL_SCALE up, values on other lanes (debug).
  ctx.globalAlpha = 1;
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const placed = obstacles; // labels become obstacles for later labels
  // The type line shows from the working scale up (A4h review, Fabian Schwamborn, 2026-11-01): the overview stays calm.
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
  // Label boxes of the focus devices (selected, hovered): no value may cover them (A4s). Values yield to them only.
  const protectedRects = [];
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
    if (!spot) spot = options[0];
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
  const value = (t) => {
    let rect = null;
    // The focus's values sit at their preferred place whatever is there (board M11 rule 8, owner decision 2026-11-01:
    // "every value at its place, overlap accepted"); only the debug overview's values look for a free spot.
    // A focus value keeps off the focus labels (A4s): the next spot on its lane, else the one covering least of them.
    let least = Infinity;
    for (const [x, y] of t.spots) {
      const r = { x: x - t.w / 2 - 2, y: y - t.h / 2, w: t.w + 4, h: t.h };
      if (t.path) {
        const area = protectedRects.reduce((sum, q) => sum + overlapArea(r, q), 0);
        if (area >= least) continue;
        least = area;
        rect = r;
        t.x = x;
        t.y = y;
        if (area === 0) break;
        continue;
      }
      if (placed.hits(r)) continue;
      rect = r;
      t.x = x;
      t.y = y;
      break;
    }
    if (!rect) return false;
    placed.add(rect);
    ctx.globalAlpha = t.alpha;
    haloText(ctx, t.lines[0], t.x, t.y - LINE_HEIGHT / 2, theme, theme.muted);
    haloText(ctx, t.lines[1], t.x, t.y + LINE_HEIGHT / 2, theme);
    ctx.globalAlpha = 1;
    values++;
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
  const always = [];
  for (let i = 0; i < n; i++) if (scene.nodes[i].role === "coordinator" && !focusSet.has(i)) always.push(i);
  for (const i of [...focus, ...always]) label(i, true);
  // Values of the way up and down claim their places first, then routes, then computed hops, then heard only: the
  // drawing order puts the weakest first, the room for text goes to the strongest; where there is no room the weaker
  // gives way, and Details list it.
  for (const pv of [...pathValues].sort((p, q) => q.rank - p.rank)) if (pv.ref) pv.drawn = value(pv.ref);
  for (const e of ends) endText(e);
  // A device on the focus's paths is always labelled (A4m, owner report 2026-11-01: Router 17 lost its label in a hub
  // position where lane values had taken every place): the values were placed first, so the block takes its first
  // place over them if none is free ("overlap is accepted", 7.1); only the rest of the map yields.
  for (const i of near) if (!focusSet.has(i) && !always.includes(i)) label(i, true);
  if (labelsForAll(k, view.labelZoom)) {
    const rank = { coordinator: 0, "border router": 1, router: 2, unknown: 3, "end device": 4 };
    const rest = [];
    for (let i = 0; i < n; i++) if (!near.has(i) && !always.includes(i)) rest.push(i);
    rest.sort((a, b) => rank[scene.nodes[a].role] - rank[scene.nodes[b].role] || a - b);
    for (const i of rest) label(i, false);
  }
  for (const t of laneTexts) if (!t.path) value(t);

  // Bottom left: the top corners carry the panel's buttons.
  if (view.debug && typeof view.fps === "number") {
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    haloText(ctx, `${Math.round(view.fps)} fps`, 8, height - 8, theme);
  }
  const paths = route ? { hops: pathHops.length, ends: ends.length,
    values: pathValues.map(({ s, h, text, cls, predicted, ref, drawn: shownValue }) => ({ s, h, text, cls, predicted,
      x: ref ? ref.x : null, y: ref ? ref.y : null, w: ref ? ref.w + 4 : null, height: ref ? ref.h : null,
      drawn: shownValue })) } : null;
  return { sx, sy, lines: pairsDrawn.size, lanes, glyphs: glyphs.length, values, labels: shown, dropped, classes, order,
    symbols, size, paths };
}
