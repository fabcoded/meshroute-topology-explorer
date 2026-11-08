// SPDX-License-Identifier: MIT
// The Matter side of the Thread engine (spec 3.2, 4.6): maps the answer of `matter/network_topology` (Home Assistant
// 2026.9 or newer, read with refresh false: a snapshot built from the server's cache, no radio traffic) onto devices, readings
// and links, and holds the capability set of a Thread network read through Matter. The engine's model (model.js)
// derives parents, pairs, status and findings from it. Pure, no DOM.
// npm test
//
// What the snapshot gives and what it does not (capability set, spec 4.6): readings per direction (Thread link
// quality 0-3 and RSSI in dBm, measured by the receiver), the role of each node (leader, router, end device, sleepy
// end device, border router), a snapshot time. It has no next hop per destination: routes stay empty, so there
// are no paths, path stages or theoretical paths for Thread, and no up or down lanes; a parent link (an end device and
// the router it is attached to) is the only traffic the map can name. Unknown stays unknown: a missing value is null,
// never 0.
//
// Direction (API contract of matter.js server, packages/ws-client/src/models/model.ts NetworkTopologyConnection:
// "source_to_target: source -> target observation, when that direction reported the link", and its websocket schema
// changelog, schema 13: Thread links come "from the nodes' own ThreadNetworkDiagnostics (neighbor + route tables)",
// both observed directions are kept): the reporting node is `source` and the entry is its neighbour-table record of
// `target`, so `source_to_target` is "source hears target", received at the source. Confirmed by the capture: links to a border router (not a Matter node, no table read) carry only
// source_to_target.
import { disambiguateLabels, formatNwk, normalizeIeee } from "../../model/parse.js";
import { entitiesByDevice, threadKind } from "./kinds.js";

/** Text of the status line's source part. */
export const THREAD_SOURCE = "thread";
/** Capabilities of a Thread network read through Matter (spec 4.6): what views, stages and findings may use. No
 *  routes, no ratings (the Zigbee LQI scale), no scan, observations, clusters, route records or device page. */
export const THREAD_CAPABILITIES = Object.freeze({
  routes: false, parents: true, ratings: false, measurementTime: true, userRefresh: true, scan: false,
  observations: false, clusters: false, routeRecords: false, devicePage: false, scale: "thread-lqi",
});

/** Thread roles of the snapshot (spec 3.2) -> model role (spec 4.2) and sleep; any other role is unknown. A leader is a router with the "L" crown (spec 8);
 *  a REED (router-eligible end device) is attached like an end device and listens when idle. */
const ROLE_MAP = {
  leader: { role: "router", sleepy: false, leader: true },
  router: { role: "router", sleepy: false },
  reed: { role: "end device", sleepy: false, reed: true },
  end_device: { role: "end device", sleepy: false },
  sleepy_end_device: { role: "end device", sleepy: true },
};
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
 *  ("none") with a valid RSSI is a measured low reading: the stack still lists the neighbour (tq2). Link quality 0 without a valid RSSI (a fresh entry without samples) and strength "unknown" (no
 *  measurement) are not measured and never drawn as a dead link (spec 3.2). */
function reading(reporter, subject, dir) {
  if (!dir || typeof dir !== "object") return null;
  const lqi = threadLqi(dir.lqi);
  const rssi = threadRssi(dir.rssi);
  const strength = text(dir.strength);
  if (lqi === null && rssi === null && strength === null && dir.lqi === undefined) return null; // an empty object
  const measured = strength !== "unknown" && ((lqi !== null && lqi > 0) || rssi !== null);
  return { reporter, subject, lqi, rssi, strength, measured, scale: "thread-lqi", relationship: null, rating: null };
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

/** The snapshot mapped for the Thread engine's model: the Thread nodes of the largest network (by extended PAN id) as
 *  devices (labels made distinct), the readings of available reporters, the stale ones of unavailable reporters, the
 *  links and what could not be resolved, the extended PAN id and the snapshot time. tableRead marks a device whose
 *  neighbour table came with the snapshot. Null when the answer holds no Thread node. */
export function fromMatter(topology, { deviceRegistry, areaRegistry, entities, states } = {}) {
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
  const entitiesOf = entitiesByDevice(entities, states); // empty without hass.entities: every kind stays unknown
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
      id, registryId: (entry && entry.id) || null, role,
      label, labelKind: userName ? "user" : haName ? "ha" : "model", name: haName || label, haName,
      area: (areaId && areas.get(areaId)) || null, areaId, firmware: text(entry && entry.sw_version), entities: [],
      vendor, model,
      // The snapshot names no power source; a border router is a mains device by nature (spec 8: wired).
      powerSource: isBorderRouter ? "Mains" : null,
      kind: isBorderRouter ? "hub" : threadKind(entitiesOf.get(n.ha_device_id)), sleepy: isBorderRouter ? false : mapped ? mapped.sleepy : null,
      // Battery or not is unknown (no power source in the snapshot), and so are relay load and rating (no routes, no
      // Zigbee LQI scale): null, never a Zigbee default.
      battery: null, wired: isBorderRouter,
      // available null (border routers: seen by mDNS, not by Matter) is not "offline": drawn as available, and the
      // details say the snapshot does not report it.
      available: n.available !== false, availabilityKnown: typeof n.available === "boolean",
      lastSeen: isoTime(n.last_seen),
      parent: null, children: [], relayLoad: null, rating: null, tableRead: false,
      parentLqi: null, possiblyStaleParents: [],
      // Thread fields (spec 3.2), shown in the details.
      nodeKey, nodeId: int(n.node_id), extAddress: address, rloc16: int(n.rloc16), extPanId: text(n.ext_pan_id),
      threadRole: text(n.role), leader: Boolean(mapped && mapped.leader),
      reed: Boolean(mapped && mapped.reed), matter: kind === "matter",
    };
    devices.push(device);
    byNode.set(nodeKey, device);
  }
  disambiguateLabels(devices, (d) => (d.rloc16 !== null ? formatNwk(d.rloc16) : d.id.slice(-5)));

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
    const rs = reading(a.id, b.id, c.source_to_target);
    const rt = reading(b.id, a.id, c.target_to_source);
    links.push({ a: a.id, b: b.id });
    for (const r of [rs, rt]) {
      if (!r) continue;
      const reporter = r.reporter === a.id ? a : b;
      // A table is "read" when its device reports at least one direction; an unavailable reporter's table is stale
      // (as for ZHA, spec 5.6): kept for the details, never drawn or counted.
      if (reporter.available) { reporter.tableRead = true; readings.push(r); } else stale.push(r);
    }
  }
  return { pan, devices, readings, stale, links, unresolved, collectedAt: isoTime(raw.collected_at) };
}
