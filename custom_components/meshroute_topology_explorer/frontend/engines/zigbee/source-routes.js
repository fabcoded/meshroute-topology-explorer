// SPDX-License-Identifier: MIT
// Return paths without a table entry (spec 5.1 "source route"; decisions by Fabian Schwamborn, 2026-11-01). A ZHA
// coordinator reaches many devices by source routing: it keeps no routing entry for them and sends along the relay
// list the device's own route record gave it, which is the device's way up, reversed. Home Assistant does not expose
// those route records, so the measured down path of such a device stays unknown (spec 3.1). Three stages:
// - "off": the down path stays unknown;
// - "assume" (default): the up path reversed, always marked as assumed and never as measured;
// - "zigpy" (experimental): the route records as zigpy holds them (the integration's command zigpy_routes, attached
//   to the network as `network.zigpy` by adapters/zha.js), drawn as measured where they pass a strict gate; every
//   other device gets the assumption as under "assume". A record only fills a gap: it never replaces a complete
//   measured down path, and where it disagrees with one, zigpyRecords says so (Details), nothing is drawn.
// Pure functions over a Network. npm test
import { downPath, upPath, activeRoute } from "./paths.js";
import { pairEvidence } from "./pairs.js";
import { normalizeIeee } from "../../model/parse.js";

/** The stages (spec 11 `sourceRoute`); anything else counts as the default. */
export const SOURCE_ROUTE_MODES = Object.freeze(["off", "assume", "zigpy"]);
export const DEFAULT_SOURCE_ROUTE = "assume";

/** A stored or passed stage as one of SOURCE_ROUTE_MODES. */
export function sourceRouteMode(value) {
  return SOURCE_ROUTE_MODES.includes(value) ? value : DEFAULT_SOURCE_ROUTE;
}

/** The stage as the map draws it: like sourceRouteMode, but a missing or unknown value is "off" (the graph's default
 *  before the settings arrive, unchanged since A4i). */
export function drawMode(value) {
  return SOURCE_ROUTE_MODES.includes(value) ? value : "off";
}

const cache = new WeakMap(); // network -> Map id -> assumed down path
const recordCache = new WeakMap(); // network -> { paths, differs }

/** Assumed down paths per device id: { ids (coordinator first), complete: true, assumed: true }. A device gets one
 *  only when all of this holds, so the assumption never hides a gap of another kind (unknown beats wrong):
 *  - it is available and not the coordinator, and the coordinator's own table is there (without it, a missing entry
 *    says nothing);
 *  - the coordinator's table holds no active, current route towards it (with one, a broken walk is a gap elsewhere);
 *  - its measured down path is incomplete;
 *  - its up path is complete, so the reversal is a whole path. A direct neighbour of the coordinator thus gets a
 *    one-hop return path. */
export function assumedDownPaths(network) {
  let out = cache.get(network);
  if (out) return out;
  out = new Map();
  cache.set(network, out);
  const devices = network.devices || [];
  const coordinator = devices.find((d) => d.role === "coordinator");
  if (!coordinator || !coordinator.hasTable) return out;
  for (const d of devices) {
    if (d === coordinator || !d.available || activeRoute(network, coordinator.id, d.id)) continue;
    if (downPath(network, d.id).complete) continue;
    const up = upPath(network, d.id);
    if (!up.complete) continue;
    out.set(d.id, { ids: [...up.ids].reverse(), complete: true, assumed: true });
  }
  return out;
}

/** The recorded way of one zigpy record, coordinator first, or null when the record cannot be trusted now: the
 *  device's current network address must equal the one zigpy holds (a rejoin may change it), and every relay must be
 *  a known, available device that holds that address now, without repeats. */
function recordedIds(d, record, byId, coordinator) {
  if (record.nwk !== d.nwk) return null;
  const relays = [];
  for (const r of record.relays) {
    const id = normalizeIeee(r && r.ieee);
    const relay = id ? byId.get(id) : null;
    if (!relay || !relay.available || relay.nwk !== r.nwk || relay.id === d.id || relay.id === coordinator.id) return null;
    if (relays.includes(id)) return null; // a loop
    relays.push(id);
  }
  // zigpy lists the relays from the device towards the coordinator (it sends its own source route reversed).
  return [coordinator.id, ...relays.reverse(), d.id];
}

/** zigpy's route records against the tables (cached per network): { paths: Map id -> { ids, complete: true,
 *  recorded: true }, differs: Map id -> ids }. A record becomes a path only when all of this holds:
 *  - zigpy answered (network.zigpy.status "ok") and holds a record for the device;
 *  - the device is available and not the coordinator; its measured down path is incomplete;
 *  - the coordinator's table, if it is there, holds no active route towards the device (with one, the coordinator
 *    routes by table and the gap lies elsewhere);
 *  - the record passes recordedIds (current addresses, available relays, no loop);
 *  - every hop joins two devices the model has a pair for, so the map can draw it.
 *  `differs`: devices whose measured down path is complete and whose usable record takes another way. */
export function zigpyRecords(network) {
  let out = recordCache.get(network);
  if (out) return out;
  out = { paths: new Map(), differs: new Map() };
  recordCache.set(network, out);
  const z = network.zigpy;
  const devices = network.devices || [];
  const coordinator = devices.find((d) => d.role === "coordinator");
  if (!z || z.status !== "ok" || !(z.records instanceof Map) || !coordinator) return out;
  const byId = new Map(devices.map((d) => [d.id, d]));
  const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const pairs = new Set(pairEvidence(network).map((p) => pairKey(p.a, p.b)));
  for (const [id, record] of z.records) {
    const d = byId.get(id);
    if (!d || d === coordinator || !d.available) continue;
    const ids = recordedIds(d, record, byId, coordinator);
    if (!ids) continue;
    const measured = downPath(network, id);
    if (measured.complete) {
      if (measured.ids.join() !== ids.join()) out.differs.set(id, ids);
      continue;
    }
    if (coordinator.hasTable && activeRoute(network, coordinator.id, id)) continue;
    if (!ids.every((x, i) => i === 0 || pairs.has(pairKey(ids[i - 1], x)))) continue;
    out.paths.set(id, { ids, complete: true, recorded: true });
  }
  return out;
}

/** Return paths that replace an unknown down path under a stage: Map id -> walk. "off": none; "assume": the assumed
 *  ones; "zigpy": the recorded ones, and the assumed ones for every device without a recorded path. */
export function returnPaths(network, mode = DEFAULT_SOURCE_ROUTE) {
  const stage = sourceRouteMode(mode);
  if (stage === "off") return new Map();
  const assumed = assumedDownPaths(network);
  if (stage === "assume") return assumed;
  const { paths } = zigpyRecords(network);
  const out = new Map(paths);
  for (const [id, walk] of assumed) if (!out.has(id)) out.set(id, walk);
  return out;
}

/** The down path of `id` under a stage: the recorded or assumed one where it applies, else the measured one
 *  ({ ids, complete }, paths.js). */
export function downPathWith(network, id, mode = DEFAULT_SOURCE_ROUTE) {
  return returnPaths(network, mode).get(id) || downPath(network, id);
}

/** Numbers for the status line and spec 12: { mode, count, recorded, zigpy }. count: devices with an assumed return
 *  path under the stage (drawn as assumed under "assume" and "zigpy", unknown under "off"); recorded: devices with a
 *  path from a route record (stage "zigpy" only); zigpy: the state of zigpy's answer under "zigpy", else null:
 *  { status: "ok" | "not_supported" | "missing", reason, radio }. */
export function sourceRouteSummary(network, mode = DEFAULT_SOURCE_ROUTE) {
  const stage = sourceRouteMode(mode);
  const assumed = assumedDownPaths(network);
  if (stage !== "zigpy") return { mode: stage, count: assumed.size, recorded: 0, zigpy: null };
  const { paths } = zigpyRecords(network);
  const z = network.zigpy;
  const count = [...assumed.keys()].filter((id) => !paths.has(id)).length;
  return { mode: stage, count, recorded: paths.size,
    zigpy: z ? { status: z.status, reason: z.reason || null, radio: z.radio || null } : { status: "missing", reason: null, radio: null } };
}
