// SPDX-License-Identifier: MIT
// The Matter side of the Thread engine (spec 3.2, 4.6): maps the answer of `matter/network_topology` (Home Assistant
// 2026.9 or newer, read with refresh false: a snapshot built from the server's cache, no radio traffic) onto devices, readings
// and links, and holds the capability set of a Thread network read through Matter. The border routers Home Assistant's
// Thread integration lists name the snapshot's border routers and add those it lacks (#20). The engine's model
// (model.js) derives parents, pairs, status and findings from it. Pure, no DOM.
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

/** The border routers Home Assistant's Thread integration knows in network `pan` (spec 3.2 "Border routers", #20):
 *  { routers: extended address -> { name, vendor, model } (instance_name, vendor_name, model_name of
 *  thread/discover_routers, Home Assistant 2026.11.0 thread/discovery.py ThreadRouterDiscoveryData), preferred: the
 *  preferred_extended_address of the preferred dataset (thread/list_datasets), or null }. Only entries whose
 *  extended_pan_id is `pan`: the integration writes hex in lower case (bytes.hex()), the snapshot in upper case.
 *  haThread: { datasets (the answer of thread/list_datasets), routers (the discovered routers' data) }, each null where
 *  its command failed; null without the integration. */
function haBorderRouters(haThread, pan) {
  const routers = new Map();
  const inPan = (x) => Boolean(pan && x && typeof x.extended_pan_id === "string" && x.extended_pan_id.toLowerCase() === pan);
  for (const r of Array.isArray(haThread && haThread.routers) ? haThread.routers : []) {
    const address = inPan(r) ? extAddress(r.extended_address) : null;
    if (address) routers.set(address, { name: text(r.instance_name), vendor: text(r.vendor_name), model: text(r.model_name) });
  }
  const answer = haThread && haThread.datasets;
  const datasets = answer && Array.isArray(answer.datasets) ? answer.datasets : [];
  const chosen = datasets.find((d) => inPan(d) && d.preferred === true);
  return { routers, preferred: chosen ? extAddress(chosen.preferred_extended_address) : null };
}

/** The names of node `n`: { label, labelKind, haName, vendor, model }. Label (spec 3.2 "Name"): the user's or Home
 *  Assistant's name (device registry through ha_device_id), else a border router's mDNS instance name (`known`, from
 *  haBorderRouters), its host_name, the model, else a generic name. Vendor and model: the snapshot's, else the
 *  registry's, else the Thread integration's. No reliable way maps a border router to a registry device or config
 *  entry otherwise: registry connections carry no Thread address, and the OTBR entry's data needs the OTBR commands,
 *  which return keys (spec 3.4). */
function names(n, entry, known, id) {
  const userName = text(entry && entry.name_by_user);
  const haName = text(entry && entry.name);
  const vendor = text(n.vendor_name) || text(entry && entry.manufacturer) || known?.vendor || null;
  const model = text(n.model_name) || text(entry && entry.model) || known?.model || null;
  const kind = text(n.kind);
  const fallback = kind === "border_router" ? "Border router"
    : kind === "matter" && int(n.node_id) !== null ? `Matter node ${n.node_id}` : `Thread device ${id.slice(-5)}`;
  const label = userName || haName || known?.name || text(n.host_name) || model || fallback;
  return { label, labelKind: userName ? "user" : haName ? "ha" : "model", haName, vendor, model };
}

/** Make labels unique (spec 8): the RLOC16 of a device that has one, the end of the key (the extended address) for a
 *  border router (#20: two of the same model) or a device without RLOC16; where that tail is shared too, the whole
 *  key. */
function distinctLabels(devices) {
  const tail = (d) => (d.role !== "border router" && d.rloc16 !== null ? formatNwk(d.rloc16) : d.id.slice(-5));
  const base = new Map(devices.map((d) => [d, d.label]));
  disambiguateLabels(devices, (d) => (devices.some((o) => o !== d && base.get(o) === base.get(d) && tail(o) === tail(d))
    ? d.id : tail(d)));
}

/** The snapshot mapped for the Thread engine's model: the Thread nodes of the largest network (by extended PAN id) as
 *  devices (labels made distinct), the readings of available reporters, the stale ones of unavailable reporters, the
 *  links and what could not be resolved, the extended PAN id and the snapshot time. tableRead marks a device whose
 *  neighbour table came with the snapshot. haThread: the answers of Home Assistant's Thread integration
 *  (haBorderRouters), or null. Null when the answer holds no Thread node. */
export function fromMatter(topology, { deviceRegistry, areaRegistry, entities, states, haThread = null } = {}) {
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
  const ha = haBorderRouters(haThread, pan);
  // The Matter server lists a border router only where a Matter node's neighbour table names it with a live link
  // (matterjs-server main 0bf72c3, NetworkTopologyService.ts #build): one Home Assistant knows and the snapshot lacks
  // becomes a node without connections, drawn without lanes and never a route's destination (#20).
  const listed = new Set(nodes.map((n) => extAddress(n.ext_address)));
  const unheard = [...ha.routers.keys()].filter((a) => !listed.has(a)).map((a) => ({ id: `ha:${a}`,
    kind: "border_router", network_type: "thread", ext_address: a, ext_pan_id: pan, available: null }));

  const devices = [];
  const byNode = new Map(); // snapshot node id -> device
  for (const n of [...nodes, ...unheard]) {
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
    const { label, labelKind, haName, vendor, model } = names(n, entry, ha.routers.get(address), id);
    const device = {
      id, registryId: (entry && entry.id) || null, role,
      label, labelKind, name: haName || label, haName,
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
      // #20: false for a border router only Home Assistant's Thread integration lists; preferred: the preferred
      // border router of Home Assistant's preferred dataset.
      inTopology: !unheard.includes(n), preferred: ha.preferred !== null && address === ha.preferred,
    };
    devices.push(device);
    byNode.set(nodeKey, device);
  }
  distinctLabels(devices);

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
