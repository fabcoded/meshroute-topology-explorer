// SPDX-License-Identifier: MIT
// What a Thread map draws (spec 3.2, 4.6, 7.1): the overview draws every lane with a class, parent links solid
// ("parent", the end device's lane to its parent above the parent's lane back) and measured neighbours dashed
// ("neighbour"); debug mode every lane. A click on a device with a route (routes.js, from the Matter cache's tables)
// shows its route to the default border router there and back, each hop with what its receiver hears (RSSI over
// LQI), hop numbers on the way there, the weakest hop per direction marked below LQI 3, a derived hop dash-dot; every other lane
// stays in grey with its value (board M40 A), and the View option "unused routes" adds the alternatives the routers
// hold but do not use, dash-dot in grey. Without a route a click shows the device's own lanes with their values and the glyph
// of each own direction without a reading. The shared renderer (graph/renderer.js) strokes the looks.
// Pure. npm test
import { classifyLanes } from "./lanes.js";
import { markedWeak } from "./routes.js";
import { TEXTS } from "./texts.js";

/** Counters of the drawn lanes per class (graph/renderer.js drawScene stats). */
export const CLASSES = Object.freeze(["neighbour", "parent", "route", "context", "unused"]);

/** The look of a lane of class `cls` ("parent", "neighbour" or null); rank orders the drawing, the end device's lane to
 *  its parent on top. */
function look(cls, toParent = false) {
  if (cls === "parent") {
    return { cls, stroke: "solid", weight: "strong", rank: toParent ? 4 : 3, assumed: false, predicted: false };
  }
  if (cls === "neighbour") return { cls, stroke: "dashed", weight: "thin", rank: 1, assumed: false, predicted: false };
  return { cls: null, stroke: "faint", weight: "faint", rank: 0, assumed: false, predicted: false };
}

/** Pairs and lanes from the network (shared renderer, buildScene): the meaning of each lane is { toParent,
 *  fromParent }. */
export function lanes(network) {
  const c = classifyLanes(network);
  return { pairs: c.pairs, lanes: c.lanes.map(({ pair, sender, hearer, dir, toParent, fromParent }) =>
    ({ pair, sender, hearer, dir, meaning: { toParent, fromParent } })) };
}

/** The class of every lane, once per scene (idempotent): parent where it is a parent link, neighbour where the
 *  direction was measured, else none. */
export function classify(scene) {
  if (scene.classes) return scene;
  scene.classes = scene.lanes.map((l) => (l.toParent || l.fromParent ? "parent"
    : l.dir && l.dir.state === "measured" ? "neighbour" : null));
  scene.lookCache = new Map();
  return scene;
}

/** Devices always labelled, the anchors of a Thread map: the leader
 *  and the border routers. */
export function anchors(scene) {
  const out = [];
  for (let i = 0; i < scene.nodes.length; i++) {
    const device = scene.network.devices[i];
    if (scene.nodes[i].role === "border router" || (device && device.leader === true)) out.push(i);
  }
  return out;
}

const LABEL_RANK = Object.freeze({ "border router": 1, router: 2, unknown: 3, "end device": 4 });
/** Label order of everyone else: border routers, routers, unknown, end devices. */
export function labelRank(node) {
  return LABEL_RANK[node.role] ?? 3;
}

/** How the fitted view frames a Thread map: "contain", every device and its label inside the window at the active
 *  density (a network of a few devices, each an extreme of its box, would otherwise reach
 *  past the window at medium density). */
export const FIT = "contain";

/** Cache key of the engine's overview: only debug mode changes it (the option "unused routes" changes the focus). */
export function viewKey(view) {
  return view && view.debug ? "debug" : "plain";
}

/** Per lane its look in the overview, or null: every lane with a class; in debug mode every lane. */
export function overview(scene, view) {
  classify(scene);
  const key = viewKey(view);
  if (!scene.lookCache.has(key)) {
    const debug = key === "debug";
    scene.lookCache.set(key, scene.lanes.map((l, i) => (debug || scene.classes[i]
      ? look(scene.classes[i], l.toParent) : null)));
  }
  return scene.lookCache.get(key);
}

/** The focus of device i. Selected with a route (view.selected === i): routeFocus. Otherwise its own lanes, each
 *  with its class and value, and the glyph of each own direction without a reading (the renderer draws them on
 *  click). { hops: [{ s, h, dir, cls, stroke, rank, assumed, predicted }], ends: [], glyphs: [{ s, h, dir }], nodes:
 *  Set (i and its partners), band: null }. */
export function focus(scene, i, view = {}) {
  classify(scene);
  const routing = scene.network.routing;
  const r = routing && view.selected === i ? routing.defaultRoute(scene.nodes[i].id) : null;
  if (r) return routeFocus(scene, i, r, view);
  const hops = [];
  const glyphs = [];
  const nodes = new Set([i]);
  for (const pair of scene.pairs) {
    if (pair.a !== i && pair.b !== i) continue;
    nodes.add(pair.a);
    nodes.add(pair.b);
    for (const li of pair.lanes) {
      const lane = scene.lanes[li];
      if (!scene.classes[li]) glyphs.push({ s: lane.s, h: lane.h, dir: lane.dir });
      else hops.push({ s: lane.s, h: lane.h, dir: lane.dir, ...look(scene.classes[li], lane.toParent) });
    }
  }
  return { hops, ends: [], glyphs, nodes, band: null };
}

/** Two numbers of a hop as its receiver hears it: RSSI over LQI, "– dBm" where no RSSI was read (board M38). */
export function hopText(x) {
  const rssi = typeof x.rssi === "number" ? `${String(x.rssi).replace("-", "−")} dBm` : "– dBm";
  return `${rssi}\nLQI ${typeof x.lqi === "number" ? x.lqi : "?"}`;
}

/** The selection's route (routes.js route) on the map: there and back, each hop on the lane of its direction with
 *  its two numbers, the way there numbered, the weakest hop of each direction marked (weak), a derived hop dash-dot
 *  (assumed); a route that stops ends in a stem towards its goal. Every other lane with a reading keeps its value in
 *  grey (cls "context", board M40 A); with view.unusedRoutes each route hop's unused alternative is drawn dashed
 *  with its cost (cls "unused"). Every device stays undimmed; `separate` asks the renderer to keep every value apart. */
export function routeFocus(scene, i, r, view = {}) {
  const at = (id) => scene.index.get(id);
  const hops = [];
  const used = new Set();
  const add = (x, extra) => {
    const s = at(x.from);
    const h = at(x.to);
    if (s === undefined || h === undefined) return;
    used.add(`${s}>${h}`);
    const dir = { state: x.lqi !== null || x.rssi !== null ? "measured" : "unknown", lqi: x.lqi, rssi: x.rssi,
      rating: null, reason: null };
    hops.push({ s, h, dir, cls: "route", stroke: x.derived ? "dashdot" : "solid", weight: "strong", rank: 5,
      assumed: x.derived, predicted: false, text: hopText(x), ...extra });
  };
  r.there.hops.forEach((x, k) => add(x, { number: k + 1, weak: k === r.there.weakest && markedWeak(x) }));
  if (r.back) r.back.hops.forEach((x, k) => add(x, { weak: k === r.back.weakest && markedWeak(x) }));
  if (view.unusedRoutes) {
    for (const x of [...r.there.hops, ...(r.back ? r.back.hops : [])]) {
      const alt = x.alternative;
      const s = at(x.from);
      const h = alt && at(alt.via);
      if (!alt || s === undefined || h === undefined || used.has(`${s}>${h}`)) continue;
      used.add(`${s}>${h}`);
      const lane = scene.laneByKey.get(`${s}>${h}`);
      hops.push({ s, h, dir: lane ? lane.dir : { state: "unknown", rating: null, reason: null }, cls: "unused",
        stroke: "dashdot-muted", weight: "regular", rank: 2, assumed: false, predicted: false, muted: true,
        text: TEXTS["lane.unused_cost"].replace("{cost}", String(alt.cost)) });
    }
  }
  for (const lane of scene.lanes) {
    if (used.has(lane.key) || !lane.dir || lane.dir.state !== "measured") continue;
    hops.push({ s: lane.s, h: lane.h, dir: lane.dir, cls: "context", stroke: "solid", weight: "thin", rank: 0,
      assumed: false, predicted: false, muted: true, context: true, text: hopText(lane.dir) });
  }
  const ends = [];
  const goal = at(r.to);
  if (!r.there.complete && at(r.there.at) !== undefined && goal !== undefined) {
    ends.push({ at: at(r.there.at), toward: goal, cls: "route" });
  } else if (r.back && !r.back.complete && at(r.back.at) !== undefined) {
    ends.push({ at: at(r.back.at), toward: i, cls: "route" });
  }
  // separate: every value of the route readable (owner, board M38): the renderer keeps them apart from each other and
  // from the hop numbers.
  return { hops, ends, glyphs: [], nodes: new Set(scene.nodes.map((n, k) => k)), band: null, separate: true };
}
