// SPDX-License-Identifier: MIT
// How the quality view draws links (spec 7.1, 8; decisions by Fabian Schwamborn, 2026-10-31 and 2026-11-01, boards
// M2, M7, M11): every pair as two lanes, one per direction (sender -> hearer), each on the right of its own direction
// of travel, with an arrowhead at the hearer. Classes belong to a lane, not to a pair: "up" (the hearer is the
// sender's next hop on the sender's way to the coordinator), "down" (the lane lies on the coordinator's way to a
// device, measured from the tables or assumed as the reversed way up, model/source-routes.js), "route" (on an active
// route between two devices, neither of them the coordinator) and "heard" (a reading, no traffic). A lane can carry
// several; it is drawn as its strongest. "Communication paths" says what is drawn: the stage "coordinator" (default)
// shows the up and down lanes of all devices and, on click, only the device's way up and down; "all" adds, on click,
// the device's paths to and from other devices; the option "heard only" adds, on click, heard-only lanes (the
// device's 3 best partners). Hover previews within the stage; debug mode draws every lane. Line styles carry no colour: up and
// down solid, assumed down dotted, routes between devices dash-dot, heard only dashed grey; width follows the lane's
// own rating. A direction without a reading has no lane but a glyph: "–" when the hearer's table does not list the
// sender, "?" when there is no table to ask. Opt-in: lanes coloured by reception, red to green.
// Pure functions: classification from the data model's pairs, routes and paths; geometry; styles; legend data.
// node --test tests/

import { computePairs } from "../model/pairs.js";
import { downPath, routePath, upPath } from "../model/paths.js";
import { assumedDownPaths, drawMode, returnPaths, zigpyRecords } from "../model/source-routes.js";
import { isActive } from "../model/normalize.js";
import { SYMBOL_SIZE, contourExit } from "./symbols.js";
import { receptionColor } from "./palette.js";

/** "Communication paths" (spec 7.1, 9.1, 11; decision by Fabian Schwamborn, 2026-11-01, board M11): two stages, the
 *  second containing the first; "heard only" is a separate option (checkbox) on top of either. */
export const PATH_STAGES = Object.freeze(["coordinator", "all"]);
export const DEFAULT_PATHS = "coordinator";

/** A stored or passed stage as one of PATH_STAGES; anything else is the default. */
export function pathStage(value) {
  return PATH_STAGES.includes(value) ? value : DEFAULT_PATHS;
}

/** Lane classes in drawing order: the more a lane carries, the later (higher) it is drawn. */
export const CLASSES = Object.freeze(["heard", "route", "down", "up"]);
/** Heard-only partners shown per device: its best by the pair's best rating at the hearer (decision 2026-10-31). */
export const BEST_HEARD = 3;

/** The class of a lane under a source-route stage (model/source-routes.js), the strongest it carries: up or a
 *  measured down lane, then a return path of the stage (assumed under "assume"; recorded by zigpy or else assumed
 *  under "zigpy"), then a route between devices, then heard (a reading without traffic); null for a lane that carries
 *  nothing and has no reading (only a route or a parent link implies it, or nothing does). */
export function laneClass(lane, sourceRoute = "off") {
  if (lane.up) return "up";
  if (lane.downMeasured) return "down";
  const stage = drawMode(sourceRoute);
  if (lane.downAssumed && stage === "assume") return "down";
  if ((lane.downRecorded || lane.downZigpyAssumed) && stage === "zigpy") return "down";
  if (lane.route) return "route";
  return lane.dir && lane.dir.state === "measured" ? "heard" : null;
}

/** Whether a lane of class `cls` carries traffic of the stage's overview (spec 7.1; decisions by Fabian Schwamborn,
 *  2026-11-01): up and down always; from the stage "all" on the backbone, every lane a theoretical path between two
 *  devices uses (backbone: the lane is one), drawn as a route; heard only never without a selection (the option adds its
 *  partners on click); everything in debug mode. */
export function overviewShows(cls, stage, { backbone = false, debug = false } = {}) {
  if (debug) return true;
  if (cls === "up" || cls === "down") return true;
  return cls === "route" && backbone && pathStage(stage) !== "coordinator";
}

/** Whether a network has routes with a next hop (spec 4.6): ZHA yes; Thread through Matter no (model/thread.js), so
 *  there are no paths, no stages and no theoretical paths, and the overview draws every measured neighbour lane. */
export function hasRoutes(network) {
  return !(network && network.capabilities && network.capabilities.routes === false);
}

/** Distance of a lane from the pair's centre line at zoom 1, CSS pixels; grows with the symbols, lanes stay at least
 *  2 px apart. */
export const LANE_OFFSET = 3;
/** Room between a lane's end (or its arrowhead's tip) and the symbol's contour, CSS pixels: the tip stays readable
 *  against the frame. Own choice. */
export const LANE_GAP = 1;
/** The selected device's up path: a band in the foreground colour under its lanes (decision 2026-10-31; kept in A4j
 *  by the main session, 2026-11-01: in the stage "all" it tells the way to the coordinator apart). */
export const BAND = Object.freeze({ alpha: 0.18, width: 7 });
/** Opacity of everything that does not touch the selection or the device under the pointer. */
export const DIM = 0.2;
/** Where a lane's value sits, as a share of the lane from the sender: a quarter before the hearer, the device the value
 *  belongs to (decision by Fabian Schwamborn, 2026-11-01). */
export const VALUE_AT = 0.75;
/** An incomplete path's end: a dashed stem this long at zoom 1 (CSS pixels, grows with the symbols, at most this share
 *  of the way to the goal), then "?". Own choice: long enough to point, short enough not to read as a link. */
export const STEM = Object.freeze({ length: 30, share: 0.45, width: 1.5, dash: Object.freeze([3, 3]) });
/** Rating limits of the three lane widths. */
export const WIDTH_STEPS = Object.freeze([1 / 3, 2 / 3]);
/** Lane widths per class and width step (CSS pixels): up and down strongest, heard only thinnest. Own choice. */
export const WIDTHS = Object.freeze({
  up: Object.freeze([1.5, 2.25, 3]),
  down: Object.freeze([1.5, 2.25, 3]),
  route: Object.freeze([1.25, 1.75, 2.25]),
  heard: Object.freeze([0.75, 1, 1.4]),
  implied: Object.freeze([1, 1, 1]),
});
/** Dash patterns (CSS pixels) of board M11: routes between devices dash-dot, heard only dashed. Assumed down lanes
 *  are sparse round dots, a dash of almost nothing with round caps, so they stay dots at every width. */
export const DASH = Object.freeze({ route: Object.freeze([6, 3, 1.5, 3]), heard: Object.freeze([6, 3]),
  assumedGap: 6 });

/** Width step 0..2 of a rating (0..1); an unrated reading gets the thinnest. */
export function widthStep(rating) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return 0;
  return rating < WIDTH_STEPS[0] ? 0 : rating < WIDTH_STEPS[1] ? 1 : 2;
}

/** Stroke style of a lane: { color, width, dash, cap, head }. cls: one of CLASSES, or null for a lane without traffic
 *  and without a reading (debug mode only: thin dotted grey, no head). The class sets the dash: up and down solid,
 *  assumed down sparse dots (never drawn as measured, whatever the hearer reports; decision by Fabian Schwamborn,
 *  2026-11-01), routes between devices dash-dot, heard only dashed grey; the lane's own rating sets the width.
 *  state "unknown" (a path hop nothing proves) keeps the class's dash in grey at the thinnest width. colored: "colour
 *  by reception" is on, so a rated lane takes its rating's colour (palette.js receptionColor); dash and width stay, so
 *  the class still reads without colour. predicted: a route hop that only a computed route discovery takes (spec 5.7;
 *  decision by the main session, 2026-11-01): the same dash-dot in the lighter grey, never coloured, so a computed
 *  hop never looks like one a table proves. */
export function laneStyle(cls, rating, theme,
  { colored = false, assumed = false, state = "measured", predicted = false } = {}) {
  if (!cls) return { color: theme.muted, width: WIDTHS.implied[0], dash: [0.01, 3], cap: "round", head: false };
  const unknown = state === "unknown";
  const width = WIDTHS[cls][unknown ? 0 : widthStep(rating)];
  const tint = (fallback) => (unknown ? theme.muted : (colored && receptionColor(rating, theme)) || fallback);
  if (cls === "route" && predicted) return { color: theme.muted, width, dash: [...DASH.route], cap: "butt", head: true };
  if (cls === "down" && assumed) {
    const w = WIDTHS.route[1];
    return { color: unknown ? theme.muted : theme.foreground, width: w, dash: [0.01, w + DASH.assumedGap], cap: "round",
      head: true };
  }
  if (cls === "up" || cls === "down") {
    return { color: tint(theme.foreground), width, dash: [], cap: "butt", head: true };
  }
  if (cls === "route") return { color: tint(theme.foreground), width, dash: [...DASH.route], cap: "butt", head: true };
  return { color: tint(theme.muted), width, dash: [...DASH.heard], cap: "butt", head: true };
}

/** Glyph for a direction without a reading (spec 4.3 reasons): "–" when the hearer has a table that does not list the
 *  sender (full, nearly full, with space, capacity unknown); "?" when there is no table to ask (end device, missing or
 *  stale table) or the table says LQI 0 (unmeasured or very weak). */
export function unknownGlyph(reason) {
  // Thread (model/thread.js): "not in the neighbour table" means the hearer's table was read and does not list it.
  const listedNot = /^(table (full|nearly full|has space)|capacity unknown|not in the neighbour table)/;
  return typeof reason === "string" && listedNot.test(reason) ? "–" : "?";
}

const laneKey = (sender, hearer) => `${sender}>${hearer}`;

/** Directed hops "sender>hearer" of a walk's ids into `set`. */
function addHops(set, ids) {
  for (let i = 0; i + 1 < ids.length; i++) set.add(laneKey(ids[i], ids[i + 1]));
}

/** Pairs and lanes of a network with what each lane carries, and every device's up path. Uses the model's pairs when
 *  the network carries them (buildNetwork does); otherwise computes them from devices, readings and routes, treating
 *  a reading without a `measured` flag as measured when its LQI is above 0. Returns { pairs: [{ a, b, ab, ba }],
 *  lanes: [{ pair, sender, hearer, dir, up, downMeasured, downAssumed, downRecorded, downZigpyAssumed, route }],
 *  upPaths: Map, network } with two lanes
 *  per pair (first b -> a, whose evidence is ab: a hears b; then a -> b) and `network` the cleaned devices, routes and
 *  pairs that the selection's paths are walked on. What a lane carries (spec 7.1):
 *  - up: a hop of a device's way to the coordinator (model/paths.js upPath);
 *  - downMeasured: a hop of the coordinator's way to a device (downPath), incomplete walks up to where they stop;
 *  - downAssumed: a hop of an assumed return path (source route, model/source-routes.js), counted only under "assume";
 *  - downRecorded: a hop of a return path from zigpy's route record, drawn as measured, only under "zigpy";
 *  - downZigpyAssumed: a hop of an assumed return path of a device without a record, only under "zigpy";
 *  - route: a hop of the walk of an active, current route whose owner and destination are not the coordinator. */
export function classifyLanes(network) {
  const devices = (network.devices || []).filter((d) => d && typeof d.id === "string")
    .map((d) => (typeof d.available === "boolean" ? d : { ...d, available: d.available !== false }));
  const known = new Set(devices.map((d) => d.id));
  const routes = (Array.isArray(network.routes) ? network.routes : [])
    .filter((r) => r && known.has(r.owner) && known.has(r.nextHop) && known.has(r.destination));
  const net = { ...network, devices, routes };
  let pairs = network.pairs;
  if (!Array.isArray(pairs)) {
    const readings = (network.readings || [])
      .filter((r) => r && known.has(r.reporter) && known.has(r.subject) && r.reporter !== r.subject)
      .map((r) => ({ ...r,
        measured: typeof r.measured === "boolean" ? r.measured : typeof r.lqi === "number" && r.lqi > 0 }));
    pairs = computePairs({ devices, readings, routes });
  }
  const coordinator = (devices.find((d) => d.role === "coordinator") || {}).id || null;
  const upPaths = new Map();
  const up = new Set();
  const down = new Set();
  if (!hasRoutes(network)) {
    // Thread (spec 3.2, 4.6): no routes, no coordinator. The only traffic the data names is a parent link: the end
    // device sends to its parent (drawn like "up") and the parent delivers to it ("down"); no up path, no band.
    const available = new Set(devices.filter((d) => d.available).map((d) => d.id));
    for (const d of devices) {
      upPaths.set(d.id, []);
      if (d.role !== "end device" || !d.parent || !available.has(d.id) || !available.has(d.parent)) continue;
      up.add(laneKey(d.id, d.parent));
      down.add(laneKey(d.parent, d.id));
    }
  } else for (const d of devices) {
    const { ids } = upPath(net, d.id);
    upPaths.set(d.id, ids);
    addHops(up, ids);
    if (d.id !== coordinator) addHops(down, downPath(net, d.id).ids);
  }
  const assumed = new Set();
  for (const walk of assumedDownPaths(net).values()) addHops(assumed, walk.ids);
  const recorded = new Set();
  for (const walk of zigpyRecords(net).paths.values()) addHops(recorded, walk.ids);
  const zigpyAssumed = new Set();
  for (const walk of returnPaths(net, "zigpy").values()) if (walk.assumed) addHops(zigpyAssumed, walk.ids);
  const route = new Set();
  const walked = new Set();
  for (const r of routes) {
    if (r.stale || !isActive(r.status) || r.owner === r.destination) continue;
    if (r.owner === coordinator || r.destination === coordinator) continue;
    const k = laneKey(r.owner, r.destination);
    if (walked.has(k)) continue;
    walked.add(k);
    addHops(route, routePath(net, r.owner, r.destination).ids);
  }
  const valid = pairs.filter((p) => known.has(p.a) && known.has(p.b));
  const lanes = [];
  valid.forEach((p, pair) => {
    for (const [sender, hearer, dir] of [[p.b, p.a, p.ab], [p.a, p.b, p.ba]]) {
      const k = laneKey(sender, hearer);
      lanes.push({ pair, sender, hearer, dir, up: up.has(k), downMeasured: down.has(k), downAssumed: assumed.has(k),
        downRecorded: recorded.has(k), downZigpyAssumed: zigpyAssumed.has(k), route: route.has(k) });
    }
  });
  return { pairs: valid, lanes, upPaths, network: { ...net, pairs: valid } };
}

/** Geometry of one lane from sender (x1, y1) to hearer (x2, y2) on screen: shifted by `offset` to the right of the
 *  direction of travel (y points down, so the right-hand normal of (ux, uy) is (-uy, ux)) and shortened to the
 *  symbols' contours (rounded squares of sizes s1, s2, symbols.js) plus LANE_GAP. Returns { x0, y0, x1, y1, ux, uy,
 *  nx, ny, mx, my, len } or null if the symbols leave no room. (mx, my) is the middle of the lane. */
export function laneGeometry(x1, y1, x2, y2, s1, s2, offset) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (!(d > 0)) return null;
  const ux = dx / d;
  const uy = dy / d;
  const nx = -uy;
  const ny = ux;
  // The shifted line leaves the sender's contour going forwards and meets the hearer's coming in, i.e. leaving it
  // backwards; both measured from the foot of the line beside each centre.
  const a = contourExit(nx * offset, ny * offset, ux, uy, s1) + LANE_GAP;
  const b = contourExit(nx * offset, ny * offset, -ux, -uy, s2) + LANE_GAP;
  const len = d - a - b;
  if (len < 4) return null;
  const x0 = x1 + ux * a + nx * offset;
  const y0 = y1 + uy * a + ny * offset;
  const x1e = x0 + ux * len;
  const y1e = y0 + uy * len;
  return { x0, y0, x1: x1e, y1: y1e, ux, uy, nx, ny, mx: (x0 + x1e) / 2, my: (y0 + y1e) / 2, len };
}

/** Centre for a text of size w × h beside a lane, on its right side, clear of the stroke, at share `at` of the lane
 *  from the sender (the middle by default; lane values use VALUE_AT, a quarter before the hearer). */
export function textBeside(lane, w, h, gap = 2, at = 0.5) {
  const reach = Math.abs(lane.nx) * (w / 2) + Math.abs(lane.ny) * (h / 2) + gap;
  const px = lane.x0 + lane.ux * lane.len * at;
  const py = lane.y0 + lane.uy * lane.len * at;
  return [px + lane.nx * reach, py + lane.ny * reach];
}

/** The dashed stem of an incomplete path from the device where its walk stopped towards its goal (screen positions),
 *  on the right of that direction like a lane: { x0, y0, x1, y1, gx, gy } with (gx, gy) the place of its "?", or
 *  null when the two sit on each other. */
export function stemGeometry(x1, y1, x2, y2, size, offset) {
  const lane = laneGeometry(x1, y1, x2, y2, size, size, offset);
  if (!lane) return null;
  const len = Math.max(4, Math.min((STEM.length * size) / SYMBOL_SIZE, lane.len * STEM.share));
  const ex = lane.x0 + lane.ux * len;
  const ey = lane.y0 + lane.uy * len;
  return { x0: lane.x0, y0: lane.y0, x1: ex, y1: ey, gx: ex + lane.ux * 6, gy: ey + lane.uy * 6, ux: lane.ux,
    uy: lane.uy };
}

/** What the legend explains, for the panel to draw with its own words (ids are stable keys for translations; board
 *  M7): every path class whatever the stage (decision by Fabian Schwamborn, 2026-11-01), each with its stroke sample:
 *  there and back with the coordinator (up and down share one row), the assumed return path, paths to other devices
 *  and the computed route discovery (stage 2, the latter marked computed), heard only (the option, needs a selection);
 *  the band under a selected device's way up; the glyphs for directions without a reading where the option draws
 *  them (on click, debug); debug mode adds the lane without traffic or reading, the width steps and the unknown end; "RX:" at
 *  the hearer, and with colored the reception scale. */
export function legendEntries(theme, { debug = false, colored = false, heard = false, routes = true } = {}) {
  const sample = (cls, opts) => laneStyle(cls, 1, theme, opts);
  const glyphs = debug || heard;
  if (!routes) {
    // Thread (spec 3.2): what its map draws: parent links, measured neighbours, the glyphs a click shows, RX in dBm.
    return [
      { id: "parent", kind: "lane", style: sample("up") },
      { id: "neighbour", kind: "lane", style: sample("heard") },
      { id: "not-listed", kind: "glyph", text: "\u2013", color: theme.muted },
      { id: "no-table-thread", kind: "glyph", text: "?", color: theme.muted },
      { id: "rx-thread", kind: "rx" },
    ];
  }
  return [
    { id: "coordinator", kind: "lane", style: sample("up") },
    { id: "assumed", kind: "lane", style: sample("down", { assumed: true }) },
    { id: "route", kind: "lane", style: sample("route"), stage: 2 },
    { id: "discovery", kind: "lane", style: sample("route", { predicted: true }), stage: 2, computed: true },
    { id: "heard", kind: "lane", style: sample("heard"), option: "heard" },
    { id: "up-path", kind: "band", color: theme.foreground, alpha: BAND.alpha, width: BAND.width },
    ...(debug ? [{ id: "implied", kind: "lane", style: laneStyle(null, null, theme) },
      { id: "width", kind: "width", steps: [...WIDTH_STEPS], widths: [...WIDTHS.up], color: theme.foreground }] : []),
    ...(glyphs ? [{ id: "not-listed", kind: "glyph", text: "\u2013", color: theme.muted },
      { id: "no-table", kind: "glyph", text: "?", color: theme.muted }] : []),
    ...(debug ? [{ id: "path-end", kind: "stem", color: theme.foreground, width: STEM.width, dash: [...STEM.dash],
      text: "?" }] : []),
    { id: "rx", kind: "rx" },
    ...(colored ? [{ id: "reception", kind: "scale",
      colors: [0, 0.25, 0.5, 0.75, 1].map((r) => receptionColor(r, theme)) }] : []),
  ];
}
