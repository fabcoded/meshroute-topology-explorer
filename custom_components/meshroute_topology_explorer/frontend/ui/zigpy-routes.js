// SPDX-License-Identifier: MIT
// zigpy's route records for the source-route stage "read from zigpy" (spec 5.1; brief a4w). One call of the
// integration's own command per data load; the answer is attached to the network as `network.zigpy` and read by
// model/source-routes.js. Read only: the command reads what zigpy holds in memory and causes no radio traffic.
// No DOM. node --test tests/
import { normalizeIeee, parseAddress } from "../model/parse.js";

// A command that died with the connection (home-assistant-js-websocket ERR_CONNECTION_LOST = 3, both forms; the same
// check as controller.js isConnectionLost, kept here so the two modules do not import each other).
const connectionLost = (err) => Boolean(err) && (err.code === 3 || (err.error && err.error.code === 3));

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
    if (connectionLost(err)) throw err;
    const e = (err && err.error) || err || {};
    const message = String(e.message || e.code || e);
    const reason = e.code === "not_supported" ? String(e.message || "").split(":")[0] || "not_supported" : String(e.code || "error");
    return { status: "not_supported", reason, message };
  }
}
