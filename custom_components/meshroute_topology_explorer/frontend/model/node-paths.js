// SPDX-License-Identifier: MIT
// The paths of one device for the node view (spec 5.1, 5.7, 7.1; decisions by Fabian Schwamborn, 2026-11-01): "Path
// to coordinator" is its up and down path; "All paths" adds its theoretical way to every other available device and
// back (theoretical.js: routing table first, then the next hop's table and so on, else a neighbour, else what a route
// discovery would find). Each hop carries the reception at its hearer from the pair evidence (4.3). Walks stop at a
// loop, an unavailable device or where nothing leads on, and say so: unknown beats wrong. Pure functions over a
// Network. node --test tests/
import { downPath, routeEnds, routePath, upPath } from "./paths.js";
import { theoreticalPath } from "./theoretical.js";
import { pairEvidence } from "./pairs.js";
import { assumedDownPaths } from "./source-routes.js";

/** The node views (spec 9.1, 11): the default shows the way to and from the coordinator, which stands for Home
 *  Assistant; "all" adds the device's theoretical way to every other device and back (spec 5.7). */
export const NODE_VIEWS = Object.freeze(["coordinator", "all"]);
export const DEFAULT_NODE_VIEW = "coordinator";

const evidenceCache = new WeakMap(); // network -> Map "hearer|sender" -> direction

/** Direction evidence "hearer hears sender" for every pair, indexed once per network. */
function hearing(network) {
  let m = evidenceCache.get(network);
  if (m) return m;
  m = new Map();
  for (const p of pairEvidence(network)) {
    m.set(`${p.a}|${p.b}`, p.ab); // ab: a hears b
    m.set(`${p.b}|${p.a}`, p.ba);
  }
  evidenceCache.set(network, m);
  return m;
}

/** Reception at each hop of a path (ids in the direction of travel): [{ sender, hearer, state, lqi, rating, source,
 *  reason }], the hearer's reading of the sender (measured), or what implies the hop (a route or a parent link), or
 *  unknown with a reason. A hop to or from an unavailable device has no pair: its reception is unknown. */
export function pathHops(network, ids) {
  const m = hearing(network);
  const hops = [];
  for (let i = 0; i + 1 < ids.length; i++) {
    const sender = ids[i];
    const hearer = ids[i + 1];
    const dir = m.get(`${hearer}|${sender}`);
    hops.push(dir ? { sender, hearer, state: dir.state, lqi: dir.lqi, rating: dir.rating, source: dir.source,
      reason: dir.reason }
      : { sender, hearer, state: "unknown", lqi: null, rating: null, source: null, reason: "no evidence" });
  }
  return hops;
}

/** Paths of device `id` in a node view: [{ kind: "up" | "down" | "out" | "in", from, to, ids, complete, hops,
 *  assumed, reason, cost }].
 *  ids run in the direction of travel from `from`; an incomplete path ends where its walk stopped, short of `to` or
 *  at an unavailable `to`. "coordinator" mode: the up path (device to coordinator) and the down path (coordinator to
 *  device); "all" adds, for every other available device except the coordinator (in the network's order), the
 *  theoretical out path to it and in path from it (spec 5.7), each hop with `how` ("parent", "child", "table",
 *  "neighbour", "discovery"), a discovery hop with its link cost, the path with the reason it stopped and the path cost
 *  of its discovery part. The way to and from the coordinator is the up and down path, so it is not repeated; an
 *  unavailable device has none (its tables are stale, 5.1). Unknown modes count as "coordinator". The coordinator
 *  stands for Home Assistant: its paths to and from Home Assistant are all its paths, so it shows the routes it holds
 *  and the routes towards it in both modes (an empty map on its click would say nothing; its way to each device is
 *  that device's down path, decision by the main session, 2026-11-01). sourceRoute "assume" replaces an unknown down
 *  path by the up path reversed where source-routes.js says the assumption applies; that path carries assumed: true,
 *  and so do its hops. The default "off" gives the measured paths of spec 5.1 only. */
export function nodePaths(network, id, mode = DEFAULT_NODE_VIEW, { sourceRoute = "off" } = {}) {
  const devices = network.devices || [];
  const device = devices.find((d) => d.id === id);
  if (!device) return [];
  const coordinator = (devices.find((d) => d.role === "coordinator") || {}).id || null;
  const out = [];
  const add = (kind, from, to, walk) => {
    const assumed = walk.assumed === true;
    const how = walk.hops || [];
    // A theoretical hop keeps how it is taken, its link cost (discovery) and why its holder had no entry (`noEntry`:
    // "table not read" or "entry inactive"); `reason` stays the evidence's, which the map's glyphs read.
    const hops = pathHops(network, walk.ids).map((h, i) => ({ ...h, ...(assumed ? { assumed } : {}),
      ...(how[i] ? { how: how[i].how } : {}), ...(how[i] && how[i].cost ? { cost: how[i].cost } : {}),
      ...(how[i] && how[i].reason ? { noEntry: how[i].reason } : {}) }));
    out.push({ kind, from, to, ids: walk.ids, complete: walk.complete, hops, assumed,
      reason: walk.reason ?? null, cost: walk.cost ?? null });
  };
  if (id !== coordinator) {
    add("up", id, coordinator, upPath(network, id));
    const assumed = sourceRoute === "assume" ? assumedDownPaths(network).get(id) : null;
    add("down", coordinator, id, assumed || downPath(network, id));
  }
  if (mode !== "all" && id !== coordinator) return out;
  if (id === coordinator) {
    const { destinations, owners } = routeEnds(network, id);
    for (const d of destinations) add("out", id, d, routePath(network, id, d));
    for (const o of owners) add("in", o, id, routePath(network, o, id));
    return out;
  }
  if (!device.available) return out;
  const goals = devices.filter((d) => d.id !== id && d.id !== coordinator && d.available);
  for (const d of goals) add("out", id, d.id, theoreticalPath(network, id, d.id));
  for (const d of goals) add("in", d.id, id, theoreticalPath(network, d.id, id));
  return out;
}

/** Where an incomplete path's walk stopped, and towards which device it was going: { at, toward } or null for a
 *  complete path, an empty one, or one that reached an unavailable goal (its symbol shows that). */
export function unknownEnd(path) {
  if (path.complete || !path.ids.length || !path.to) return null;
  const at = path.ids[path.ids.length - 1];
  return at === path.to ? null : { at, toward: path.to };
}
