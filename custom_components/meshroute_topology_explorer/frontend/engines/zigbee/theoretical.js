// SPDX-License-Identifier: MIT
// Theoretical paths (spec 5.7; board M11, brief a4k): the way a frame from
// one device would most likely take to another today, worked out hop by hop at the device holding it, after the
// unicast routing of the Zigbee specification r22 (05-3474-22): 3.6.3.3 (child, routing table, neighbour table) and
// 3.6.3.5 (route discovery, path cost 3.6.3.1). "Theoretical": computed, not observed; Home Assistant does not show
// whether two devices really talk. Pure functions over a Network. npm test
//
// Rules per hop, in this order, at the holder H of a frame for the goal D:
//   1. H is an end device: to its parent ("parent").
//   2. D is an end device whose parent is H: delivered to the child ("child").
//   3. H holds an active, current routing entry for D: to its next hop ("table"); the next holder reads its own table.
//   4. D is a router or the coordinator that H measures in its neighbour table: directly ("neighbour"). An end device
//      is routed by its own address under stochastic addressing (3.6.3.3), so a router that only hears its parent
//      does not deliver there; it discovers.
//   5. Else the rest of the way is what a route discovery from H would find today ("discovery"): the lowest path cost
//      to D, for an end device to its parent (the parent answers for its child, 3.6.3.5.2), which then delivers
//      ("child"). See discoveryTree for the links and costs.
// A table not read or an entry that is not active counts as no entry (rules 4 and 5 apply) and the hop that leaves H
// keeps that reason. A loop, an unavailable device, an unknown parent or no link at all stop the walk: the path is
// incomplete and says why. Unknown beats wrong.
import { activeRoute } from "./paths.js";
import { pairEvidence } from "./pairs.js";

/** How a hop is taken, in the order of the rules above (spec 5.7). */
export const HOWS = Object.freeze(["parent", "child", "table", "neighbour", "discovery"]);

/** Link cost 1..7 of one direction from the hearer's LQI (spec 5.7; decision of the main session, 2026-11-01):
 *  1 + round(6 (1 - LQI / 255)), so LQI 255 costs 1, 128 costs 4 and 0 costs 7. The specification wants a cost of 1
 *  to 7 (3.4.8.3.2) that falls with link quality, allows "a table-driven function ... to map average LQI values onto
 *  C{l}" (3.6.3.1) and leaves the estimate to the implementation; its example min(7, round(1 / p^4)) with p read as
 *  LQI / 255 gives 7 to 206 of the sample's 241 router pairs, so discovery would only count hops. */
export function linkCost(lqi) {
  const q = Math.max(0, Math.min(255, Number(lqi) || 0)) / 255;
  return 1 + Math.round(6 * (1 - q));
}

const cache = new WeakMap(); // network -> lookups and discovery trees

function lookups(network) {
  let c = cache.get(network);
  if (c) return c;
  const devices = network.devices || [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  // "hearer|sender" -> LQI of a measured reading, from the pair evidence (4.3), which the map's lanes use too.
  const heard = new Map();
  for (const p of pairEvidence(network)) {
    if (p.ab && p.ab.state === "measured" && p.ab.lqi > 0) heard.set(`${p.a}|${p.b}`, p.ab.lqi);
    if (p.ba && p.ba.state === "measured" && p.ba.lqi > 0) heard.set(`${p.b}|${p.a}`, p.ba.lqi);
  }
  const entries = new Set(); // "owner|destination" with any entry, active or not
  for (const r of network.routes || []) entries.add(`${r.owner}|${r.destination}`);
  // Links route discovery can use (3.6.3.5.2 with nwkSymLink): between available routers or the coordinator, each
  // measured by the other, so the neighbour has an outgoing cost; the cost is the larger of the two directions.
  const routing = (d) => d && d.available && (d.role === "router" || d.role === "coordinator");
  const links = new Map();
  for (const { a, b } of pairEvidence(network)) {
    const lqi = heard.get(`${a}|${b}`);
    if (lqi === undefined || !routing(byId.get(a)) || !routing(byId.get(b))) continue;
    const back = heard.get(`${b}|${a}`);
    if (back === undefined) continue;
    const cost = Math.max(linkCost(lqi), linkCost(back));
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!links.has(x)) links.set(x, []);
      links.get(x).push({ to: y, cost });
    }
  }
  for (const list of links.values()) list.sort((p, q) => (p.to < q.to ? -1 : 1));
  c = { byId, heard, entries, links, trees: new Map() };
  cache.set(network, c);
  return c;
}

/** The ids of a search label { id, prev }, from the start on. */
function idsOf(label) {
  const ids = [];
  for (let l = label; l; l = l.prev) ids.push(l.id);
  return ids.reverse();
}

/** Whether search label p = { cost, hops, id, prev } beats q: lower path cost, then fewer hops, then the lower device
 *  ids from the start on (an own tie-break, so the result never depends on the order of the data). On a tie of cost
 *  and hops both chains have the same length: they are walked back together and the difference nearest the start
 *  decides, without building the id lists (ties are frequent with integer costs; the lists were most of a click's
 *  model time on the sample, brief a4z). A shared label means the same ids from there to the start. */
function better(p, q) {
  if (p.cost !== q.cost) return p.cost < q.cost;
  if (p.hops !== q.hops) return p.hops < q.hops;
  let verdict = false;
  for (let a = p, b = q; a && b && a !== b; a = a.prev, b = b.prev) if (a.id !== b.id) verdict = a.id < b.id;
  return verdict;
}

/** The best route discovery from `from` to every device it can reach: Map id -> { cost, ids } (ids from `from`).
 *  Dijkstra over the links of lookups(); the tie-break extends with the path, so the order stays consistent. Cached
 *  per start, as one click asks the same start many times. */
export function discoveryTree(network, from) {
  const c = lookups(network);
  if (c.trees.has(from)) return c.trees.get(from);
  const best = new Map();
  const done = new Set();
  const heap = [];
  const push = (label) => {
    heap.push(label);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (!better(heap[i], heap[up])) break;
      [heap[i], heap[up]] = [heap[up], heap[i]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && better(heap[l], heap[m])) m = l;
        if (r < heap.length && better(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  if (c.links.has(from)) {
    const start = { cost: 0, hops: 0, id: from, prev: null };
    best.set(from, start);
    push(start);
  }
  while (heap.length) {
    const label = pop();
    const at = label.id;
    if (done.has(at) || best.get(at) !== label) continue;
    done.add(at);
    for (const { to, cost } of c.links.get(at) || []) {
      if (done.has(to)) continue;
      const next = { cost: label.cost + cost, hops: label.hops + 1, id: to, prev: label };
      const had = best.get(to);
      if (!had || better(next, had)) { best.set(to, next); push(next); }
    }
  }
  const tree = new Map([...best].map(([id, label]) => [id, { cost: label.cost, ids: idsOf(label) }]));
  c.trees.set(from, tree);
  return tree;
}

/** The link cost route discovery uses between two devices, or null when they share no usable link. */
export function discoveryLinkCost(network, a, b) {
  const link = (lookups(network).links.get(a) || []).find((l) => l.to === b);
  return link ? link.cost : null;
}

/** Theoretical path from `from` to `to` (rules above): { ids, complete, hops: [{ sender, hearer, how, reason?, cost?
 *  }], reason, cost }. ids run in the direction of travel and end where the walk stopped; reason says why an
 *  incomplete path stopped ("loop", "unavailable", "no link", "table not read", "no parent", "unknown device"), else
 *  null; a discovery hop carries its link cost, and cost is the path cost of the discovery part (null without one). */
export function theoreticalPath(network, from, to) {
  const c = lookups(network);
  const start = c.byId.get(from);
  const target = c.byId.get(to);
  if (!start || !target) return { ids: [], complete: false, hops: [], reason: "unknown device", cost: null };
  const ids = [from];
  const hops = [];
  const seen = new Set(ids);
  const result = (complete, reason = null, cost = null) => ({ ids, complete, hops, reason: complete ? null : reason,
    cost });
  if (from === to) return result(start.available, "unavailable");
  if (!start.available) return result(false, "unavailable");
  const childOf = target.role === "end device" ? target.parent : null;
  let stop = null; // why step() refused
  /** Append one hop; false when it closes a loop or reaches an unavailable device (the walk stops there). */
  const step = (sender, hearer, how, extra) => {
    if (seen.has(hearer)) { stop = "loop"; return false; }
    hops.push({ sender, hearer, how, ...extra });
    ids.push(hearer);
    seen.add(hearer);
    if (!c.byId.get(hearer).available) { stop = "unavailable"; return false; }
    return true;
  };
  let cur = from;
  while (cur !== to) {
    const holder = c.byId.get(cur);
    if (holder.role === "end device") {                                    // rule 1
      if (!holder.parent || !c.byId.has(holder.parent)) return result(false, "no parent");
      if (!step(cur, holder.parent, "parent")) return result(false, stop);
      cur = holder.parent;
      continue;
    }
    if (cur === childOf) {                                                 // rule 2
      if (!step(cur, to, "child")) return result(false, stop);
      break;
    }
    const entry = activeRoute(network, cur, to);
    if (entry) {                                                           // rule 3
      if (!step(cur, entry.nextHop, "table")) return result(false, stop);
      cur = entry.nextHop;
      continue;
    }
    // No usable entry: say why on the hop that leaves this holder (a missing entry in a table that was read is the
    // normal case and needs no word).
    const why = !holder.hasTable ? { reason: "table not read" }
      : c.entries.has(`${cur}|${to}`) ? { reason: "entry inactive" } : {};
    if (target.role !== "end device" && c.heard.has(`${cur}|${to}`)) {    // rule 4
      if (!step(cur, to, "neighbour", why)) return result(false, stop);
      break;
    }
    const goal = target.role === "end device" ? childOf : to;             // rule 5
    if (!goal || !c.byId.has(goal)) return result(false, "no parent");
    const found = discoveryTree(network, cur).get(goal);
    if (!found) return result(false, holder.hasTable ? "no link" : "table not read");
    if (found.ids.slice(1).some((id) => seen.has(id))) return result(false, "loop");
    for (let i = 0; i + 1 < found.ids.length; i++) {
      const [a, b] = [found.ids[i], found.ids[i + 1]];
      if (!step(a, b, "discovery", { cost: discoveryLinkCost(network, a, b), ...(i === 0 ? why : {}) })) {
        return result(false, stop, found.cost);
      }
    }
    if (goal !== to && !step(goal, to, "child")) return result(false, stop, found.cost);
    return result(target.available, "unavailable", found.cost);
  }
  return result(target.available, "unavailable");
}

const laneCache = new WeakMap(); // network -> theoreticalLanes

/** Every lane the theoretical paths between any two available devices use, the coordinator's included: Map
 *  "sender>hearer" -> { sender, hearer, hows (Set of how it is taken) }. The stage-2 overview draws this backbone
 *  (every lane any path uses). Computed once per network; on the sample
 *  1722 paths and 570 lanes. */
export function theoreticalLanes(network) {
  let lanes = laneCache.get(network);
  if (lanes) return lanes;
  lanes = new Map();
  const devices = (network.devices || []).filter((d) => d.available);
  for (const a of devices) {
    for (const b of devices) {
      if (a === b) continue;
      for (const hop of theoreticalPath(network, a.id, b.id).hops) {
        const key = `${hop.sender}>${hop.hearer}`;
        if (!lanes.has(key)) lanes.set(key, { sender: hop.sender, hearer: hop.hearer, hows: new Set() });
        lanes.get(key).hows.add(hop.how);
      }
    }
  }
  laneCache.set(network, lanes);
  return lanes;
}
