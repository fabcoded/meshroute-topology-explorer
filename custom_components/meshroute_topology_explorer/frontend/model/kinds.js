// SPDX-License-Identifier: MIT
// What a device is, for its picture on the map (spec 4.2, 8), and whether it sleeps: read from the signature that
// `zha/devices` already returns (spec 3.1), so no further command is needed. Pure functions, no DOM.
// Sources: the device and cluster identifiers of the Zigbee Home Automation profile (0x0104, also used by Zigbee
// Lighting & Occupancy and Zigbee 3.0), the Zigbee Light Link profile (0xc05e) and the Zigbee Cluster Library; the
// MAC capability field of the Zigbee specification (bit 3, receiver on when idle). Checked against the sample: every
// identifier the sample carries maps to the picture its model name suggests.
// node --test tests/

import { parseAddress } from "./parse.js";

/** Kinds a device can have; each has a picture (graph/symbols.js). "unknown" when the signature does not tell:
 *  unknown beats wrong (spec 1). */
export const KINDS = Object.freeze(["light", "outlet", "relay", "button", "sensor", "motion", "temperature",
  "thermostat", "blind", "lock", "hub", "unknown"]);

const HA = 0x0104;
const ZLL = 0xc05e;
/** Device identifiers per profile -> kind. Range extenders (0x0008) and alarm panels (0x0400) have no picture. */
const DEVICE_TYPES = {
  [HA]: {
    light: [0x0100, 0x0101, 0x0102, 0x0108, 0x0109, 0x010c, 0x010d],
    outlet: [0x0009, 0x0051, 0x010a, 0x010b],
    relay: [0x0002, 0x0003],
    button: [0x0000, 0x0001, 0x0004, 0x0006, 0x000b, 0x0103, 0x0104, 0x0105, 0x0201, 0x0203, 0x0401, 0x0800, 0x0810,
      0x0820, 0x0830],
    sensor: [0x000c, 0x0106, 0x0305, 0x0306, 0x0402, 0x0850],
    motion: [0x0107],
    temperature: [0x0302],
    thermostat: [0x0301],
    blind: [0x0200, 0x0202],
    lock: [0x000a],
    hub: [0x0050, 0x0840],
  },
  [ZLL]: {
    light: [0x0000, 0x0100, 0x0200, 0x0210, 0x0220],
    outlet: [0x0010, 0x0110],
    button: [0x0800, 0x0810, 0x0820, 0x0830],
    sensor: [0x0850],
    hub: [0x0840],
  },
};
const BY_TYPE = new Map();
for (const [profile, kinds] of Object.entries(DEVICE_TYPES)) {
  for (const [kind, ids] of Object.entries(kinds)) for (const id of ids) BY_TYPE.set(`${profile}:${id}`, kind);
}

/** Server (input) clusters that name one function, in order of precedence: used only when no endpoint's device type
 *  is known (manufacturer-specific identifiers). A light has colour control; the IAS zone does not say which sensor. */
const CLUSTERS = [
  [0x0101, "lock"], [0x0102, "blind"], [0x0201, "thermostat"], [0x0300, "light"], [0x0406, "motion"],
  [0x0402, "temperature"], [0x0500, "sensor"], [0x0400, "sensor"], [0x0403, "sensor"], [0x0405, "sensor"],
];

/** When endpoints disagree, the more specific kind wins: a remote with a battery sensor endpoint is a button, a
 *  motion sensor with an on/off sensor endpoint is a motion sensor. */
const PRECEDENCE = ["light", "outlet", "relay", "blind", "lock", "thermostat", "motion", "temperature", "button", "hub",
  "sensor"];

const endpointsOf = (signature) => {
  const eps = signature && typeof signature === "object" ? signature.endpoints : null;
  if (!eps || typeof eps !== "object") return [];
  return Object.keys(eps).sort((a, b) => (parseAddress(a) ?? 0) - (parseAddress(b) ?? 0)).map((k) => eps[k])
    .filter((ep) => ep && typeof ep === "object");
};

/** Kind of a device from its `zha/devices` signature: the device types of its endpoints, else its server clusters,
 *  else "unknown". The coordinator is always a hub, whatever it declares (spec 8). */
export function deviceKind(signature, role = null) {
  if (role === "coordinator") return "hub";
  const eps = endpointsOf(signature);
  const found = new Set();
  for (const ep of eps) {
    const kind = BY_TYPE.get(`${parseAddress(ep.profile_id)}:${parseAddress(ep.device_type)}`);
    if (kind) found.add(kind);
  }
  const best = PRECEDENCE.find((k) => found.has(k));
  if (best) return best;
  const clusters = new Set();
  for (const ep of eps) {
    for (const c of Array.isArray(ep.input_clusters) ? ep.input_clusters : []) clusters.add(parseAddress(c));
  }
  const byCluster = CLUSTERS.find(([id]) => clusters.has(id));
  return byCluster ? byCluster[1] : "unknown";
}

/** Whether the device switches its receiver off when idle (a sleepy end device), from the MAC capability flags of
 *  its node descriptor (bit 3: receiver on when idle); null when the signature does not carry them. */
export function receiverOffWhenIdle(signature) {
  const nd = signature && typeof signature === "object" ? signature.node_descriptor : null;
  const flags = nd && typeof nd === "object" ? parseAddress(nd.mac_capability_flags) : null;
  return flags === null ? null : (flags & 0x08) === 0;
}
