// SPDX-License-Identifier: MIT
// What a device's `zha/devices` entry says about the node itself (spec 9.2 "Entity" and "Cluster"; design by Fabian
// Schwamborn, 2026-11-01): the node descriptor decoded into readable facts, and the endpoints of the signature as a
// cluster table. Field meanings from the Zigbee specification (05-3474, revision 22): the node descriptor's logical
// type (2.3.2.3.1), frequency band (2.3.2.3.5), MAC capability flags (2.3.2.3.6, from IEEE 802.15.4), manufacturer
// code, buffer and transfer sizes and server mask (2.3.2.3.10, whose bits 9-15 carry the stack compliance revision
// since r21). Pure functions, no DOM; zcl.js has the names. node --test tests/
import { parseAddress } from "./parse.js";
import { isManufacturerSpecific } from "./zcl.js";

/** Logical types of the node descriptor. */
export const LOGICAL_TYPES = Object.freeze({ 0: "coordinator", 1: "router", 2: "end device" });

const int = (v) => {
  const n = parseAddress(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** MAC capability flags, bit by bit; null when the value is missing. */
export function macCapabilities(flags) {
  const f = int(flags);
  if (f === null) return null;
  return {
    alternatePanCoordinator: Boolean(f & 0x01),
    fullFunction: Boolean(f & 0x02), // a full-function device (router-capable); clear for a reduced-function one
    mainsPower: Boolean(f & 0x04),
    rxOnWhenIdle: Boolean(f & 0x08), // clear: the receiver sleeps when idle
    security: Boolean(f & 0x40),
    allocateAddress: Boolean(f & 0x80),
  };
}

/** Stack compliance revision from the server mask (bits 9-15): 22 for r22, 0 for a device older than r21 (the field
 *  did not exist), null when the mask is missing. */
export function stackRevision(serverMask) {
  const m = int(serverMask);
  return m === null ? null : (m >> 9) & 0x7f;
}

/** Bands of the frequency band field, as keys: "868" (868-868.6 MHz), "915" (902-928 MHz), "2400" (2.4 GHz) and
 *  "subghz" (the European sub-GHz bands of r22). An empty list when the field is missing or says nothing. */
export function frequencyBands(band) {
  const b = int(band);
  if (b === null) return [];
  return [[0x01, "868"], [0x04, "915"], [0x08, "2400"], [0x10, "subghz"]].filter(([bit]) => b & bit).map(([, key]) => key);
}

/** The node card of one device: raw is its `zha/devices` entry, device the model's Device (firmware comes from the
 *  device registry). Every field is null when its source is missing; unknown beats wrong. */
export function nodeCard(raw, device = {}) {
  const r = isObject(raw) ? raw : {};
  const sig = isObject(r.signature) ? r.signature : {};
  const nd = isObject(sig.node_descriptor) ? sig.node_descriptor : {};
  const lt = int(nd.logical_type);
  const quirkClass = text(r.quirk_class);
  return {
    logicalType: lt !== null && Object.hasOwn(LOGICAL_TYPES, lt) ? LOGICAL_TYPES[lt] : null,
    mac: macCapabilities(nd.mac_capability_flags),
    bands: frequencyBands(nd.frequency_band),
    revision: stackRevision(nd.server_mask),
    manufacturerCode: int(r.manufacturer_code) ?? int(nd.manufacturer_code),
    bufferSize: int(nd.maximum_buffer_size),
    transferIn: int(nd.maximum_incoming_transfer_size),
    transferOut: int(nd.maximum_outgoing_transfer_size),
    // ZHA names a class even without a quirk (the plain zigpy device): only an applied quirk counts.
    quirk: r.quirk_applied === true ? quirkClass : null,
    firmware: text(device.firmware),
    lastSeen: text(r.last_seen) || text(device.lastSeen),
  };
}

/** The signature's endpoints as a cluster table: [{ endpoint, profile, deviceType, clusters: [{ id, direction:
 *  "in" | "out", manufacturerSpecific }] }], endpoints in ascending order, within each the input (server) clusters
 *  first, then the output (client) ones, each by id. Ids that do not parse are left out. */
export function clusterTable(signature) {
  const eps = isObject(signature) && isObject(signature.endpoints) ? signature.endpoints : {};
  return Object.keys(eps).map((key) => [int(key), eps[key]]).filter(([n, ep]) => n !== null && isObject(ep))
    .sort((a, b) => a[0] - b[0])
    .map(([endpoint, ep]) => {
      const list = (dir, ids) => (Array.isArray(ids) ? ids : []).map(int).filter((id) => id !== null)
        .sort((a, b) => a - b).map((id) => ({ id, direction: dir, manufacturerSpecific: isManufacturerSpecific(id) }));
      return { endpoint, profile: int(ep.profile_id), deviceType: int(ep.device_type),
        clusters: [...list("in", ep.input_clusters), ...list("out", ep.output_clusters)] };
    });
}

/** The device's Home Assistant entity ids from its `zha/devices` entry, in the order ZHA gives them. */
export function entityIds(raw) {
  const list = isObject(raw) && Array.isArray(raw.entities) ? raw.entities : [];
  return list.map((e) => (isObject(e) ? text(e.entity_id) : null)).filter(Boolean);
}
