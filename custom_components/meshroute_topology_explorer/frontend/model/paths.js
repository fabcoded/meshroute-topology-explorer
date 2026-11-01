// SPDX-License-Identifier: MIT
// Up and down paths (spec 5.1) and relay load (5.2). Pure functions over a Network.
//
// A path that meets a missing table or entry, a loop or an unavailable hop stops and is incomplete: it is never
// guessed, not even for the coordinator's direct neighbours (which have no routing entry at the coordinator).
// Routes taken from the table of an unavailable device are stale and never followed (decision 2026-10-31): the walk
// of an unavailable router is incomplete, and the walk stops at the first unavailable device.
import { isActive } from "./normalize.js";

const cache = new WeakMap(); // network -> lookup maps, so repeated path queries do not re-index the routes

function lookups(network) {
  let c = cache.get(network);
  if (c) return c;
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  // owner -> destination -> first active route; routes that are not Active or are stale are kept in the network but not followed.
  const routes = new Map();
  for (const r of network.routes) {
    if (r.stale || !isActive(r.status)) continue;
    if (!routes.has(r.owner)) routes.set(r.owner, new Map());
    const m = routes.get(r.owner);
    if (!m.has(r.destination)) m.set(r.destination, r);
  }
  const coordinator = network.devices.find((d) => d.role === "coordinator") || null;
  c = { byId, routes, coordinator: coordinator && coordinator.id };
  cache.set(network, c);
  return c;
}

const nextHop = (c, owner, destination) => {
  const route = c.routes.get(owner) && c.routes.get(owner).get(destination);
  return route ? route.nextHop : null;
};

/** The active, current routing entry of `owner` towards `destination` that path walks follow (the first one in the
 *  network's order), or null. Shared with the theoretical paths (theoretical.js), so both read the tables alike. */
export function activeRoute(network, owner, destination) {
  const m = lookups(network).routes.get(owner);
  return (m && m.get(destination)) || null;
}

/** Path from `id` to the coordinator: { ids, complete }. `ids` ends where the walk stopped. */
export function upPath(network, id) {
  const c = lookups(network);
  const start = c.byId.get(id);
  if (!start || !c.coordinator) return { ids: [], complete: false };
  const ids = [id];
  if (!start.available) return { ids, complete: false }; // like downPath: an offline device has no usable path
  const seen = new Set(ids);
  let cur = start;
  while (cur.id !== c.coordinator) {
    const next = cur.role === "end device" ? cur.parent : cur.role === "router" ? nextHop(c, cur.id, c.coordinator) : null;
    if (!next || seen.has(next)) return { ids, complete: false };
    ids.push(next);
    seen.add(next);
    cur = c.byId.get(next);
    if (!cur.available) return { ids, complete: false };
  }
  return { ids, complete: true };
}

/** Walk the routing entries from `from` towards `to`, hop by hop through each hop's own entry for `to`; stops at a
 *  missing entry, a loop or an unavailable hop. Complete only if `to` is reached and available. A hop that is the
 *  parent of an end-device goal delivers to its child directly: a parent keeps no routing entry for its own child
 *  (Zigbee r22, 3.6.3.3, the child check comes first). Without this, a walk that had reached the parent was thrown
 *  away for the shorter walk towards the parent (A4k; it hid four down paths on the sample). */
function followRoutes(c, from, to) {
  const ids = [from];
  const seen = new Set(ids);
  const target = c.byId.get(to);
  const childOf = target.role === "end device" ? target.parent : null;
  let cur = from;
  while (cur !== to) {
    const next = cur === childOf ? to : nextHop(c, cur, to);
    if (!next || seen.has(next)) return { ids, complete: false };
    ids.push(next);
    seen.add(next);
    cur = next;
    if (cur !== to && !c.byId.get(cur).available) return { ids, complete: false };
  }
  return { ids, complete: c.byId.get(to).available };
}

/** Path from `from` to `to` by routing entries: { ids, complete }. For an end device that the routes do not reach,
 *  the path to its parent plus the parent link (the parent's listing of the child is the evidence), but only when the
 *  path to the parent is complete; else the incomplete path to the parent is returned as it is (spec 5.1). */
function pathFrom(c, from, to, depth = 0) {
  if (from === to) return { ids: [from], complete: c.byId.get(from).available };
  const direct = followRoutes(c, from, to);
  const target = c.byId.get(to);
  // A parent is a router or the coordinator (only they list children); depth guards against broken data anyway.
  if (direct.complete || target.role !== "end device" || !target.parent || depth > 0) return direct;
  const viaParent = pathFrom(c, from, target.parent, depth + 1);
  // Delivery to a child is the last hop only when the way to its parent is known; otherwise nothing is appended.
  if (!viaParent.complete) return viaParent;
  return { ids: [...viaParent.ids, to], complete: target.available };
}

/** Path from the coordinator to `id`: { ids, complete } (spec 5.1). */
export function downPath(network, id) {
  const c = lookups(network);
  if (!c.byId.has(id) || !c.coordinator) return { ids: [], complete: false };
  if (id === c.coordinator) return { ids: [id], complete: true };
  return pathFrom(c, c.coordinator, id);
}

/** Path from device `from` to device `to` along routing entries, the same walk as the down path (spec 5.1) from any
 *  start: { ids, complete }. Used for every path of one device in the node view ("all paths"). */
export function routePath(network, from, to) {
  const c = lookups(network);
  if (!c.byId.has(from) || !c.byId.has(to)) return { ids: [], complete: false };
  return pathFrom(c, from, to);
}

/** Destinations of `id`'s own active, current routes, and owners of active, current routes towards `id`, both in
 *  the network's order of routes: what "all paths" follows. */
export function routeEnds(network, id) {
  const c = lookups(network);
  const destinations = c.routes.has(id) ? [...c.routes.get(id).keys()].filter((d) => d !== id && c.byId.has(d)) : [];
  const owners = [];
  for (const [owner, m] of c.routes) if (owner !== id && m.has(id)) owners.push(owner);
  return { destinations, owners };
}

/** Relay load per router id (spec 5.2): active routes in available tables that use it as next hop towards another
 *  destination. The coordinator's own table counts, because most routes towards the mesh start there. */
export function relayLoads(routes) {
  const loads = new Map();
  for (const r of routes) {
    if (r.stale || r.direct || !isActive(r.status)) continue;
    loads.set(r.nextHop, (loads.get(r.nextHop) || 0) + 1);
  }
  return loads;
}
