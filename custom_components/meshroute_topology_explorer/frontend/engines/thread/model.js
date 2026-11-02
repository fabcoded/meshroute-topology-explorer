// SPDX-License-Identifier: MIT
// The Thread engine's network (spec 3.2, 4.6): from the Matter snapshot as mapped by from-matter.js it derives the
// parent of each end device, the evidence per direction of every pair (the shared shape { a, b, ab, ba } of
// spec 4.3), the status numbers and the findings Thread data supports. Devices, readings and pairs come in the shared
// shapes the map draws, and only with what Thread data says: no Zigbee field is filled with a default (no network
// address, no router-table counts, no capacity, relay load or rating); what the snapshot does not name is null.
// Pure, no DOM. npm test
import { THREAD_CAPABILITIES, THREAD_SOURCE, fromMatter } from "./from-matter.js";

const ROUTER_ROLES = new Set(["router", "border router"]);

/** Why direction "hearer hears sender" has no reading (spec 4.3 wording where it fits). "–" glyph: the hearer's table
 *  was read and does not list the sender; "?": there is no table to ask (unknown-reason.js). */
function unknownReason(hearer, r) {
  if (r && r.strength === "none") return { code: "no_link" };
  if (r) return { code: "lqi0" };
  if (!hearer.tableRead) {
    return { code: hearer.kind === "hub" || hearer.role === "border router" || hearer.matter === false ? "not_matter" : "table_missing" };
  }
  return { code: "not_listed" };
}

/** Build a Network from the answer of `matter/network_topology` and, optionally, Home Assistant's device and area
 *  registries (names, areas) and entities and states (the kind, kinds.js). Returns null when the answer holds no Thread node. Shape: { engine "thread", source, id,
 *  extPanId, capabilities, collectedAt, devices, readings, staleReadings, routes (empty), links, pairs, status,
 *  findings, unresolved }; per device the shared fields of spec 4.2 (id, role, label, names, area, vendor, model,
 *  powerSource, kind, sleepy, available, lastSeen, parent, children) and the Thread fields (extAddress, rloc16, nodeId,
 *  threadRole, leader, reed, matter, availabilityKnown, tableRead: its neighbour table came with the snapshot). */
export function buildThreadNetwork(topology, { deviceRegistry, areaRegistry, entities, states, capabilities = THREAD_CAPABILITIES } = {}) {
  const mapped = fromMatter(topology, { deviceRegistry, areaRegistry, entities, states });
  if (!mapped) return null;
  const { pan, devices, readings, stale, links, unresolved, collectedAt } = mapped;

  // Parent of an end device. A Thread child holds exactly one neighbour entry, its
  // parent, so when the child's own table was read the parent is the router it lists (REED/FED: the best of several,
  // the others are real links, not stale parents). Only when the child reported nothing do the routers' readings
  // decide (best link quality, then RSSI at the router). Other routers that list the child are "possibly stale".
  const byId = new Map(devices.map((d) => [d.id, d]));
  const at = new Map(readings.map((r) => [`${r.reporter}|${r.subject}`, r]));
  for (const d of devices) {
    if (d.role !== "end device") continue;
    const linked = links.filter((l) => l.a === d.id || l.b === d.id).map((l) => byId.get(l.a === d.id ? l.b : l.a))
      .filter((p) => ROUTER_ROLES.has(p.role));
    const listed = linked.filter((p) => at.has(`${d.id}|${p.id}`));
    const ownTable = listed.length > 0;
    const candidates = ownTable ? listed : linked;
    if (!candidates.length) continue;
    const score = (p) => (ownTable ? at.get(`${d.id}|${p.id}`) : at.get(`${p.id}|${d.id}`)) || {};
    const ranked = candidates.sort((x, y) => (y.available - x.available)
      || ((score(y).lqi ?? -1) - (score(x).lqi ?? -1)) || ((score(y).rssi ?? -999) - (score(x).rssi ?? -999))
      || (x.id < y.id ? -1 : 1));
    d.parent = ranked[0].id;
    d.parentLqi = (at.get(`${d.parent}|${d.id}`) || {}).lqi ?? null;
    // Routers that list the child although its own table does not hold them. Without a read child table every
    // other linked router is a candidate; with one, the child's other listed routers are real links.
    d.possiblyStaleParents = ownTable
      ? linked.filter((p) => !at.has(`${d.id}|${p.id}`) && at.has(`${p.id}|${d.id}`)).map((p) => p.id)
      : ranked.slice(1).map((p) => p.id);
  }
  for (const d of devices) if (d.parent) byId.get(d.parent).children.push(d.id);
  for (const d of devices) d.children.sort();

  const pairs = threadPairs(devices, readings, links);
  return {
    engine: "thread",
    source: THREAD_SOURCE,
    // Settings are kept per network (spec 11): the extended PAN id names a Thread network (spec 4.1).
    id: `thread-${(pan || "unknown").replace(/[^A-Za-z0-9]/g, "").slice(0, 32) || "unknown"}`,
    extPanId: pan,
    capabilities,
    collectedAt,
    devices, readings, staleReadings: stale, routes: [], links, pairs,
    status: threadStatus(devices, pairs),
    findings: threadFindings(devices),
    unresolved,
  };
}


/** Evidence per direction for every linked pair (spec 4.3), the shape of the Zigbee engine's pairs: { a, b, ab, ba }, ab = "a
 *  hears b". measured: a reading; implied: a parent link without a reading at that end; else unknown with a reason. */
export function threadPairs(devices, readings, links) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const at = new Map(readings.map((r) => [`${r.reporter}|${r.subject}`, r]));
  const parentLink = (x, y) => byId.get(x).parent === y || byId.get(y).parent === x;
  const direction = (hearer, sender) => {
    const r = at.get(`${hearer}|${sender}`);
    if (r && r.measured) {
      return { state: "measured", lqi: r.lqi, rssi: r.rssi, scale: "thread-lqi", rating: null, source: "table", reason: null };
    }
    if (parentLink(hearer, sender) && byId.get(hearer).available && byId.get(sender).available) {
      return { state: "implied", lqi: null, rssi: null, scale: "thread-lqi", rating: null, source: "parent", reason: null };
    }
    return { state: "unknown", lqi: r ? r.lqi : null, rssi: r ? r.rssi : null, scale: "thread-lqi", rating: null,
      source: null, reason: unknownReason(byId.get(hearer), r) };
  };
  return links.map((l) => (l.a < l.b ? l : { ...l, a: l.b, b: l.a }))
    .sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1))
    .map(({ a, b }) => ({ a, b, ab: direction(a, b), ba: direction(b, a) }));
}

/** Status line numbers (spec 6) of a Thread network: links (pairs), links measured in both directions, border routers
 *  listed. No "router tables x/y" and no completeness: every Matter node's table comes with the snapshot. */
export function threadStatus(devices, pairs) {
  const both = pairs.filter((p) => p.ab.state === "measured" && p.ba.state === "measured").length;
  return {
    links: pairs.length,
    linksBoth: both,
    borderRouters: devices.filter((d) => d.role === "border router").length,
  };
}

/** Findings for Thread (spec 5.6), only those its data supports: offline, parent offline, and an end device without a
 *  parent link ("parent unknown", hedged: the snapshot may simply not list it). Ratings, "weak reception" and "very
 *  low reading" use the Zigbee LQI scale and are not raised; "data incomplete" has no table count to rest on. */
export function threadFindings(devices) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const out = [];
  for (const d of devices) {
    if (!d.available) out.push({ kind: "offline", device: d.id, evidence: { lastSeen: d.lastSeen }, missing: [] });
    if (d.role === "end device" && d.parent && !byId.get(d.parent).available) {
      out.push({ kind: "parent offline", device: d.id,
        evidence: { parent: d.parent, parentLastSeen: byId.get(d.parent).lastSeen }, missing: [] });
    }
  }
  for (const d of devices) {
    if (d.role === "end device" && d.available && !d.parent) {
      out.push({ kind: "parent unknown", device: d.id, evidence: { verdict: "no parent link" }, missing: [] });
    }
  }
  return out;
}
