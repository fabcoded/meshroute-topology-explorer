// SPDX-License-Identifier: MIT
// The ZHA adapter (spec 3.1): reads a Zigbee network through Home Assistant's ZHA commands and hands the answer to the
// Zigbee engine (engines/index.js), which builds the model. Read only: `zha/devices` returns what ZHA holds; the
// scan is started elsewhere, by the user (panel.js). Also zigpy's route records for the source-route stage "read from
// zigpy" (spec 5.1; brief a4w): one call of the integration's own command per data load, attached to the network as
// `network.zigpy` and read by model/source-routes.js; it reads what zigpy holds in memory and causes no radio traffic.
// No DOM. node --test tests/
import { ENGINES } from "../engines/index.js";
import { normalizeIeee, parseAddress } from "../model/parse.js";
import { isConnectionLost } from "./ws.js";

/** ZHA's config entries (`config_entries/get`): whether ZHA is loaded, and the entry id that names the network. */
export function readZhaEntries(hass) {
  return hass.callWS({ type: "config_entries/get", domain: "zha" });
}

/** Read ZHA's devices once and build the Zigbee network from them, with zigpy's route records attached. registries():
 *  the device and area registries, read once on first need (shared with the Matter adapter). Returns { raw, network },
 *  network null when ZHA lists no device; errors are thrown to the caller, which turns them into its states. */
export async function readZha(hass, { configEntries, registries }) {
  const raw = await hass.callWS({ type: "zha/devices" });
  if (!(Array.isArray(raw) && raw.length)) return { raw, network: null };
  const network = ENGINES.zigbee.build(raw, { ...(await registries()), configEntries });
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
 *  integration's answer (zha_not_loaded, no_gateway, internals_changed, error) or the error code (an older
 *  integration answers unknown_command). */
export async function readZigpyRoutes(hass) {
  try {
    return parseZigpyRoutes(await hass.callWS({ type: "meshroute_topology_explorer/zigpy_routes" }));
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    const e = (err && err.error) || err || {};
    const message = String(e.message || e.code || e);
    const reason = e.code === "not_supported" ? String(e.message || "").split(":")[0] || "not_supported" : String(e.code || "error");
    return { status: "not_supported", reason, message };
  }
}

/** Send zha/topology/update without waiting: ZHA never answers it (spec 3.1). The connection's sendMessage
 *  (home-assistant-js-websocket) sends without registering an answer, so nothing waits forever; it throws without a
 *  connection, which the scan reports. Without it, callWS is called and its promise left alone. */
export function sendScan(hass) {
  const conn = hass && hass.connection;
  if (conn && typeof conn.sendMessage === "function") {
    conn.sendMessage({ type: "zha/topology/update" });
  } else {
    hass.callWS({ type: "zha/topology/update" }).catch(() => {});
  }
}
