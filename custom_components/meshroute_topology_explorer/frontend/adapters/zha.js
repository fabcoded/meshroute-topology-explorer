// SPDX-License-Identifier: MIT
// The ZHA adapter (spec 3.1): reads a Zigbee network through Home Assistant's ZHA commands and hands the answer to the
// Zigbee engine (engines/index.js), which builds the model. Read only: `zha/devices` returns what ZHA holds; the
// scan is started elsewhere, by the user (panel.js). Also zigpy's route records for the source-route stage "read from
// zigpy" (spec 5.1): one call of the integration's own command per data load, attached to the network as
// `network.zigpy` and read by engines/zigbee/source-routes.js; it reads what zigpy holds in memory and causes no radio traffic.
// No DOM. npm test
import { ENGINES } from "../engines/index.js";
import { normalizeIeee, parseAddress } from "../model/parse.js";
import { countedEntries, entryState, errorCode, errorText, isConnectionLost } from "./ws.js";
import { ScanFollower, tablesDiffer } from "./zha-scan.js";
import { ObservationsClient } from "./zha-observations.js";
import { TEXTS } from "./zha-texts.js";

/** ZHA's own page of a device, on one of its tabs ("signature" is the Zigbee info, "clusters" the management). The
 *  IEEE goes in with its colons, as the frontend writes it: the page reads the path segment as it is, so an encoded
 *  colon would name no device. The model's ids are validated EUI-64s (model/parse.js), nothing else reaches here. */
export const zhaDevicePath = (ieee, tab = "signature") => `/config/zha/device/${ieee}/${tab}`;

/** Read ZHA's devices once and build the Zigbee network from them, with zigpy's route records attached. registries():
 *  the device and area registries, read once on first need (shared with the Matter adapter). Returns { raw, network },
 *  network null when ZHA lists no device; errors are thrown to the caller, which turns them into its states. */
export async function readZha(hass, { configEntries, registries }) {
  const raw = await hass.callWS({ type: "zha/devices" });
  if (!(Array.isArray(raw) && raw.length)) return { raw, network: null };
  const regs = await registries();
  const network = ENGINES.zigbee.build(raw, { ...regs, configEntries });
  // The input the path history rebuilds its snapshots from (engines/zigbee/history.js liveContext).
  network.live = { rawDevices: raw, ...regs, configEntries };
  // Read only, never fails the load; ZHA only, never for Thread.
  network.zigpy = await readZigpyRoutes(hass);
  return { raw, network };
}

const nwkOf = (value) => {
  const n = parseAddress(value);
  return n !== null && n <= 0xffff ? n : null;
};

/** The command's answer as the model reads it: { status: "ok", radio, records: Map ieee -> { nwk, relays: [{ nwk,
 *  ieee }] } }. Entries that do not have that shape are left out (unknown beats wrong); a relay whose device zigpy
 *  could not name keeps ieee null, and the model then does not use that record. */
export function parseZigpyRoutes(answer) {
  const records = new Map();
  for (const d of Array.isArray(answer && answer.devices) ? answer.devices : []) {
    const id = d && normalizeIeee(d.ieee);
    const nwk = d && nwkOf(d.nwk);
    if (!id || nwk === null || !Array.isArray(d.relays) || records.has(id)) continue;
    const relays = d.relays.map((r) => ({ nwk: r ? nwkOf(r.nwk) : null, ieee: r && normalizeIeee(r.ieee) }));
    if (relays.some((r) => r.nwk === null)) continue;
    records.set(id, { nwk, relays });
  }
  const radio = answer && typeof answer.radio === "string" ? answer.radio.slice(0, 64) : null;
  return { status: "ok", radio, records };
}

/** Read the route records once; never throws except for a lost connection (the caller's load then counts as
 *  disconnected). Without them: { status: "not_supported", reason, message }, reason the key before the colon of the
 *  integration's answer (zha_not_loaded, no_gateway, internals_changed, error) or the error code. */
export async function readZigpyRoutes(hass) {
  try {
    return parseZigpyRoutes(await hass.callWS({ type: "meshroute_topology_explorer/zigpy_routes" }));
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    const code = errorCode(err);
    const message = errorText(err);
    const reason = code === "not_supported" ? message.split(":")[0] || "not_supported" : String(code || "error");
    return { status: "not_supported", reason, message };
  }
}

/** Send zha/topology/update without waiting: ZHA never answers it (spec 3.1). The connection's sendMessage
 *  (home-assistant-js-websocket) sends without registering an answer, so nothing waits forever; it throws without a
 *  connection, which the scan reports. */
export function sendScan(hass) {
  hass.connection.sendMessage({ type: "zha/topology/update" });
}

/** One read of this source for the panel (ui/controller.js readNetwork): { status ("ok", "empty", "not_set_up" or
 *  "not_running", adapters/ws.js entryState), network, raw, message (not_running: the entry's state) }. registries():
 *  the shared device and area registries, read once on first need. Errors are thrown to the caller, which turns them
 *  into this source's "error" read and keeps the other sources (#15). */
export async function readSource(hass, { registries }) {
  // Only the entries that count reach the engine, which names the network after the first (#15).
  const configEntries = countedEntries(await hass.callWS({ type: "config_entries/get", domain: "zha" }), "zha");
  const entry = entryState(configEntries, "zha");
  if (entry.status === "not_set_up") return { status: "not_set_up", network: null, raw: null };
  if (entry.status === "not_running") return { status: "not_running", network: null, raw: null, message: entry.state };
  const { raw, network } = await readZha(hass, { configEntries, registries });
  return { status: network ? "ok" : "empty", network, raw };
}

/** Empty-state phases of a ZHA read without a network (spec 9.4); not set up is none. */
const EMPTY_STATES = Object.freeze({ empty: "no_devices", error: "zha_error", not_running: "zha_not_running" });
/** Reads the network switch lists greyed, with the words for why (#15). */
const UNAVAILABLE = Object.freeze({ error: "status.zha_error", not_running: "status.zha_not_running" });

/** The ZHA adapter as the shell sees it (adapters/index.js): key (the source its networks carry and the stored choice
 *  of the network switch), the read, the empty-state phase of a read without a network, whether a read lists the
 *  network greyed (not running or a read error, #15) and the words for why, ZHA's device page, the scan (send, follow, compare
 *  tables), the observations client and the reload note (a text key: ZHA's held tables, no scan). */
export const adapter = Object.freeze({
  key: "zha",
  read: readSource,
  emptyState: (read) => (read && EMPTY_STATES[read.status]) || null,
  unavailable: (read) => Boolean(read && UNAVAILABLE[read.status]),
  reasonText: (choice, t) => t(UNAVAILABLE[choice.reason], { message: choice.message || "?" }),
  devicePage: (device, tab = "signature") => ({ key: "zha", path: zhaDevicePath(device.id, tab) }),
  scan: Object.freeze({ send: sendScan, Follower: ScanFollower, differ: tablesDiffer }),
  Observations: ObservationsClient,
  reloadInfo: "view.zha_reload_info",
  texts: TEXTS,
});
