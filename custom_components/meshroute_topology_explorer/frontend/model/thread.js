// SPDX-License-Identifier: MIT
// Thread through Matter (spec 3.2, 4.6): turns the answer of `matter/network_topology` (Home Assistant 2026.9 or
// newer, read with refresh false: the server's cached snapshot, no radio traffic) into the same Network shape the
// ZHA model builds (model/index.js), so map, lists and details draw it with the same code. Pure, no DOM.
// node --test tests/
//
// What the snapshot gives and what it does not (capability set, spec 4.6): readings per direction (Thread link
// quality 0-3 and RSSI in dBm, measured by the receiver), the role of each node (leader, router, end device, sleepy
// end device, border router), a collection time. It has no next hop per destination: routes stay empty, so there
// are no paths, path stages or theoretical paths for Thread, and no up or down lanes; a parent link (an end device and
// the router it is attached to) is the only traffic the map can name. Unknown stays unknown: a missing value is null,
// never 0.
//
// Direction (API contract of matter.js server, packages/ws-client/src/models/model.ts NetworkTopologyConnection:
// "source_to_target: source -> target observation, when that direction reported the link", and its websocket schema
// changelog, schema 13: Thread links come "from the nodes' own ThreadNetworkDiagnostics (neighbor + route tables)",
// both observed directions are kept): the reporting node is `source` and the entry is its neighbour-table record of
// `target`, so `source_to_target` is "source hears target", received at the source. Confirmed by the main session,
// 2026-11-01, and by the capture: links to a border router (not a Matter node, no table read) carry only
// source_to_target. RECEIVER_OF_SOURCE_TO_TARGET is the one place to flip it.
import { normalizeIeee } from "./parse.js";

export const RECEIVER_OF_SOURCE_TO_TARGET = "source";
/** Text of the status line's source part. */
export const THREAD_SOURCE = "thread";
/** Capabilities of a Thread network read through Matter (spec 4.6): what views, stages and findings may use. No
 *  routes, no ratings (the Zigbee LQI scale), no scan, observations, clusters, route records or device page. */
export const THREAD_CAPABILITIES = Object.freeze({
  routes: false, parents: true, ratings: false, measurementTime: true, userRefresh: true, scan: false,
  observations: false, clusters: false, routeRecords: false, devicePage: false, scale: "thread-lqi",
});

/** Thread roles of the snapshot -> model role (spec 4.2) and sleep. A leader is a router with the "L" crown (spec 8);
 *  a REED (router-eligible end device) is attached like an end device and listens when idle. */
const ROLE_MAP = {
  leader: { role: "router", sleepy: false, leader: true },
  router: { role: "router", sleepy: false },
  reed: { role: "end device", sleepy: false, reed: true },
  end_device: { role: "end device", sleepy: false },
  minimal_end_device: { role: "end device", sleepy: false },
  med: { role: "end device", sleepy: false },
  sleepy_end_device: { role: "end device", sleepy: true },
  synchronized_sleepy_end_device: { role: "end device", sleepy: true },
  sed: { role: "end device", sleepy: true },
  ssed: { role: "end device", sleepy: true },
};
const ROUTER_ROLES = new Set(["router", "border router"]);
/** OpenThread reports 127 for "no RSSI"; anything outside a radio's range is no value either. */
const RSSI_MIN = -128;
const RSSI_MAX = 10;

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** Thread link quality 0-3, or null. */
export function threadLqi(value) {
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;
}

/** RSSI in dBm, or null for no value (127, out of range, not a number). */
export function threadRssi(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= RSSI_MIN && value <= RSSI_MAX && value !== 127
    ? value : null;
}

/** EUI-64 extended address "0011223344556677" (any case, with or without colons) -> "00:11:...:77", or null. */
export function extAddress(value) {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^0x/i, "").replace(/[:-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(hex)) return null;
  return normalizeIeee(hex.match(/../g).join(":"));
}

/** The timestamp of the snapshot or a node: milliseconds or seconds since the epoch, or ISO text -> ISO text (UTC). */
export function isoTime(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

/** Registry lookup by Home Assistant device id (the snapshot's `ha_device_id`). */
function registryIndex(deviceRegistry) {
  const byId = new Map();
  for (const e of Array.isArray(deviceRegistry) ? deviceRegistry : []) if (e && e.id) byId.set(e.id, e);
  return byId;
}

/** One reading "reporter hears subject" from a direction object { strength, lqi, rssi } of the snapshot, or null when
 *  the direction is missing. measured: a valid RSSI, or link quality above 0, says the link was heard. Link quality 0
 *  ("none") with a valid RSSI is a measured low reading: the stack still lists the neighbour (tq2, owner decision
 *  2026-11-01). Link quality 0 without a valid RSSI (a fresh entry without samples) and strength "unknown" (no
 *  measurement) are not measured and never drawn as a dead link (spec 3.2). */
function reading(reporter, subject, dir, connection) {
  if (!dir || typeof dir !== "object") return null;
  const lqi = threadLqi(dir.lqi);
  const rssi = threadRssi(dir.rssi);
  const strength = text(dir.strength);
  if (lqi === null && rssi === null && strength === null && dir.lqi === undefined) return null; // an empty object
  const measured = strength !== "unknown" && ((lqi !== null && lqi > 0) || rssi !== null);
  return { reporter, subject, lqi, rssi, strength, measured, scale: "thread-lqi", relationship: null, rating: null,
    viaRouteTable: typeof connection.via_route_table === "boolean" ? connection.via_route_table : null,
    pathCost: int(connection.path_cost) };
}

/** Why direction "hearer hears sender" has no reading (spec 4.3 wording where it fits). "–" glyph: the hearer's table
 *  was read and does not list the sender; "?": there is no table to ask (links.js unknownGlyph). */
function unknownReason(hearer, r) {
  if (r && r.strength === "none") return "reported as no link";
  if (r) return "lqi 0";
  if (!hearer.hasTable) return hearer.kind === "hub" || hearer.role === "border router" || hearer.matter === false
    ? "no table (not a Matter node)" : "table missing or stale";
  return "not in the neighbour table";
}

/** Group the snapshot's Thread nodes by extended PAN id; returns the ext PAN id of the largest group (spec 3.2:
 *  networks are grouped by extended PAN id), or null. */
function largestNetwork(nodes) {
  const count = new Map();
  for (const n of nodes) {
    const pan = text(n.ext_pan_id);
    if (pan) count.set(pan.toLowerCase(), (count.get(pan.toLowerCase()) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p)[0] || null;
}

/** Build a Network from the answer of `matter/network_topology` and, optionally, Home Assistant's device and area
 *  registries (names, areas). Returns null when the answer holds no Thread node. Shape: model/index.js with engine
 *  "thread", plus `collectedAt`, `extPanId` and per device the Thread fields (extAddress, rloc16, nodeId, threadRole,
 *  leader, reed, matter, availabilityKnown). */
export function buildThreadNetwork(topology, { deviceRegistry, areaRegistry, capabilities = THREAD_CAPABILITIES } = {}) {
  const raw = topology && typeof topology === "object" ? topology : {};
  const all = (Array.isArray(raw.nodes) ? raw.nodes : []).filter((n) => n && typeof n === "object");
  const unresolved = { neighbours: 0, routes: 0, duplicates: 0, ignored: 0 };
  // Wi-Fi access points and Wi-Fi links exist in the schema (matter.js server, schema 13): not part of a Thread map.
  const thread = all.filter((n) => n.network_type === "thread" && n.kind !== "wifi_ap");
  unresolved.ignored = all.length - thread.length;
  if (!thread.length) return null;
  const pan = largestNetwork(thread);
  const nodes = pan ? thread.filter((n) => !text(n.ext_pan_id) || text(n.ext_pan_id).toLowerCase() === pan) : thread;
  unresolved.ignored += thread.length - nodes.length;
  const registry = registryIndex(deviceRegistry);
  const areas = new Map();
  for (const a of Array.isArray(areaRegistry) ? areaRegistry : []) if (a && a.area_id) areas.set(a.area_id, text(a.name));

  const devices = [];
  const byNode = new Map(); // snapshot node id -> device
  for (const n of nodes) {
    const nodeKey = n.id === undefined || n.id === null ? null : String(n.id);
    if (nodeKey === null || byNode.has(nodeKey)) { unresolved.duplicates += 1; continue; }
    const address = extAddress(n.ext_address);
    const id = address || `thread:${nodeKey}`;
    if (devices.some((d) => d.id === id)) { unresolved.duplicates += 1; continue; }
    const kind = text(n.kind);
    const isBorderRouter = kind === "border_router";
    const mapped = ROLE_MAP[text(n.role) && text(n.role).toLowerCase()] || null;
    const role = isBorderRouter ? "border router" : mapped ? mapped.role : "unknown";
    const entry = registry.get(n.ha_device_id) || null;
    const areaId = (entry && entry.area_id) || null;
    const vendor = text(n.vendor_name) || text(entry && entry.manufacturer);
    const model = text(n.model_name) || text(entry && entry.model);
    const userName = text(entry && entry.name_by_user);
    const haName = text(entry && entry.name);
    const label = userName || haName || text(n.host_name) || model
      || (isBorderRouter ? "Border router" : kind === "matter" && int(n.node_id) !== null ? `Matter node ${n.node_id}`
        : `Thread device ${id.slice(-5)}`);
    const device = {
      id, registryId: (entry && entry.id) || null, nwk: int(n.rloc16), role,
      label, labelKind: userName ? "user" : haName ? "ha" : "model", name: haName || label, haName,
      area: (areaId && areas.get(areaId)) || null, areaId, firmware: text(entry && entry.sw_version), entities: [],
      vendor, model,
      // The snapshot names no power source; a border router is a mains device by nature (spec 8: wired).
      powerSource: isBorderRouter ? "Mains" : null,
      kind: isBorderRouter ? "hub" : "unknown", sleepy: isBorderRouter ? false : mapped ? mapped.sleepy : null,
      battery: false, wired: isBorderRouter,
      // available null (border routers: seen by mDNS, not by Matter) is not "offline": drawn as available, and the
      // details say the snapshot does not report it.
      available: n.available !== false, availabilityKnown: typeof n.available === "boolean",
      lastSeen: isoTime(n.last_seen),
      parent: null, children: [], relayLoad: 0, rating: null, hasTable: false,
      tableSize: null, tableCapacity: null, tableCapacitySource: null, tableFull: null,
      parentLqi: null, parentFromStaleTable: false, possiblyStaleParents: [],
      // Thread fields (spec 3.2), shown in the details.
      nodeKey, nodeId: int(n.node_id), extAddress: address, rloc16: int(n.rloc16), extPanId: text(n.ext_pan_id),
      networkName: text(n.network_name), threadRole: text(n.role), leader: Boolean(mapped && mapped.leader),
      reed: Boolean(mapped && mapped.reed), matter: kind === "matter", threadKind: kind, isBridge: n.is_bridge === true,
    };
    devices.push(device);
    byNode.set(nodeKey, device);
  }
  // Labels must tell devices apart (spec 8): identical ones get the RLOC16 or the address tail.
  const seen = new Map();
  for (const d of devices) seen.set(d.label, (seen.get(d.label) || 0) + 1);
  for (const d of devices) {
    if (seen.get(d.label) > 1) d.label += ` (${d.rloc16 !== null ? "0x" + d.rloc16.toString(16).toUpperCase().padStart(4, "0") : d.id.slice(-5)})`;
  }

  const readings = [];
  const stale = [];
  const links = [];
  const byKey = new Map();
  for (const c of Array.isArray(raw.connections) ? raw.connections : []) {
    if (!c || c.network !== "thread") { unresolved.ignored += 1; continue; }
    const a = byNode.get(String(c.source));
    const b = byNode.get(String(c.target));
    if (!a || !b || a === b) { unresolved.neighbours += 1; continue; }
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (byKey.has(key)) { unresolved.duplicates += 1; continue; }
    byKey.set(key, true);
    const [atSource, atTarget] = RECEIVER_OF_SOURCE_TO_TARGET === "source"
      ? [c.source_to_target, c.target_to_source] : [c.target_to_source, c.source_to_target];
    const rs = reading(a.id, b.id, atSource, c);
    const rt = reading(b.id, a.id, atTarget, c);
    links.push({ a: a.id, b: b.id, strength: text(c.strength), pathCost: int(c.path_cost) });
    for (const r of [rs, rt]) {
      if (!r) continue;
      const reporter = r.reporter === a.id ? a : b;
      // A table is "read" when its device reports at least one direction; an unavailable reporter's table is stale
      // (as for ZHA, spec 5.6): kept for the details, never drawn or counted.
      if (reporter.available) { reporter.hasTable = true; readings.push(r); } else stale.push(r);
    }
  }
  for (const d of devices) {
    if (d.hasTable) d.tableSize = readings.filter((r) => r.reporter === d.id).length;
  }

  // Parent of an end device (tq2, owner decision 2026-11-01). A Thread child holds exactly one neighbour entry, its
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
  const collectedAt = isoTime(raw.collected_at);
  return {
    engine: "thread",
    source: THREAD_SOURCE,
    // Settings are kept per network (spec 11): the extended PAN id names a Thread network (spec 4.1).
    id: `thread-${(pan || "unknown").replace(/[^A-Za-z0-9]/g, "").slice(0, 32) || "unknown"}`,
    extPanId: pan,
    capabilities,
    collectedAt,
    devices, readings, staleReadings: stale, routes: [], links, pairs,
    status: threadStatus(devices, pairs, collectedAt),
    findings: threadFindings(devices),
    unresolved,
  };
}

/** Evidence per direction for every linked pair (spec 4.3), the shape of model/pairs.js: { a, b, ab, ba }, ab = "a
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

/** Status line numbers (spec 6) in the shape of model/findings.js computeStatus, plus the Thread coverage: nodes, links
 *  (pairs), links measured in both directions, border routers listed, the collection time. Thread has no "router
 *  tables x/y" line and no completeness banner: every Matter node's table comes with the snapshot. */
export function threadStatus(devices, pairs, collectedAt) {
  const routers = devices.filter((d) => d.role === "router" && d.available);
  const both = pairs.filter((p) => p.ab.state === "measured" && p.ba.state === "measured").length;
  return {
    routersAvailable: routers.length,
    routersWithTable: routers.filter((d) => d.hasTable).length,
    devicesListed: devices.filter((d) => pairs.some((p) => p.a === d.id || p.b === d.id)).length,
    devicesTotal: devices.length,
    unavailable: devices.filter((d) => !d.available).length,
    completeness: 1,
    nodes: devices.length,
    links: pairs.length,
    linksBoth: both,
    borderRouters: devices.filter((d) => d.role === "border router").length,
    collectedAt,
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
      out.push({ kind: "parent offline", device: d.id, evidence: { parent: d.parent, parentLastSeen: byId.get(d.parent).lastSeen,
        listedInStaleTable: false, lastKnown: false }, missing: [] });
    }
  }
  for (const d of devices) {
    if (d.role === "end device" && d.available && !d.parent) {
      out.push({ kind: "parent unknown", device: d.id, evidence: { verdict: "no parent link" }, missing: [] });
    }
  }
  return out;
}
