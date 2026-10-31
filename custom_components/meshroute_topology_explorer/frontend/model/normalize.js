// SPDX-License-Identifier: MIT
// Turns the raw answer of `zha/devices` (plus optional registry answers) into devices, readings, routes and parents
// (spec 3.1, 4). Pure functions. Derived facts (ratings, paths, findings) live in the sibling modules.
//
// Why these choices: devices are keyed by IEEE; the network address is used only to resolve a neighbour entry whose
// IEEE is unusable and to resolve routing entries, which carry no IEEE. The tables of an unavailable device are
// stale: its readings are dropped; its routes are kept but flagged `stale` and never followed by path walks
// (a later "last known" view may use them).
import { parseAddress, parseLqi, normalizeIeee, formatNwk } from "./parse.js";

const ROLES = { Coordinator: "coordinator", Router: "router", EndDevice: "end device" };
const isActive = (status) => typeof status === "string" && status.trim().toLowerCase() === "active";
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Registry lookups: ZHA device -> registry entry (by device_reg_id, else by the ["zha", ieee] identifier). */
function indexRegistries(deviceRegistry, areaRegistry) {
  const byRegId = new Map();
  const byIeee = new Map();
  for (const entry of Array.isArray(deviceRegistry) ? deviceRegistry : []) {
    if (!entry) continue;
    byRegId.set(entry.id, entry);
    for (const pair of Array.isArray(entry.identifiers) ? entry.identifiers : []) {
      if (Array.isArray(pair) && pair[0] === "zha") {
        const ieee = normalizeIeee(pair[1]);
        if (ieee) byIeee.set(ieee, entry);
      }
    }
  }
  const areas = new Map();
  for (const a of Array.isArray(areaRegistry) ? areaRegistry : []) if (a && a.area_id) areas.set(a.area_id, text(a.name));
  return { byRegId, byIeee, areas };
}

/** The one display text for list and map: the user's name; else "Coordinator"; else the model ("RODRET Dimmer"),
 *  which tells devices apart better than the full ZHA name. `labelKind` lets the panel translate "Coordinator". */
function baseLabel(device, userName) {
  if (userName) return { label: userName, labelKind: "user" };
  if (device.role === "coordinator") return { label: "Coordinator", labelKind: "coordinator" };
  return { label: device.model || device.name, labelKind: "model" };
}

/** Make labels unique (spec 8): identical labels get the network address appended in upper-case hex, or the IEEE
 *  tail when the address is unknown. */
function disambiguate(devices) {
  const count = new Map();
  for (const d of devices) count.set(d.label, (count.get(d.label) || 0) + 1);
  for (const d of devices) {
    if (count.get(d.label) > 1) d.label += ` (${d.nwk === null ? d.id.slice(-5) : formatNwk(d.nwk)})`;
  }
}

/** Normalize the raw `zha/devices` list. Returns { devices, readings, routes, unresolved }.
 *  Every device has parent/children fields; ratings and relayLoad are filled in later (ratings.js, paths.js, index.js). */
export function normalize(rawDevices, { deviceRegistry, areaRegistry } = {}) {
  const raws = new Map();
  for (const r of Array.isArray(rawDevices) ? rawDevices : []) {
    const id = r && normalizeIeee(r.ieee);
    if (id && !raws.has(id)) raws.set(id, r);
  }
  const reg = indexRegistries(deviceRegistry, areaRegistry);

  const devices = [];
  const byId = new Map();
  for (const [id, r] of raws) {
    const entry = reg.byRegId.get(r.device_reg_id) || reg.byIeee.get(id) || null;
    const areaId = (entry && entry.area_id) || r.area_id || null;
    const role = ROLES[r.device_type] || "unknown";
    const powerSource = text(r.power_source);
    const name = text(r.name) || id;  // the full ZHA name ("IKEA of Sweden RODRET Dimmer"); the label is shorter
    const userName = text(r.user_given_name) || text(entry && entry.name_by_user);
    const device = {
      id, registryId: (entry && entry.id) || null, nwk: parseAddress(r.nwk), role, label: name, labelKind: "model", name,
      area: (areaId && reg.areas.get(areaId)) || null,
      vendor: text(r.manufacturer), model: text(r.model), powerSource,
      // ZHA reports unknown power as "Battery or Unknown"; the interface calls an end device with it a battery device.
      battery: role === "end device" && /battery/i.test(powerSource || ""),
      available: Boolean(r.available), lastSeen: text(r.last_seen),
      parent: null, children: [], relayLoad: 0, rating: null, hasTable: false,
      parentLqi: null, parentFromStaleTable: false, possiblyStaleParents: [],
    };
    Object.assign(device, baseLabel(device, userName));
    devices.push(device);
    byId.set(id, device);
  }
  disambiguate(devices);

  // NWK addresses can collide in stale tables; an ambiguous address resolves to nothing rather than to a guess.
  const nwkOwner = new Map();
  for (const d of devices) if (d.nwk !== null) nwkOwner.set(d.nwk, nwkOwner.has(d.nwk) ? null : d.id);
  const byNwk = (value) => nwkOwner.get(parseAddress(value)) || null;
  /** Neighbour entry -> device id. A usable IEEE decides, even when it names an unknown device. */
  const resolveNeighbour = (n) => {
    const ieee = normalizeIeee(n.ieee);
    return ieee ? (byId.has(ieee) ? ieee : null) : byNwk(n.nwk);
  };

  const readings = [];
  const routes = [];
  const candidates = new Map(); // end device id -> [{ reporter, lqi, stale }]
  const unresolved = { neighbours: 0, routes: 0 };
  for (const [id, r] of raws) {
    const owner = byId.get(id);
    const neighbours = Array.isArray(r.neighbors) ? r.neighbors : [];
    owner.hasTable = owner.available && neighbours.length > 0;
    for (const n of neighbours) {
      const subject = n && resolveNeighbour(n);
      if (!subject) { unresolved.neighbours += 1; continue; }
      if (subject === id) continue;
      const lqi = parseLqi(n.lqi);
      const relationship = text(n.relationship);
      if (owner.available) {
        readings.push({ reporter: id, subject, lqi, scale: "zigbee-lqi", relationship, rating: null });
      }
      // Child entries between routers record joining, not routing (spec 3.1); only end devices get a parent.
      const subjectDevice = byId.get(subject);
      if (relationship === "Child" && subjectDevice.role === "end device" && owner.role !== "end device"
        && owner.role !== "unknown") {
        if (!candidates.has(subject)) candidates.set(subject, []);
        candidates.get(subject).push({ reporter: id, lqi, stale: !owner.available });
      }
    }
    for (const e of Array.isArray(r.routes) ? r.routes : []) {
      const destination = e && byNwk(e.dest_nwk);
      const nextHop = e && byNwk(e.next_hop);
      if (!destination || !nextHop) { unresolved.routes += 1; continue; }
      routes.push({ owner: id, destination, nextHop, status: text(e.route_status) || "unknown",
        direct: destination === nextHop, stale: !owner.available });
    }
  }

  // Parent: the listing with the higher LQI wins; a listing in a current table beats one in a stale table, so an end
  // device that re-joined elsewhere is not pinned to its old, offline parent. Other listings stay as "possibly stale".
  for (const [subject, list] of candidates) {
    const ranked = [...list].sort((a, b) => (a.stale - b.stale) || ((b.lqi ?? -1) - (a.lqi ?? -1))
      || (a.reporter < b.reporter ? -1 : 1));
    const best = ranked[0];
    const device = byId.get(subject);
    device.parent = best.reporter;
    device.parentLqi = best.lqi;
    device.parentFromStaleTable = best.stale;
    device.possiblyStaleParents = ranked.slice(1).map((c) => c.reporter);
  }
  for (const d of devices) {
    if (d.parent) byId.get(d.parent).children.push(d.id);
  }
  for (const d of devices) d.children.sort();

  return { devices, readings, routes, unresolved };
}

export { isActive };
