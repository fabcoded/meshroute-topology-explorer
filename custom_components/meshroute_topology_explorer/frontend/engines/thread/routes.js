// SPDX-License-Identifier: MIT
// Thread routes (spec 3.2 "Routes", issue #11): from the route and neighbour tables of Home Assistant's Matter cache
// (command meshroute_topology_explorer/thread_tables, thread_tables.py) the route of every device to a border
// router's router ID and back, forwarding as OpenThread decides it. Values, table-derived next hops and derived
// (mirrored) hops are kept apart; a route that meets a missing table stops and says where. Pure, no DOM. npm test
//
// Rules, as the owner's research and issue #11 give them (OpenThread router_table.cpp GetNextHopAndPathCost,
// router.cpp, link_quality.hpp; Matter ThreadNetworkDiagnostics RouteTableStruct, NeighborTableStruct):
// - Link cost between two routers from the lower of LQI in and out: 3 -> 1, 2 -> 2, 1 -> 4, 0 unusable. On a child's
//   link to its parent each side counts only what it receives: the child the quality from the parent (its route
//   entry's LQI in), the parent the quality from the child (its neighbour entry's LQI).
// - At a router: the direct link when its cost is not above the next hop's claimed cost (the entry's PathCost) plus
//   the link cost to the next hop, else via the next hop; nothing usable (16, OpenThread's maximum route cost, or
//   more) is no route. The unchosen one is an unused alternative.
// - A router's own entry (NextHop 63, PathCost 0, link not established) is the router itself and names its router ID.
// - An end device reaches the mesh through its parent: router ID = RLOC16 >> 10 where it reports 0/53/64, else the
//   one entry of its own route table with LinkEstablished (its NextHop 0 and PathCost 0 are ignored: 0 is a valid
//   router ID).
// - Routers are keyed by extended address; router IDs are reassigned, so they are mapped per read.
// - No `Age` field is used as the age of a value: the route table's wraps every 256 s.
import { extAddress } from "./from-matter.js";

/** OpenThread's maximum route cost: a cost this high or higher is no route. */
export const MAX_COST = 16;
const LINK_COST = Object.freeze({ 3: 1, 2: 2, 1: 4 });
/** Router IDs are 0..62; 63 is "no next hop". */
const NO_HOP = 63;
/** Longer than any Thread route (at most 32 routers): a walk this long has a loop. */
const MAX_HOPS = 33;

/** Cost of a link quality 0-3: 1, 2, 4, or MAX_COST for 0 and anything that is no link quality. */
export function linkCost(lq) {
  return LINK_COST[lq] ?? MAX_COST;
}

const int = (v) => (Number.isInteger(v) ? v : null);
const routerRole = (role) => role === 5 || role === 6; // RoutingRoleEnum: router, leader
const endRole = (role) => role === 2 || role === 3 || role === 4; // sleepy end device, end device, REED
const validRssi = (v) => (typeof v === "number" && v >= -128 && v <= 10 && v !== 127 ? v : null);

/** RSSI of a neighbour entry: the average, or the last frame's where the entry is a sleepy child or the average is
 *  missing (issue #11: a sleepy child's average may not be maintained, -13 dBm next to a last -42 dBm). */
function entryRssi(n) {
  const average = validRssi(n.averageRssi);
  const last = validRssi(n.lastRssi);
  if (n.isChild === true && n.rxOnWhenIdle === false) return last ?? average;
  return average ?? last;
}

/** The tables of the answer per device id: { id, role ("router" | "end device" | null), routerId, routes (by device
 *  id: { routerId, nextHop, pathCost, lqiIn, lqiOut, linked }), neighbours (by device id: { lqi, rssi, child }),
 *  rloc16, unchangedSince (ms or null) }, plus the router ID map and its conflicts. Devices are matched by Matter node
 *  id, table entries by extended address. */
export function readTables(network, answer) {
  const byNode = new Map(network.devices.filter((d) => d.nodeId !== null).map((d) => [d.nodeId, d]));
  const holders = new Map();
  const idOfRouter = new Map(); // router ID -> device id
  const conflicts = new Set();
  const claim = (routerId, id) => {
    if (routerId === null || routerId >= NO_HOP || !id) return;
    if (idOfRouter.has(routerId) && idOfRouter.get(routerId) !== id) conflicts.add(routerId);
    else idOfRouter.set(routerId, id);
  };
  for (const node of Array.isArray(answer && answer.nodes) ? answer.nodes : []) {
    const device = byNode.get(node && node.node_id);
    if (!device) continue;
    const role = routerRole(node.routing_role) ? "router" : endRole(node.routing_role) ? "end device" : null;
    const holder = { id: device.id, role, routerId: null, routes: null, neighbours: null, rloc16: int(node.rloc16),
      unchangedSince: typeof node.unchanged_since === "number" ? node.unchanged_since * 1000 : null };
    if (Array.isArray(node.route_table)) {
      holder.routes = new Map();
      for (const e of node.route_table) {
        const id = extAddress(e && e.extAddress);
        const routerId = int(e && e.routerId);
        if (!id || routerId === null) continue;
        const own = role === "router" && e.nextHop === NO_HOP && e.pathCost === 0 && e.linkEstablished === false
          && (id === device.id || device.extAddress === null);
        if (own) { holder.routerId = routerId; continue; }
        holder.routes.set(id, { routerId, nextHop: int(e.nextHop), pathCost: int(e.pathCost), lqiIn: int(e.LQIIn),
          lqiOut: int(e.LQIOut), linked: e.linkEstablished === true });
        if (e.allocated !== false) claim(routerId, id);
      }
    }
    if (Array.isArray(node.neighbor_table)) {
      holder.neighbours = new Map();
      for (const n of node.neighbor_table) {
        const id = extAddress(n && n.extAddress);
        if (id) holder.neighbours.set(id, { lqi: int(n.lqi), rssi: entryRssi(n), child: n.isChild === true });
      }
    }
    holders.set(device.id, holder);
  }
  for (const h of holders.values()) claim(h.routerId, h.id);
  for (const r of conflicts) idOfRouter.delete(r);
  return { holders, idOfRouter, conflicts, readAt: typeof (answer && answer.read_at) === "number" ? answer.read_at * 1000 : null };
}

/** The parent of end device `id` with how it was found: { id, source: "rloc16" | "route table" | "snapshot" } or
 *  null. RLOC16 >> 10 where the device reports 0/53/64 and the router ID is known; else the one linked entry of its
 *  own route table (several or none: unknown); else the snapshot model's parent (spec 3.2), when it has no table. */
export function parentOf(tables, network, id) {
  const h = tables.holders.get(id);
  if (h && h.rloc16 !== null && (h.rloc16 & 0x3ff) !== 0 && tables.idOfRouter.has(h.rloc16 >> 10)) {
    return { id: tables.idOfRouter.get(h.rloc16 >> 10), source: "rloc16" };
  }
  if (h && h.routes) {
    const linked = [...h.routes].filter(([, e]) => e.linked).map(([pid]) => pid);
    return linked.length === 1 ? { id: linked[0], source: "route table" } : null;
  }
  const d = network.devices.find((x) => x.id === id);
  return d && d.parent ? { id: d.parent, source: "snapshot" } : null;
}

/** What `hearer` hears of `sender`: { lqi, rssi, source } from the hearer's neighbour table ("neighbours"), else the
 *  link quality the hearer reported to the sender (the sender's route entry's LQI out, "lqi out"; no RSSI), else
 *  unknown (source null). */
export function heard(tables, sender, hearer) {
  const h = tables.holders.get(hearer);
  const n = h && h.neighbours && h.neighbours.get(sender);
  if (n && (n.lqi !== null || n.rssi !== null)) return { lqi: n.lqi, rssi: n.rssi, source: "neighbours" };
  const s = tables.holders.get(sender);
  const e = s && s.routes && s.routes.get(hearer);
  if (e && e.lqiOut !== null && e.lqiOut > 0) return { lqi: e.lqiOut, rssi: null, source: "lqi out" };
  return { lqi: null, rssi: null, source: null };
}

/** Cost of the link from router `from` to router `to` as `from` counts it (lower of LQI in and out of its entry), or
 *  MAX_COST without a linked entry. */
function routerLinkCost(tables, from, to) {
  const e = tables.holders.get(from)?.routes?.get(to);
  return e && e.linked && e.lqiIn !== null && e.lqiOut !== null ? linkCost(Math.min(e.lqiIn, e.lqiOut)) : MAX_COST;
}

/** The decision of router `holder` for destination router `dest` (spec 3.2): { next, kind ("direct" | "next hop"),
 *  cost (of the whole way from holder, as it reckons it), link (cost of the link to next), alternative } where
 *  alternative is the unchosen usable option { via, cost, kind }. Without a way: { next: null, reason }. */
export function nextHop(tables, holder, dest) {
  const h = tables.holders.get(holder);
  if (!h || !h.routes) return { next: null, reason: "table_missing" };
  const e = h.routes.get(dest);
  if (!e) return { next: null, reason: "no_entry" };
  const direct = e.linked ? routerLinkCost(tables, holder, dest) : MAX_COST;
  let via = null;
  if (e.nextHop !== null && e.nextHop < NO_HOP && e.pathCost !== null) {
    const nh = tables.conflicts.has(e.nextHop) ? null : tables.idOfRouter.get(e.nextHop) ?? null;
    const link = nh ? routerLinkCost(tables, holder, nh) : MAX_COST;
    if (nh && nh !== holder && nh !== dest) via = { via: nh, cost: e.pathCost + link, link };
    else if (!nh) via = { via: null, cost: null }; // a next hop no table names
  }
  const directUsable = direct < MAX_COST;
  const viaUsable = via && via.via && via.cost < MAX_COST;
  if (viaUsable && (!directUsable || via.cost < direct)) {
    return { next: via.via, cost: via.cost, link: via.link, kind: "next hop",
      alternative: directUsable ? { via: dest, cost: direct, kind: "direct" } : null };
  }
  if (directUsable) {
    return { next: dest, cost: direct, link: direct, kind: "direct",
      alternative: viaUsable ? { via: via.via, cost: via.cost, kind: "next hop" } : null };
  }
  return { next: null, reason: via && !via.via ? "next_hop_unknown" : "no_route" };
}

/** One hop sender -> receiver with what the receiver hears, its cost as the sender counts it, and its marks. */
function hop(tables, from, to, cost, extra = {}) {
  return { from, to, cost, ...heard(tables, from, to), derived: false, decided: "table", alternative: null, ...extra };
}

/** Walk from router `start` to router `goal` by each router's own decision; returns { hops, complete, reason, at }. */
function routerWalk(tables, start, goal, hops, seen) {
  let at = start;
  while (at !== goal) {
    if (hops.length >= MAX_HOPS) return { complete: false, reason: "loop", at };
    const step = nextHop(tables, at, goal);
    if (!step.next) return { complete: false, reason: step.reason, at };
    if (seen.has(step.next)) return { complete: false, reason: "loop", at };
    hops.push(hop(tables, at, step.next, step.link, { decided: step.kind, alternative: step.alternative }));
    seen.add(step.next);
    at = step.next;
  }
  return { complete: true, reason: null, at };
}

const sum = (hops) => (hops.every((x) => typeof x.cost === "number") ? hops.reduce((a, x) => a + x.cost, 0) : null);

/** Weakest hop of a list: the lowest LQI at its receiver, ties by the weaker RSSI (a hop without RSSI never wins a
 *  tie), then the first; null when no hop has a link quality. Index into hops. */
export function weakestHop(hops) {
  let best = -1;
  hops.forEach((x, i) => {
    if (x.lqi === null) return;
    if (best < 0) { best = i; return; }
    const b = hops[best];
    if (x.lqi < b.lqi || (x.lqi === b.lqi && x.rssi !== null && (b.rssi === null || x.rssi < b.rssi))) best = i;
  });
  return best < 0 ? null : best;
}

/** The route of device `id` to border router `br` and back (spec 3.2): { from, to, there: { hops, complete, reason,
 *  at, cost, weakest }, back: { ... }, parent }. There: an end device to its parent (cost as the child counts it),
 *  then each router's own decision. Back: the border router's table is not in the Matter cache, so its first hop is
 *  the last hop there mirrored (derived, cost as the receiver counts that link); every further hop from the routers'
 *  own tables, to the device or its parent, which delivers to its child (cost as the parent counts it). */
export function route(tables, network, id, br) {
  const device = network.devices.find((d) => d.id === id);
  const out = { from: id, to: br, parent: null, there: null, back: null };
  const there = { hops: [], complete: false, reason: null, at: id };
  out.there = there;
  if (!device || !tables.holders.size) return { ...out, there: { ...there, reason: "no_tables" }, back: null };
  const seen = new Set([id]);
  let start = id;
  const isEnd = device.role === "end device";
  if (isEnd) {
    const parent = parentOf(tables, network, id);
    out.parent = parent;
    if (!parent) Object.assign(there, { reason: "parent_unknown" });
    else {
      const own = tables.holders.get(id)?.routes?.get(parent.id);
      there.hops.push(hop(tables, id, parent.id, own && own.lqiIn !== null ? linkCost(own.lqiIn) : null,
        { decided: "parent" }));
      seen.add(parent.id);
      start = parent.id;
    }
  }
  if (!there.reason) Object.assign(there, routerWalk(tables, start, br, there.hops, seen));
  there.cost = there.complete ? sum(there.hops) : null;
  there.weakest = weakestHop(there.hops);

  const back = { hops: [], complete: false, reason: null, at: br };
  out.back = back;
  if (!there.complete || !there.hops.length) {
    back.reason = "there_incomplete";
  } else {
    const last = there.hops[there.hops.length - 1];
    const target = isEnd ? out.parent.id : id;
    // The border router's own choice is in its table, which the Matter cache does not hold (#12): its first hop back
    // is the last hop there mirrored, at the same cost (link costs are symmetric in Thread). Only the choice and the
    // cost are derived; what the receiver hears is measured where its table was read.
    const step = tables.holders.get(br)?.routes ? nextHop(tables, br, target) : null;
    back.hops.push(step && step.next
      ? hop(tables, br, step.next, step.link, { decided: step.kind, alternative: step.alternative })
      : hop(tables, br, last.from, last.cost, { derived: true, decided: "mirrored" }));
    const reached = back.hops[0].to;
    if (reached === id) Object.assign(back, { complete: true, at: id });
    else {
      Object.assign(back, routerWalk(tables, reached, target, back.hops, new Set([br, reached])));
      if (back.complete && isEnd) {
        back.hops.push(hop(tables, target, id, childCost(tables, target, id), { decided: "child" }));
        back.at = id;
      }
    }
  }
  back.cost = back.complete ? sum(back.hops) : null;
  back.weakest = weakestHop(back.hops);
  return out;
}

/** Cost of parent -> child as the parent counts it: its neighbour entry's link quality of the child; null unknown. */
function childCost(tables, parent, child) {
  const n = tables.holders.get(parent)?.neighbours?.get(child);
  return n && n.lqi !== null ? linkCost(n.lqi) : null;
}

/** Routing of a Thread network, or null without tables: { tables, borderRouters (ids), defaultRoute(id) (the route to
 *  the border router with the lowest complete path cost, else to the first border router by label; null for a
 *  border router or without one), routeTo(id, br) }. Routes are computed on demand and cached. */
export function buildRouting(network, answer) {
  if (!answer || !Array.isArray(answer.nodes)) return null;
  const tables = readTables(network, answer);
  const label = (id) => (network.devices.find((d) => d.id === id) || { label: id }).label;
  const borderRouters = network.devices.filter((d) => d.role === "border router").map((d) => d.id)
    .sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }) || (a < b ? -1 : 1));
  const cache = new Map();
  const routeTo = (id, br) => {
    const key = `${id}>${br}`;
    if (!cache.has(key)) cache.set(key, route(tables, network, id, br));
    return cache.get(key);
  };
  const defaultRoute = (id) => {
    if (!borderRouters.length || borderRouters.includes(id)) return null;
    const all = borderRouters.map((br) => routeTo(id, br));
    const complete = all.filter((r) => r.there.complete && r.there.cost !== null).sort((a, b) => a.there.cost - b.there.cost);
    return complete[0] || all[0];
  };
  return { tables, borderRouters, routeTo, defaultRoute };
}
