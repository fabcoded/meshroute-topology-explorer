// SPDX-License-Identifier: MIT
// What a Zigbee map draws (spec 5.7, 7.1, 9.3; decisions by Fabian Schwamborn, 2026-11-01, board M11; engines cut,
// section 2). "Communication paths" says what is drawn: the view "coordinator" (default) shows the up and down lanes
// of all devices and, on click, only the device's way up and down; "table" every usable routing entry and, on click,
// the device's own entries walked hop by hop; "all" the backbone of every lane a theoretical path uses and, on click,
// the device's paths to and from every other device; the option "heard only" adds, on click, the device's 3 best
// heard-only partners. Hover previews within the view; debug mode draws every lane. The shared renderer
// (graph/renderer.js) strokes what overview() and focus() return; the scene keeps this engine's fields (lane flags
// from lanes.js classifyLanes, upPaths, coordinator, pathNet, caches).
// Pure. node --test tests/
import { BEST_HEARD, CLASSES, DEFAULT_PATHS, classifyLanes, laneClass, overviewShows, pathStage, strokeOf }
  from "./lanes.js";
import { nodePaths, unknownEnd } from "../../model/node-paths.js";
import { theoreticalLanes } from "../../model/theoretical.js";
import { usableRoutes } from "../../model/paths.js";
import { drawMode } from "../../model/source-routes.js";

export { CLASSES };

/** Pairs and lanes from the network (shared renderer, buildScene), each lane with what it carries: up, downMeasured,
 *  downAssumed and route (lanes.js classifyLanes); extra: every device's up path and the cleaned network its paths
 *  are walked on, for classify(). */
export function lanes(network) {
  const c = classifyLanes(network);
  return { pairs: c.pairs, lanes: c.lanes.map(({ pair, sender, hearer, dir, up, downMeasured, downAssumed, route }) =>
    ({ pair, sender, hearer, dir, meaning: { up, downMeasured, downAssumed, route } })),
  extra: { upPaths: c.upPaths, pathNet: c.network } };
}

/** The engine's fields of a scene, once (idempotent): every device's up path as node indices, the coordinator's
 *  index, the network the paths are walked on, and the caches of classes, paths and looks. extra: lanes()'s, or
 *  computed again from scene.network. */
export function classify(scene, extra = null) {
  if (scene.pathCache) return scene;
  const ex = extra || lanes(scene.network).extra;
  scene.upPaths = scene.nodes.map((n) => (ex.upPaths.get(n.id) || []).map((id) => scene.index.get(id))
    .filter((i) => i !== undefined));
  scene.coordinator = scene.nodes.findIndex((n) => n.role === "coordinator");
  scene.pathNet = ex.pathNet;
  scene.pathCache = new Map();
  scene.classCache = new Map();
  scene.lookCache = new Map();
  scene.backbone = null;
  scene.tableLanes = null;
  return scene;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Order of two pairs for the default view: higher rating first, then higher LQI; unknown last. */
const better = (r, s) => ((num(s.rating) ?? -1) - (num(r.rating) ?? -1)) || ((num(s.lqi) ?? -1) - (num(r.lqi) ?? -1));

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

/** The overview of the view "routing table" (spec 7.1; owner proposal 2026-11-01): per lane whether it is the hop of
 *  a usable routing entry, owner -> next hop, of any device (model/paths.js usableRoutes), computed once per scene.
 *  { table (per lane: boolean), count }. */
export function sceneTableLanes(scene) {
  if (scene.tableLanes) return scene.tableLanes;
  const table = scene.lanes.map(() => false);
  let count = 0;
  for (const r of scene.pathNet ? usableRoutes(scene.pathNet) : []) {
    const lane = scene.laneByKey.get(`${scene.index.get(r.owner)}>${scene.index.get(r.nextHop)}`);
    if (!lane || table[lane.index]) continue;
    table[lane.index] = true;
    count++;
  }
  scene.tableLanes = { table, count };
  return scene.tableLanes;
}

/** Classes of the scene's lanes under a source-route stage ("off", "assume" or "zigpy"), cached per scene: { cls (per
 *  lane, one of CLASSES or null), assumed (per lane: drawn as an assumed down lane; a lane of a recorded return path
 *  is drawn as measured), heardOnly (per pair: a reading in some
 *  direction and no up, down or route lane in either), rank (per pair: its best heard lane's reception, the rating
 *  at that lane's hearer, for ranking partners), counts (lanes per class, assumed counted apart as well) }. */
export function sceneClasses(scene, sourceRoute = "off") {
  const mode = drawMode(sourceRoute);
  if (scene.classCache.has(mode)) return scene.classCache.get(mode);
  const cls = scene.lanes.map((l) => laneClass(l, mode));
  const assumed = scene.lanes.map((l, i) => cls[i] === "down" && !l.downMeasured && !(mode === "zigpy" && l.downRecorded));
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

/** Whether a lane carries a reading (a measured direction): what "additional heard neighbours" draws. */
const measured = (lane) => Boolean(lane.dir && lane.dir.state === "measured");

/** The partners of device i for the option "additional heard neighbours (best 3)" (the one place to change the rule):
 *  pairs with a reading and no lane drawn between the two in the active view. "coordinator" and "all": pairs with a
 *  heard lane and no up, down or route lane (sc.heardOnly), in "all" also none of whose lanes the device's own
 *  theoretical paths (`hops`, keys "s>h") take. "table" (owner proposal 2026-11-01): pairs with a reading in either
 *  direction none of whose lanes the view's walks take; up and down lanes are not drawn there, so they do not count.
 *  The best BEST_HEARD by the reading's rating at its hearer. */
function heardPartners(scene, i, sc, hops, stage) {
  const taken = (pair) => stage !== "coordinator" && pair.lanes.some((li) => hops.has(scene.lanes[li].key));
  if (stage === "table") {
    const best = (p) => p.lanes.map((li) => scene.lanes[li]).filter(measured).map((l) => l.dir).sort(better)[0];
    return scene.pairs.filter((p) => (p.a === i || p.b === i) && p.lanes.some((li) => measured(scene.lanes[li]))
      && !taken(p)).sort((x, y) => better(best(x), best(y)) || x.index - y.index).slice(0, BEST_HEARD);
  }
  return scene.pairs.filter((p) => (p.a === i || p.b === i) && sc.heardOnly[p.index] && !taken(p))
    .sort((x, y) => better(sc.rank[x.index], sc.rank[y.index]) || x.index - y.index).slice(0, BEST_HEARD);
}

/** The lanes of node i in a stage of "Communication paths" (lanes.js PATH_STAGES), cached per scene: { hops: Map
 *  "s>h" -> { s, h, dir, cls, assumed, predicted } (each directed hop once, dir the reception at h with how the hop is
 *  taken, cls the class it is drawn with, predicted: only a computed route discovery takes it), ends: [{ at, toward,
 *  cls }] (incomplete paths, with the class of their path), glyphs: [{ s, h, dir }] (directions without a reading of
 *  the heard-only partners), nodes: Set of every device on a path, named as a goal or a partner, paths (the model's,
 *  for tests) }. "coordinator": the device's way up and down (model/node-paths.js); "all" adds its theoretical way to
 *  and from every other device as routes, the out tree and the in tree (spec 5.7); `heard` adds its best heard-only
 *  partners in both directions (all stages). A path to or from the coordinator is up or down (the coordinator's own view lists its
 *  routes). sourceRoute: "assume" draws assumed return paths (model/source-routes.js), "zigpy" recorded ones as
 *  measured and assumed ones for the rest, "off" leaves them unknown. */
export function scenePaths(scene, i, stage = DEFAULT_PATHS, sourceRoute = "off", heard = false, returns = false) {
  const mode = pathStage(stage);
  const sr = drawMode(sourceRoute);
  const back = mode === "table" && returns; // "Include return routes" belongs to the view "table" only
  const key = `${i}|${mode}|${sr}|${heard ? 1 : 0}|${back ? 1 : 0}`;
  if (scene.pathCache.has(key)) return scene.pathCache.get(key);
  const hops = new Map();
  const ends = [];
  const glyphs = [];
  const nodes = new Set([i]);
  const coordinator = scene.coordinator >= 0 ? scene.nodes[scene.coordinator].id : null;
  const paths = scene.pathNet
    ? nodePaths(scene.pathNet, scene.nodes[i].id, mode, { sourceRoute: sr, returns: back })
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
        // In "table" a measured lane of the pair is drawn as the reading it is, whatever else it carries elsewhere.
        if (mode === "table" ? measured(lane) : sc.cls[li] === "heard") {
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

/** A lane's rank in the drawing order: the more it carries, the later (higher) it is drawn; a hop only a computed
 *  route discovery takes sits just below the routes a table proves. */
const rankOf = (cls, predicted) => (cls ? CLASSES.indexOf(cls) + 1 : 0) - (predicted ? 0.5 : 0);

/** The look of a lane of class cls: { cls, stroke, rank, assumed, predicted }. */
function look(cls, assumed = false, predicted = false) {
  return { cls, stroke: strokeOf(cls, { assumed, predicted }), rank: rankOf(cls, predicted), assumed, predicted };
}

/** Cache key of this engine's view settings: the view of "Communication paths", the source-route stage, debug. */
export function viewKey(view) {
  return `${pathStage(view.paths)}|${drawMode(view.sourceRoute)}|${view.debug ? 1 : 0}`;
}

/** Per lane its look in the overview, or null where the view leaves it out (decisions by Fabian Schwamborn,
 *  2026-11-01): up and down lanes; from "all" on the backbone of theoretical paths as routes, lanes only a computed
 *  discovery takes lighter; in "table" the lane of every usable routing entry, as a route, and nothing else (its basis
 *  is the tables, not the ways to the coordinator); never heard-only lanes (the option adds partners on click); every
 *  lane in its own class in debug mode. Cached per viewKey. */
export function overview(scene, view) {
  classify(scene);
  const key = viewKey(view);
  if (scene.lookCache.has(key)) return scene.lookCache.get(key);
  const stage = pathStage(view.paths);
  const debug = Boolean(view.debug);
  const sc = sceneClasses(scene, drawMode(view.sourceRoute));
  const bb = stage === "all" && !debug ? sceneBackbone(scene) : null;
  const tl = stage === "table" && !debug ? sceneTableLanes(scene) : null;
  const looks = scene.lanes.map((lane) => {
    const cls = sc.cls[lane.index];
    let o = null;
    if (tl) o = tl.table[lane.index] ? { cls: "route", predicted: false } : null;
    else if (debug || cls === "up" || cls === "down") o = { cls, predicted: false };
    else {
      const kind = bb ? bb.kind[lane.index] : null;
      if (kind && overviewShows("route", stage, { backbone: true })) o = { cls: "route", predicted: kind === "predicted" };
    }
    return o && look(o.cls, o.cls === "down" && sc.assumed[lane.index], o.predicted);
  });
  scene.lookCache.set(key, looks);
  return looks;
}

/** The focus of device i: the lanes of its paths in the view, each hop in its strongest look, with its unknown ends,
 *  the glyphs of its heard-only partners' directions without a reading, every device on a path, and its way up as
 *  the band (none in "table"). view: the drawn view (paths, sourceRoute, heard, returnRoutes, debug, selected): a
 *  selection (view.selected === i) shows the view's paths on click; otherwise i is under the pointer and previews only
 *  what the overview draws, in a class it draws (heard-only partners wait for the click).
 *  { hops: [{ s, h, dir, cls, stroke, rank, assumed, predicted }], ends: [{ at, toward, cls }], glyphs: [{ s, h, dir }],
 *  nodes: Set, band: node indices or null }. */
export function focus(scene, i, view) {
  classify(scene);
  const stage = pathStage(view.paths);
  const sourceRoute = drawMode(view.sourceRoute);
  const debug = Boolean(view.debug);
  const selecting = view.selected === i;
  const route = scenePaths(scene, i, stage, sourceRoute, selecting && Boolean(view.heard), Boolean(view.returnRoutes));
  const sc = sceneClasses(scene, sourceRoute);
  // Stage 1: a lane keeps its strongest class whatever is in focus (main session, 2026-11-01): a hop of the focus's
  // ways on someone's up or down lane is drawn as that lane. From stage 2 on the focus's own tree decides (main
  // session, 2026-11-01, board M11 rule 5): scenePaths already gives each hop the strongest of the selection's own
  // ways (its up and down lanes, tables, neighbours, parent and child links, else discovery = computed); the
  // network-wide backbone does not reach into the focus, or nearly every computed hop would look proven.
  // Only the selection's stage-1 lanes (its up and down paths; the coordinator's routes down and up) override: they
  // are the same lanes in both stages for a device, but the coordinator's trees come as routes in stage 2.
  // The view "routing table" draws its walks as they are (a route each, heard lanes of the option): no other class
  // overrides them, as up and down are another basis (main session, 2026-11-01).
  const own = stage === "all" ? scenePaths(scene, i, "coordinator", sourceRoute).hops : null;
  const strongest = (hop) => {
    if (stage === "table") return hop;
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
  let hops = [...route.hops.values()].map(strongest);
  let ends = route.ends;
  if (!selecting && !debug) {
    // A preview keeps only what the overview draws, in a class it draws: routes from the stage "all" on, where the
    // backbone carries them; heard-only partners wait for the click.
    const shown = overview(scene, view);
    const previewed = (cls) => overviewShows(cls, stage, { backbone: true, table: true });
    hops = hops.filter((hop) => {
      const lane = scene.laneByKey.get(`${hop.s}>${hop.h}`);
      return previewed(hop.cls) && Boolean(lane) && shown[lane.index] !== null;
    });
    ends = ends.filter((end) => previewed(end.cls));
  }
  return {
    hops: hops.map((hop) => ({ s: hop.s, h: hop.h, dir: hop.dir, ...look(hop.cls, hop.assumed, hop.predicted) })),
    ends,
    glyphs: route.glyphs,
    nodes: route.nodes,
    // No band in the view "routing table": the way up is another basis (main session, 2026-11-01).
    band: stage !== "table" ? scene.upPaths[i] : null,
  };
}
