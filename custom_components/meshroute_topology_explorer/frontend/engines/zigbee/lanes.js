// SPDX-License-Identifier: MIT
// What a Zigbee lane carries and says (spec 4.3, 7.1, 8; decisions by Fabian Schwamborn, 2026-10-31 and 2026-11-01,
// boards M2, M7, M11). Classes belong to a lane, not to a pair: "up" (the hearer is the sender's next hop on the
// sender's way to the coordinator), "down" (the lane lies on the coordinator's way to a device, measured from the
// tables or assumed as the reversed way up, source-routes.js), "route" (on an active route between two devices,
// neither of them the coordinator) and "heard" (a reading, no traffic). A lane can carry several; it is drawn as its
// strongest, in the look of its class (strokeOf: up and down solid, assumed down dotted, routes between devices
// dash-dot, computed hops dash-dot in the lighter grey, heard only dashed). "Communication paths" says what is drawn
// (scene.js). Also the value under "RX:" (the raw LQI at the hearer, "Parent" or "Route" where only they imply the
// direction), the glyph of a direction without a reading ("–" when the hearer's table does not list the sender, "?"
// when there is no table to ask), and the legend rows of every path class with the view or option that draws it.
// Pure. npm test
import { BAND, STEM, WIDTH_STEPS, WIDTHS, laneStyle } from "../../graph/links.js";
import { receptionColor } from "../../graph/palette.js";
import { computePairs } from "./pairs.js";
import { downPath, routePath, upPath } from "./paths.js";
import { assumedDownPaths, drawMode, returnPaths, zigpyRecords } from "./source-routes.js";
import { isActive } from "./from-zha.js";

/** "Communication paths" (spec 7.1, 9.1, 11; decision by Fabian Schwamborn, 2026-11-01, board M11; routing-table view
 *  by owner proposal 2026-11-01, Codex 5): three views, each its own basis, none containing another: with the
 *  coordinator there and back, the routing table, paths to all devices (theoretical); "additional heard neighbours" is
 *  a separate option (checkbox) on top of any of them. */
export const PATH_STAGES = Object.freeze(["coordinator", "table", "all"]);
export const DEFAULT_PATHS = "coordinator";

/** A stored or passed stage as one of PATH_STAGES; anything else is the default. */
export function pathStage(value) {
  return PATH_STAGES.includes(value) ? value : DEFAULT_PATHS;
}

/** Lane classes in drawing order: the more a lane carries, the later (higher) it is drawn. */
export const CLASSES = Object.freeze(["heard", "route", "down", "up"]);
/** Heard-only partners shown per device: its best by the pair's best rating at the hearer (decision 2026-10-31). */
export const BEST_HEARD = 3;

/** The class of a lane under a source-route stage (source-routes.js), the strongest it carries: up or a
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
 *  2026-11-01): in "coordinator" and "all" up and down always; in "all" the backbone, every lane a theoretical path
 *  between two devices uses (backbone: the lane is one), drawn as a route; in "table" only the lane of a usable routing
 *  entry (table: owner -> next hop), drawn as a route, and no up or down lane; heard only never without a selection
 *  (the option adds its partners on click); everything in debug mode. */
export function overviewShows(cls, stage, { backbone = false, table = false, debug = false } = {}) {
  if (debug) return true;
  const view = pathStage(stage);
  if (view === "table") return cls === "route" && table;
  if (cls === "up" || cls === "down") return true;
  return cls === "route" && backbone && view === "all";
}

/** The look of a Zigbee lane class (CLASSES or null) on the map (board M11): up and down solid, an assumed down lane
 *  dotted, a route between devices dash-dot, one only a computed route discovery takes dash-dot in the lighter grey,
 *  heard only dashed, no class faint. */
export function strokeOf(cls, { assumed = false, predicted = false } = {}) {
  if (!cls) return "faint";
  if (cls === "route") return predicted ? "dashdot-muted" : "dashdot";
  if (cls === "down" && assumed) return "dotted";
  return cls === "heard" ? "dashed" : "solid";
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
 *  - up: a hop of a device's way to the coordinator (paths.js upPath);
 *  - downMeasured: a hop of the coordinator's way to a device (downPath), incomplete walks up to where they stop;
 *  - downAssumed: a hop of an assumed return path (source route, source-routes.js), counted only under "assume";
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
  for (const d of devices) {
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

/** A reading's quality for the layout's springs (spec 7.1): its LQI on 0..255 as 0..1; null where it is no spring
 *  (LQI 0 or no value, which may mean unmeasured; the model marks such a reading measured: false). */
export function springQuality(r) {
  if (!r || r.measured === false || !(typeof r.lqi === "number" && r.lqi > 0)) return null;
  return Math.min(r.lqi, 255) / 255;
}

/** Glyph for a direction without a reading (spec 4.3 reasons): "–" when the hearer has a table that does not list the
 *  sender (full, nearly full, with space, capacity unknown); "?" when there is no table to ask (end device, missing or
 *  stale table) or the table says LQI 0 (unmeasured or very weak). */
export function unknownGlyph(reason) {
  const listedNot = /^(table (full|nearly full|has space)|capacity unknown)/;
  return typeof reason === "string" && listedNot.test(reason) ? "–" : "?";
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
  const text = valueText(dir ? dir.lqi : null, texts.uncertain);
  return text === "?" ? unknownGlyph(dir && dir.reason) : text;
}

/** What the legend explains, for the panel to draw with its own words (ids are stable keys for translations; board
 *  M7): every path class whatever the view (decision by Fabian Schwamborn, 2026-11-01), each with its stroke sample:
 *  there and back with the coordinator (up and down share one row) and the assumed return path (views 1 and 3), paths
 *  to other devices (views 2 and 3) and the computed route discovery (view 3, marked computed), heard (the option,
 *  needs a selection); the band under a selected device's way up; the glyphs for directions without a reading where
 *  the option draws them (on click, debug); debug mode adds the lane without traffic or reading, the width steps and
 *  the unknown end; "RX:" at the hearer with a sample value, and with colored the reception scale. */
export function legendEntries(theme, { debug = false, colored = false, heard = false } = {}) {
  const sample = (stroke) => laneStyle(stroke, 1, theme);
  const glyphs = debug || heard;
  return [
    // The views that draw each class (owner proposal 2026-11-01): up and down in 1 and 3, routes in 2 and 3.
    { id: "coordinator", kind: "lane", style: sample("solid"), stage: [1, 3] },
    { id: "assumed", kind: "lane", style: sample("dotted"), stage: [1, 3] },
    { id: "route", kind: "lane", style: sample("dashdot"), stage: [2, 3] },
    { id: "discovery", kind: "lane", style: sample("dashdot-muted"), stage: 3, computed: true },
    { id: "heard", kind: "lane", style: sample("dashed"), option: "heard" },
    { id: "up-path", kind: "band", color: theme.foreground, alpha: BAND.alpha, width: BAND.width },
    ...(debug ? [{ id: "implied", kind: "lane", style: laneStyle("faint", null, theme) },
      { id: "width", kind: "width", steps: [...WIDTH_STEPS], widths: [...WIDTHS.solid], color: theme.foreground }] : []),
    ...(glyphs ? [{ id: "not-listed", kind: "glyph", text: "–", color: theme.muted },
      { id: "no-table", kind: "glyph", text: "?", color: theme.muted }] : []),
    ...(debug ? [{ id: "path-end", kind: "stem", color: theme.foreground, width: STEM.width, dash: [...STEM.dash],
      text: "?" }] : []),
    { id: "rx", kind: "rx", sample: "103" },
    ...(colored ? [{ id: "reception", kind: "scale",
      colors: [0, 0.25, 0.5, 0.75, 1].map((r) => receptionColor(r, theme)) }] : []),
  ];
}
