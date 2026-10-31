// SPDX-License-Identifier: MIT
// Up and down paths (spec 5.1) and relay load (5.2). Pure functions over a Network.
//
// A path that meets a missing table or entry, a loop or an unavailable hop stops and is incomplete: it is never
// guessed, not even for the coordinator's direct neighbours (which have no routing entry at the coordinator).
// The start of an up path may be an unavailable device: its stale routing entry is used, the walk stops at the
// first unavailable device after it.
import { isActive } from "./normalize.js";

const cache = new WeakMap(); // network -> lookup maps, so repeated path queries do not re-index the routes

function lookups(network) {
  let c = cache.get(network);
  if (c) return c;
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  // owner -> destination -> first active route; routes that are not Active are kept in the network but not followed.
  const routes = new Map();
  for (const r of network.routes) {
    if (!isActive(r.status)) continue;
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

/** Path from `id` to the coordinator: { ids, complete }. `ids` ends where the walk stopped. */
export function upPath(network, id) {
  const c = lookups(network);
  const start = c.byId.get(id);
  if (!start || !c.coordinator) return { ids: [], complete: false };
  const ids = [id];
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

/** Walk the coordinator's routing entries towards `id`; stops at a missing entry, loop or unavailable hop. */
function followRoutes(c, id) {
  const ids = [c.coordinator];
  const seen = new Set(ids);
  let cur = c.coordinator;
  while (cur !== id) {
    const next = nextHop(c, cur, id);
    if (!next || seen.has(next)) return { ids, complete: false };
    ids.push(next);
    seen.add(next);
    cur = next;
    if (cur !== id && !c.byId.get(cur).available) return { ids, complete: false };
  }
  return { ids, complete: c.byId.get(id).available };
}

/** Path from the coordinator to `id`: { ids, complete }. For an end device that the coordinator's routes do not
 *  reach, the path to its parent plus the parent link (the parent's listing of the child is the evidence). */
export function downPath(network, id) {
  const c = lookups(network);
  const target = c.byId.get(id);
  if (!target || !c.coordinator) return { ids: [], complete: false };
  if (id === c.coordinator) return { ids: [id], complete: true };
  const direct = followRoutes(c, id);
  if (direct.complete || target.role !== "end device" || !target.parent) return direct;
  const viaParent = downPath(network, target.parent);
  const ids = [...viaParent.ids, id];
  return { ids, complete: viaParent.complete && target.available };
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
